import { createHash } from 'node:crypto';
import { PostgresSearch } from './postgres-search.js';
import { DATABASE_SCHEMA_SQL } from './schema.js';
import { EmbeddingJobs } from './embedding-jobs.js';
import { NativeAppliances, MEILI_NATIVE_EMBEDDER } from './appliance-vectors.js';
import { EmbeddingUnavailableError } from './embeddings.js';
import pg from 'pg';
import type { City, Neighborhood } from '../../../packages/domain/src/city.types.js';
import type { House } from '../../../packages/domain/src/house.types.js';
import type {
  FacetBucket,
  HouseSearchHit,
  HouseSearchRequest,
  SearchProviderId
} from '../../../packages/search-contracts/src/search-provider.interface.js';
import type { SavedHouseSearch } from '../../../packages/search-contracts/src/saved-search.types.js';
import { toHouseSearchDocument, type HouseSearchDocument } from '../../../packages/search-transform/src/house-search-document.js';
import { toMeiliDocument } from '../../../packages/search-transform/src/to-meili-document.js';
import { toTypesenseDocument } from '../../../packages/search-transform/src/to-typesense-document.js';

const { Pool } = pg;

type ExternalProvider = Extract<SearchProviderId, 'meilisearch' | 'typesense'>;

type ExternalSearchResult = {
  hits: HouseSearchHit[];
  totalHits: number;
  facets: Record<string, FacetBucket[]>;
  debug: {
    rawRequest: unknown;
    rawResponse: unknown;
    warnings?: string[];
  };
};

export type RealServiceConfig = {
  databaseUrl?: string;
  meiliHost: string;
  meiliKey: string;
  typesenseHost: string;
  typesenseKey: string;
  syncProviders?: ExternalProvider[];
};

export type SyncSummary = {
  outboxPendingCount: number;
  outbox: unknown[];
  providers: Record<ExternalProvider, {
    documentsIndexed: number;
    documentsDeleted: number;
    lastSyncTime?: string;
    lastSyncError?: string;
    backfillStatus: string;
  }>;
};

export class RealServices {
  private pool: pg.Pool;
  private schemaReady?: Promise<void>;
  private locations = new WeakMap<House, { city: City; neighborhood?: Neighborhood }>();
  readonly embeddingJobs: EmbeddingJobs;
  private readonly appliances: NativeAppliances;
  private readonly postgresSearch: PostgresSearch;

  constructor(private config: RealServiceConfig) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required for real service mode.');
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 6 });
    this.postgresSearch = new PostgresSearch(this.pool);
    const appliances = this.appliances = new NativeAppliances({ ...config, providers: config.syncProviders ?? [],
      onRepair: (provider) => this.embeddingJobs.beginProjectionRepair(provider),
      onReady: (provider) => this.embeddingJobs.confirmProjectionReady(provider)
    });
    this.embeddingJobs = new EmbeddingJobs(this.pool, config.databaseUrl, {
      loadDocument: async (id) => {
        const house = (await this.loadHouses(id))[0];
        return house && !house.deletedAt ? this.documentFor(house) : undefined;
      },
      syncDocument: async (doc, id, vector, signal) => {
        try {
          await appliances.sync(doc, id, signal);
        } catch (error) {
          await this.pool.query(`UPDATE search_sync_state SET last_sync_error=$2, backfill_status='retrying'
            WHERE provider=ANY($1::text[])`, [config.syncProviders ?? [], (error instanceof Error ? error.message : String(error)).slice(0,1600)]);
          throw error;
        }
        for (const provider of config.syncProviders ?? []) {
          await this.pool.query(`UPDATE search_sync_state SET
            documents_indexed = documents_indexed + $2, documents_deleted = documents_deleted + $3,
            last_sync_time = now(), last_sync_error = NULL, backfill_status = 'automatic'
            WHERE provider = $1`, [provider, doc ? 1 : 0, doc ? 0 : 1]);
        }
      }
    }, {
      workerEnabled: process.env.EMBEDDING_WORKER_ENABLED !== '0',
      projectionKey: createHash('sha256').update(JSON.stringify({
        native: appliances.nativeMetadata(),
        providers: [...new Set(config.syncProviders ?? [])].sort().map((provider) => ({
          provider, host: (provider === 'meilisearch' ? config.meiliHost : config.typesenseHost).replace(/\/$/, '')
        }))
      })).digest('hex')
    });
  }

  async catalog() {
    const { rows } = await this.pool.query(`SELECT jsonb_build_object(
      'cities',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'state',state,'county',county,'centerLat',center_lat,'centerLng',center_lng) ORDER BY name) FROM cities),'[]'::jsonb),
      'neighborhoods',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'cityId',city_id,'name',name,'lat',center_lat,'lng',center_lng) ORDER BY name) FROM neighborhoods),'[]'::jsonb),
      'schoolDistricts',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT school_district AS value FROM houses WHERE deleted_at IS NULL AND school_district IS NOT NULL) s),'[]'::jsonb),
      'amenities',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT amenity AS value FROM house_amenities a JOIN houses h ON h.id=a.house_id WHERE h.deleted_at IS NULL) s),'[]'::jsonb),
      'tags',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT tag AS value FROM house_tags a JOIN houses h ON h.id=a.house_id WHERE h.deleted_at IS NULL) s),'[]'::jsonb),
      'propertyTypes',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT property_type AS value FROM houses WHERE deleted_at IS NULL) s),'[]'::jsonb),
      'listingStatuses',COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT listing_status AS value FROM houses WHERE deleted_at IS NULL) s),'[]'::jsonb)
    ) AS catalog`);
    return rows[0].catalog;
  }

  async start() {
    await this.ensureSchema();
    await this.embeddingJobs.start();
  }

  async close() {
    await this.embeddingJobs.stop();
    await this.pool.end();
  }

  async ensureSchema() {
    this.schemaReady ??= this.pool.query(DATABASE_SCHEMA_SQL).then(() => undefined).catch((error) => {
      this.schemaReady = undefined;
      throw error;
    });
    await this.schemaReady;
  }

  locationFor(house: House) {
    const location = this.locations.get(house);
    if (!location) throw new Error(`No database location context for house ${house.id}`);
    return location;
  }

  documentFor(house: House) {
    const { city, neighborhood } = this.locationFor(house);
    return toHouseSearchDocument(house, city, neighborhood);
  }

  async seed(cities: City[], neighborhoods: Neighborhood[], houses: House[], savedSearches: SavedHouseSearch[]) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Row deletes retain tombstones and monotonic versions, fencing any in-flight job.
      await client.query('DELETE FROM houses; DELETE FROM neighborhoods; DELETE FROM cities; DELETE FROM saved_searches; DELETE FROM search_sync_outbox');
      await client.query("UPDATE search_sync_state SET documents_indexed = 0, documents_deleted = 0, last_sync_time = NULL, last_sync_error = NULL, backfill_status = 'not_started'");

      for (const city of cities) {
        await client.query(
          'INSERT INTO cities (id, name, state, county, center_lat, center_lng) VALUES ($1, $2, $3, $4, $5, $6)',
          [city.id, city.name, city.state, city.county ?? null, city.centerLat, city.centerLng]
        );
      }

      for (const neighborhood of neighborhoods) {
        await client.query(
          'INSERT INTO neighborhoods (id, city_id, name, center_lat, center_lng) VALUES ($1, $2, $3, $4, $5)',
          [neighborhood.id, neighborhood.cityId, neighborhood.name, neighborhood.lat, neighborhood.lng]
        );
      }

      for (const house of houses) {
        await client.query(
          `INSERT INTO houses (
            id, title, description, city_id, neighborhood_id, address_line_1, zip_code, lat, lng, price,
            bedrooms, bathrooms, square_feet, lot_size_acres, year_built, property_type, listing_status,
            school_district, created_at, updated_at, deleted_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21
          )`,
          [
            house.id,
            house.title,
            house.description,
            house.cityId,
            house.neighborhoodId ?? null,
            house.addressLine1,
            house.zipCode,
            house.lat,
            house.lng,
            house.price,
            house.bedrooms,
            house.bathrooms,
            house.squareFeet,
            house.lotSizeAcres ?? null,
            house.yearBuilt ?? null,
            house.propertyType,
            house.listingStatus,
            house.schoolDistrict ?? null,
            house.createdAt,
            house.updatedAt,
            house.deletedAt ?? null
          ]
        );
        for (const amenity of house.amenities) {
          await client.query('INSERT INTO house_amenities (house_id, amenity) VALUES ($1, $2)', [house.id, amenity]);
        }
        for (const tag of house.tags) {
          await client.query('INSERT INTO house_tags (house_id, tag) VALUES ($1, $2)', [house.id, tag]);
        }
      }

      for (const search of savedSearches) {
        await client.query(
          `INSERT INTO saved_searches (
            id, name, provider, criteria, current_hit_count, last_evaluated_at,
            new_matches_since_last_evaluation, seen_house_ids, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            search.id,
            search.name,
            search.provider,
            search.criteria,
            search.currentHitCount,
            search.lastEvaluatedAt ?? null,
            search.newMatchesSinceLastEvaluation,
            search.seenHouseIds,
            search.createdAt,
            search.updatedAt
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async loadHouses(id?: string, queryable: pg.Pool | pg.PoolClient = this.pool): Promise<House[]> {
    await this.ensureSchema();
    const { rows } = await queryable.query(`
      SELECT
        h.*, row_to_json(c) AS city_record, row_to_json(n) AS neighborhood_record,
        COALESCE(array_agg(DISTINCT ha.amenity ORDER BY ha.amenity) FILTER (WHERE ha.amenity IS NOT NULL), '{}') AS amenities,
        COALESCE(array_agg(DISTINCT ht.tag ORDER BY ht.tag) FILTER (WHERE ht.tag IS NOT NULL), '{}') AS tags
      FROM houses h
      JOIN cities c ON c.id = h.city_id
      LEFT JOIN neighborhoods n ON n.id = h.neighborhood_id
      LEFT JOIN house_amenities ha ON ha.house_id = h.id
      LEFT JOIN house_tags ht ON ht.house_id = h.id
      WHERE ($1::text IS NULL OR h.id = $1)
      GROUP BY h.id, c.id, n.id
      ORDER BY h.id
    `, [id ?? null]);
    return rows.map((row) => {
      const house: House = {
      id: row.id,
      title: row.title,
      description: row.description,
      cityId: row.city_id,
      neighborhoodId: row.neighborhood_id ?? undefined,
      addressLine1: row.address_line_1,
      zipCode: row.zip_code,
      lat: Number(row.lat),
      lng: Number(row.lng),
      price: Number(row.price),
      bedrooms: Number(row.bedrooms),
      bathrooms: Number(row.bathrooms),
      squareFeet: Number(row.square_feet),
      lotSizeAcres: row.lot_size_acres === null ? undefined : Number(row.lot_size_acres),
      yearBuilt: row.year_built === null ? undefined : Number(row.year_built),
      propertyType: row.property_type,
      listingStatus: row.listing_status,
      schoolDistrict: row.school_district ?? undefined,
      amenities: row.amenities,
      tags: row.tags,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : undefined
      };
      const c = row.city_record;
      const n = row.neighborhood_record;
      this.locations.set(house, {
        city: { id: c.id, name: c.name, state: c.state, county: c.county ?? undefined, centerLat: Number(c.center_lat), centerLng: Number(c.center_lng) },
        neighborhood: n ? { id: n.id, cityId: n.city_id, name: n.name, lat: Number(n.center_lat), lng: Number(n.center_lng) } : undefined
      });
      return house;
    });
  }

  async listSavedSearches(): Promise<SavedHouseSearch[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query('SELECT * FROM saved_searches ORDER BY created_at DESC');
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      criteria: row.criteria,
      currentHitCount: row.current_hit_count,
      lastEvaluatedAt: row.last_evaluated_at ? new Date(row.last_evaluated_at).toISOString() : undefined,
      newMatchesSinceLastEvaluation: row.new_matches_since_last_evaluation,
      seenHouseIds: row.seen_house_ids,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    }));
  }

  async insertSavedSearch(search: SavedHouseSearch) {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO saved_searches (
        id, name, provider, criteria, current_hit_count, last_evaluated_at,
        new_matches_since_last_evaluation, seen_house_ids, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        search.id,
        search.name,
        search.provider,
        search.criteria,
        search.currentHitCount,
        search.lastEvaluatedAt ?? null,
        search.newMatchesSinceLastEvaluation,
        search.seenHouseIds,
        search.createdAt,
        search.updatedAt
      ]
    );
  }

  async updateSavedSearch(search: SavedHouseSearch) {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE saved_searches
       SET current_hit_count = $2, last_evaluated_at = $3, new_matches_since_last_evaluation = $4,
           seen_house_ids = $5, updated_at = $6
       WHERE id = $1`,
      [
        search.id,
        search.currentHitCount,
        search.lastEvaluatedAt ?? null,
        search.newMatchesSinceLastEvaluation,
        search.seenHouseIds,
        search.updatedAt
      ]
    );
  }

  async updateHouse(id: string, patch: Partial<House> & { deleted?: boolean }): Promise<House | undefined> {
    await this.ensureSchema();
    validateHousePatch(patch);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT id FROM houses WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rowCount) { await client.query('ROLLBACK'); return undefined; }
      const existing = (await this.loadHouses(id, client))[0];
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString(), deletedAt: patch.deleted === true ? new Date().toISOString() : patch.deleted === false ? undefined : existing.deletedAt };
      await client.query(`UPDATE houses SET
        title=$2, description=$3, city_id=$4, neighborhood_id=$5, address_line_1=$6, zip_code=$7,
        lat=$8, lng=$9, price=$10, bedrooms=$11, bathrooms=$12, square_feet=$13,
        lot_size_acres=$14, year_built=$15, property_type=$16, listing_status=$17,
        school_district=$18, updated_at=$19, deleted_at=$20 WHERE id=$1`,
        [id, next.title, next.description, next.cityId, next.neighborhoodId ?? null, next.addressLine1, next.zipCode,
          next.lat, next.lng, next.price, next.bedrooms, next.bathrooms, next.squareFeet, next.lotSizeAcres ?? null,
          next.yearBuilt ?? null, next.propertyType, next.listingStatus, next.schoolDistrict ?? null, next.updatedAt, next.deletedAt ?? null]);
      for (const [field, table, column] of [['amenities', 'house_amenities', 'amenity'], ['tags', 'house_tags', 'tag']] as const) {
        if (patch[field] !== undefined) {
          await client.query(`DELETE FROM ${table} WHERE house_id = $1`, [id]);
          for (const value of new Set(next[field])) await client.query(`INSERT INTO ${table} (house_id, ${column}) VALUES ($1, $2)`, [id, value]);
        }
      }
      await client.query('COMMIT');
      return (await this.loadHouses(id))[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueExternalSync(houseId: string, _action: 'upsert' | 'delete') {
    await this.ensureSchema();
    await this.pool.query('SELECT invalidate_house_embedding($1)', [houseId]);
  }

  async syncSummary(): Promise<SyncSummary> {
    await this.ensureSchema();
    const outbox = await this.pool.query(`SELECT w.house_id AS id, w.house_id, w.job_id, w.attempt_state AS status, w.last_error AS error, w.updated_at AS created_at, $1::text AS provider, CASE WHEN h.id IS NULL OR h.deleted_at IS NOT NULL THEN 'delete' ELSE 'upsert' END AS action FROM house_embedding_work w LEFT JOIN houses h ON h.id=w.house_id WHERE w.desired_version>w.completed_version ORDER BY w.updated_at DESC LIMIT 50`, [(this.config.syncProviders ?? []).join(',') || 'postgres']);
    const pending = await this.pool.query('SELECT count(*)::int AS count FROM house_embedding_work WHERE desired_version > completed_version');
    const states = await this.pool.query('SELECT * FROM search_sync_state ORDER BY provider');
    const providers = Object.fromEntries(states.rows.map((row) => [
      row.provider,
      {
        documentsIndexed: row.documents_indexed,
        documentsDeleted: row.documents_deleted,
        lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time).toISOString() : undefined,
        lastSyncError: row.last_sync_error ?? undefined,
        backfillStatus: this.config.syncProviders?.includes(row.provider) ? row.backfill_status : 'disabled'
      }
    ])) as SyncSummary['providers'];
    return {
      outboxPendingCount: pending.rows[0].count,
      outbox: outbox.rows,
      providers
    };
  }

  async backfill(provider: ExternalProvider, _cities: City[], _neighborhoods: Neighborhood[]) {
    if (!this.config.syncProviders?.includes(provider)) throw Object.assign(new Error(`${provider} automatic sync is disabled. Set SEARCH_SYNC_PROVIDERS to opt in.`), { statusCode: 400 });
    return { provider, ...await this.embeddingJobs.backfill(true), status: 'queued' };
  }

  async searchExternal(provider: ExternalProvider, request: HouseSearchRequest, cities: City[], neighborhoods: Neighborhood[], scopeIds?: readonly string[]): Promise<ExternalSearchResult> {
    const houses = await this.loadHouses();
    if (provider === 'meilisearch') return this.searchMeili(request, houses, cities, neighborhoods, scopeIds);
    return this.searchTypesense(request, houses, cities, neighborhoods, scopeIds);
  }

  async search(request: HouseSearchRequest, scopeIds?: readonly string[]) {
    if (request.provider === 'postgres_native' || request.provider === 'pg_search') {
      const result = await this.postgresSearch.search(request, scopeIds);
      return { ...result, debug: { ...result.debug, execution: request.mode === 'keyword' || !request.q?.trim() ? request.provider === 'pg_search' ? 'postgres-bm25' as const : 'postgres-fts' as const : request.mode === 'semantic' ? 'postgres-vector' as const : 'postgres-hybrid' as const } };
    }
    const provider = request.provider;
    if (!this.config.syncProviders?.includes(provider)) throw new EmbeddingUnavailableError(`${provider} indexing is disabled. Enable SEARCH_SYNC_PROVIDERS and wait for automatic backfill.`);
    try {
      await this.embeddingJobs.assertProjectionCurrent();
      if (await this.appliances.ensure(provider, AbortSignal.timeout(30_000))) throw new Error('Native index configuration was restored; automatic source backfill is pending.');
      const snapshot = async () => (await this.pool.query(`SELECT
        (SELECT count(*)::int FROM houses WHERE deleted_at IS NULL) AS total,
        count(*) FILTER(WHERE completed_version < desired_version)::int AS pending,
        COALESCE(max(desired_version),0)::text AS version FROM house_embedding_work`)).rows[0];
      const before = await snapshot();
      if (before.total > 1000) throw new Error('Complete native maps/scopes are limited to 1,000 total source documents in this demo.');
      if (before.pending) throw new Error('Source/index updates are pending. Check System and retry shortly.');
      const pageResult = await this.searchExternal(provider, request, [], [], scopeIds);
      if (pageResult.totalHits > 1000) throw new Error('Native result set exceeds the 1,000-document demo limit.');
      if (request.includeMap === false) return {
        hits: pageResult.hits, mapHits: [], totalHits: pageResult.totalHits,
        totalInventory: before.total, facets: request.includeFacets ? pageResult.facets : {},
        debug: { ...pageResult.debug, notes: ['Map marker data is deferred until a map view is requested.'] }
      };
      const all: HouseSearchHit[] = [];
      const requests: unknown[] = [pageResult.debug.rawRequest];
      const responses: unknown[] = [pageResult.debug.rawResponse];
      for (let page = 1; all.length < pageResult.totalHits && page <= 4; page++) {
        const result = await this.searchExternal(provider, { ...request, page, pageSize: 250 }, [], [], scopeIds);
        if (result.totalHits !== pageResult.totalHits) throw new Error('Native result set changed during map retrieval; retry.');
        requests.push(result.debug.rawRequest); responses.push(result.debug.rawResponse);
        all.push(...result.hits);
        if (!result.hits.length) break;
      }
      const after = await snapshot();
      if (after.pending || after.version !== before.version) throw new Error('Source data changed during native search; retry after indexing settles.');
      if (all.length !== pageResult.totalHits || new Set(all.map((hit) => hit.id)).size !== all.length) throw new Error('Native index/source result set is incomplete; run a source backfill.');
      return { hits: pageResult.hits, mapHits: all, totalHits: pageResult.totalHits, totalInventory: before.total, facets: request.includeFacets ? pageResult.facets : {}, debug: {
        execution: request.mode === 'keyword' || !request.q?.trim() ? 'external-keyword' as const : request.mode === 'semantic' ? 'external-semantic' as const : 'external-hybrid' as const,
        rawRequest: requests, rawResponse: responses,
        notes: ['Filtering, ranking, facet counts and total counts come from the selected engine. Map and saved-scope IDs use its complete bounded result set. Native scores are engine-specific.']
      } };
    } catch (error) {
      throw new EmbeddingUnavailableError(`${provider} search unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async runSyncWorker(_cities: City[], _neighborhoods: Neighborhood[]) {
    return { processed: 0, admitted: await this.embeddingJobs.dispatch(), automatic: true, lastSyncTime: new Date().toISOString() };
  }

  private async meili(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.config.meiliHost}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30000),
      headers: {
        ...(this.config.meiliKey ? { Authorization: `Bearer ${this.config.meiliKey}` } : {}),
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(`Meilisearch ${response.status}: ${await response.text()}`);
    return response.json();
  }

  private async typesense(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.config.typesenseHost}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30000),
      headers: {
        'X-TYPESENSE-API-KEY': this.config.typesenseKey,
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(`Typesense ${response.status}: ${await response.text()}`);
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? response.json() : response.text();
  }

  private async searchMeili(request: HouseSearchRequest, houses: House[], cities: City[], neighborhoods: Neighborhood[], scopeIds?: readonly string[]): Promise<ExternalSearchResult> {
    const rawRequest = {
      q: request.q ?? '',
      filter: this.meiliFilters(request, scopeIds),
      facets: ['cityFacet', 'neighborhoodFacet', 'schoolDistrictFacet', 'propertyTypeFacet', 'bedrooms', 'amenities', 'listingStatusFacet'],
      sort: this.meiliSort(request),
      page: request.page,
      hitsPerPage: request.pageSize,
      ...(request.mode !== 'keyword' && request.q?.trim() ? { hybrid: { embedder: MEILI_NATIVE_EMBEDDER, semanticRatio: request.mode === 'semantic' ? 1 : 0.45 }, showRankingScore: true, rankingScoreThreshold: 0.35 } : {})
    };
    const rawResponse = await this.meili('/indexes/houses/search', {
      method: 'POST',
      body: JSON.stringify(rawRequest)
    });
    const hits = this.hitsFromIds(
      (rawResponse.hits ?? []).map((hit: { id: string }) => hit.id),
      houses,
      request,
      cities,
      neighborhoods
    );
    hits.forEach((hit, index) => { hit.score = Number(rawResponse.hits[index]?._rankingScore ?? 0); });
    return {
      hits,
      totalHits: rawResponse.estimatedTotalHits ?? rawResponse.totalHits ?? hits.length,
      facets: this.meiliFacetDistribution(rawResponse.facetDistribution ?? {}),
      debug: {
        rawRequest,
        rawResponse,
        warnings: []
      }
    };
  }

  private async searchTypesense(request: HouseSearchRequest, houses: House[], cities: City[], neighborhoods: Neighborhood[], scopeIds?: readonly string[]): Promise<ExternalSearchResult> {
    const rawRequest = {
      q: request.q?.trim() || '*',
      query_by: request.q?.trim() && request.mode === 'semantic' ? 'embedding' : 'title,description,semanticText,city,neighborhood,schoolDistrict,amenities,tags' + (request.q?.trim() && request.mode === 'hybrid' ? ',embedding' : ''),
      filter_by: this.typesenseFilters(request, scopeIds),
      facet_by: 'cityFacet,neighborhoodFacet,schoolDistrictFacet,propertyTypeFacet,bedrooms,amenities,listingStatusFacet',
      sort_by: this.typesenseSort(request),
      page: request.page,
      per_page: request.pageSize,
      max_facet_values: 20,
      ...(request.mode !== 'keyword' && request.q?.trim() ? { vector_query: 'embedding:([], k:1000, alpha:0.45, distance_threshold:0.65)', exclude_fields: 'embedding', drop_tokens_threshold: 0 } : {})
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rawRequest)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const rawResponse = await this.typesense(`/collections/houses/documents/search?${params.toString()}`);
    const hits = this.hitsFromIds(
      (rawResponse.hits ?? []).map((hit: { document: { id: string } }) => hit.document.id),
      houses,
      request,
      cities,
      neighborhoods
    );
    hits.forEach((hit, index) => { const native = rawResponse.hits[index]; hit.score = Number(native?.text_match_info?.score ?? native?.text_match ?? (native?.vector_distance !== undefined ? 1-native.vector_distance : 0)); if (native?.vector_distance !== undefined) hit.semanticScore = 1-native.vector_distance; });
    return {
      hits,
      totalHits: rawResponse.found ?? hits.length,
      facets: this.typesenseFacetCounts(rawResponse.facet_counts ?? []),
      debug: {
        rawRequest,
        rawResponse,
        warnings: []
      }
    };
  }

  private meiliFilters(request: HouseSearchRequest, scopeIds?: readonly string[]): string[] {
    const filters: string[] = [];
    if (scopeIds) filters.push(scopeIds.length ? `id IN [${scopeIds.map((id) => JSON.stringify(id)).join(',')}]` : 'id = "__empty_scope__" AND id != "__empty_scope__"');
    if (request.filters.bedrooms?.length) filters.push(`bedrooms IN [${request.filters.bedrooms.join(',')}]`);
    const fieldMap = {
      city: 'cityFacet',
      neighborhood: 'neighborhoodFacet',
      schoolDistrict: 'schoolDistrictFacet',
      propertyType: 'propertyTypeFacet',
      listingStatus: 'listingStatusFacet'
    } as const;
    for (const [requestField, engineField] of Object.entries(fieldMap) as Array<[keyof typeof fieldMap, string]>) {
      const values = request.filters[requestField];
      if (values?.length) filters.push(`${engineField} IN [${values.map((value) => JSON.stringify(value)).join(', ')}]`);
    }
    for (const amenity of request.filters.amenities ?? []) filters.push(`amenities = ${JSON.stringify(amenity)}`);
    if (request.filters.minPrice !== undefined) filters.push(`price >= ${request.filters.minPrice}`);
    if (request.filters.maxPrice !== undefined) filters.push(`price <= ${request.filters.maxPrice}`);
    if (request.filters.minBedrooms !== undefined) filters.push(`bedrooms >= ${request.filters.minBedrooms}`);
    if (request.filters.minBathrooms !== undefined) filters.push(`bathrooms >= ${request.filters.minBathrooms}`);
    if (request.filters.minSquareFeet !== undefined) filters.push(`squareFeet >= ${request.filters.minSquareFeet}`);
    if (request.filters.minYearBuilt !== undefined) filters.push(`yearBuilt >= ${request.filters.minYearBuilt}`);
    if (request.filters.maxYearBuilt !== undefined) filters.push(`yearBuilt <= ${request.filters.maxYearBuilt}`);
    if (request.filters.minLotSize !== undefined) filters.push(`lotSizeAcres >= ${request.filters.minLotSize}`);
    if (request.filters.maxLotSize !== undefined) filters.push(`lotSizeAcres <= ${request.filters.maxLotSize}`);
    if (request.geo) filters.push(`_geoRadius(${request.geo.lat}, ${request.geo.lng}, ${Math.round(request.geo.radiusMiles * 1609.344)})`);
    if (request.viewport) filters.push(`_geoBoundingBox([${request.viewport.maxLat}, ${request.viewport.minLng}], [${request.viewport.minLat}, ${request.viewport.maxLng}])`);
    return filters;
  }

  private meiliSort(request: HouseSearchRequest): string[] | undefined {
    if (request.sort === 'distance' && request.geo) return [`_geoPoint(${request.geo.lat}, ${request.geo.lng}):asc`];
    if (request.sort === 'price_asc') return ['price:asc'];
    if (request.sort === 'price_desc') return ['price:desc'];
    if (request.sort === 'newest') return ['updatedEpoch:desc'];
    return undefined;
  }

  private typesenseFilters(request: HouseSearchRequest, scopeIds?: readonly string[]): string {
    const filters: string[] = [];
    if (scopeIds) filters.push(scopeIds.length ? `id:=[${scopeIds.map((id) => this.typesenseValue(id)).join(',')}]` : 'id:=__empty_scope__ && id:!=__empty_scope__');
    if (request.filters.bedrooms?.length) filters.push(`bedrooms:=[${request.filters.bedrooms.join(',')}]`);
    const fieldMap = {
      city: 'cityFacet',
      neighborhood: 'neighborhoodFacet',
      schoolDistrict: 'schoolDistrictFacet',
      propertyType: 'propertyTypeFacet',
      listingStatus: 'listingStatusFacet'
    } as const;
    for (const [requestField, engineField] of Object.entries(fieldMap) as Array<[keyof typeof fieldMap, string]>) {
      const values = request.filters[requestField];
      if (values?.length) filters.push(`${engineField}:=[${values.map((value) => this.typesenseValue(value)).join(',')}]`);
    }
    for (const amenity of request.filters.amenities ?? []) filters.push(`amenities:=${this.typesenseValue(amenity)}`);
    if (request.filters.minPrice !== undefined) filters.push(`price:>=${request.filters.minPrice}`);
    if (request.filters.maxPrice !== undefined) filters.push(`price:<=${request.filters.maxPrice}`);
    if (request.filters.minBedrooms !== undefined) filters.push(`bedrooms:>=${request.filters.minBedrooms}`);
    if (request.filters.minBathrooms !== undefined) filters.push(`bathrooms:>=${request.filters.minBathrooms}`);
    if (request.filters.minSquareFeet !== undefined) filters.push(`squareFeet:>=${request.filters.minSquareFeet}`);
    if (request.filters.minYearBuilt !== undefined) filters.push(`yearBuilt:>=${request.filters.minYearBuilt}`);
    if (request.filters.maxYearBuilt !== undefined) filters.push(`yearBuilt:<=${request.filters.maxYearBuilt}`);
    if (request.filters.minLotSize !== undefined) filters.push(`lotSizeAcres:>=${request.filters.minLotSize}`);
    if (request.filters.maxLotSize !== undefined) filters.push(`lotSizeAcres:<=${request.filters.maxLotSize}`);
    if (request.geo) filters.push(`location:(${request.geo.lat}, ${request.geo.lng}, ${request.geo.radiusMiles} mi)`);
    if (request.viewport) {
      filters.push(`location:(${request.viewport.maxLat}, ${request.viewport.minLng}, ${request.viewport.maxLat}, ${request.viewport.maxLng}, ${request.viewport.minLat}, ${request.viewport.maxLng}, ${request.viewport.minLat}, ${request.viewport.minLng})`);
    }
    return filters.join(' && ');
  }

  private typesenseSort(request: HouseSearchRequest): string | undefined {
    if (request.sort === 'distance' && request.geo) return `location(${request.geo.lat}, ${request.geo.lng}):asc`;
    if (request.sort === 'price_asc') return 'price:asc';
    if (request.sort === 'price_desc') return 'price:desc';
    if (request.sort === 'newest') return 'updatedEpoch:desc';
    if (request.mode === 'semantic' && request.q?.trim()) return '_vector_distance:asc';
    return request.q?.trim() ? '_text_match:desc' : undefined;
  }

  private typesenseValue(value: string) {
    return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\``;
  }

  private meiliFacetDistribution(distribution: Record<string, Record<string, number>>): Record<string, FacetBucket[]> {
    return {
      city: this.fromDistribution(distribution.cityFacet),
      neighborhood: this.fromDistribution(distribution.neighborhoodFacet),
      schoolDistrict: this.fromDistribution(distribution.schoolDistrictFacet),
      propertyType: this.fromDistribution(distribution.propertyTypeFacet),
      bedrooms: this.fromDistribution(distribution.bedrooms),
      amenities: this.fromDistribution(distribution.amenities),
      listingStatus: this.fromDistribution(distribution.listingStatusFacet)
    };
  }

  private typesenseFacetCounts(facetCounts: Array<{ field_name: string; counts: Array<{ value: string; count: number }> }>): Record<string, FacetBucket[]> {
    const byField = Object.fromEntries(facetCounts.map((facet) => [facet.field_name, facet.counts.map((count) => ({ value: count.value, count: count.count }))]));
    return {
      city: byField.cityFacet ?? [],
      neighborhood: byField.neighborhoodFacet ?? [],
      schoolDistrict: byField.schoolDistrictFacet ?? [],
      propertyType: byField.propertyTypeFacet ?? [],
      bedrooms: byField.bedrooms ?? [],
      amenities: byField.amenities ?? [],
      listingStatus: byField.listingStatusFacet ?? []
    };
  }

  private fromDistribution(distribution: Record<string, number> | undefined): FacetBucket[] {
    return Object.entries(distribution ?? {})
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  private hitsFromIds(ids: string[], houses: House[], request: HouseSearchRequest, cities: City[], neighborhoods: Neighborhood[]): HouseSearchHit[] {
    const byId = new Map(houses.map((house) => [house.id, house]));
    return ids.flatMap((id, index) => {
      const house = byId.get(id);
      if (!house) return [];
      const { city, neighborhood } = this.locationFor(house);
      return [{
        ...house,
        city: city.name,
        neighborhood: neighborhood?.name,
        distanceMiles: request.geo ? this.distanceMiles(request.geo.lat, request.geo.lng, house.lat, house.lng) : undefined,
        score: 100 - index,
        semanticText: toHouseSearchDocument(house, city, neighborhood).semanticText,
        matchedTerms: []
      }];
    });
  }

  private distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
    const earthRadiusMiles = 3958.8;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export function realServiceConfigFromEnv(): RealServiceConfig {
  return {
    databaseUrl: process.env.DATABASE_URL,
    meiliHost: process.env.MEILI_HOST ?? 'http://127.0.0.1:7700',
    meiliKey: process.env.MEILI_MASTER_KEY ?? 'dev_meili_master_key',
    typesenseHost: process.env.TYPESENSE_HOST ?? 'http://127.0.0.1:8108',
    typesenseKey: process.env.TYPESENSE_API_KEY ?? 'dev_typesense_api_key',
    syncProviders: (process.env.SEARCH_SYNC_PROVIDERS ?? '').split(',').filter(Boolean).map((value) => {
      if (value !== 'meilisearch' && value !== 'typesense') throw new Error('SEARCH_SYNC_PROVIDERS must be a comma-separated list of meilisearch,typesense.');
      return value;
    })
  };
}

/** Only declared writable source fields. SQL triggers also cover direct database mutations. */
export function validateHousePatch(patch: Record<string, unknown>) {
  const strings = new Set(['title', 'description', 'cityId', 'neighborhoodId', 'addressLine1', 'zipCode', 'propertyType', 'listingStatus', 'schoolDistrict']);
  const numbers = new Set(['lat', 'lng', 'price', 'bedrooms', 'bathrooms', 'squareFeet', 'lotSizeAcres', 'yearBuilt']);
  const optional = new Set(['neighborhoodId', 'schoolDistrict', 'lotSizeAcres', 'yearBuilt']);
  for (const [key, value] of Object.entries(patch)) {
    const valid = (optional.has(key) && value === null) ||
      (strings.has(key) && typeof value === 'string' && value.length <= 8192) ||
      (numbers.has(key) && typeof value === 'number' && Number.isFinite(value)) ||
      (['amenities', 'tags'].includes(key) && Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === 'string' && item.length <= 200)) ||
      (key === 'deleted' && typeof value === 'boolean');
    if (!valid) throw Object.assign(new Error(`Invalid or unsupported house field: ${key}`), { statusCode: 400 });
  }
}
