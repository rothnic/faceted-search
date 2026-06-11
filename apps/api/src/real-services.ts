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

  constructor(private config: RealServiceConfig) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required for real service mode.');
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async close() {
    await this.pool.end();
  }

  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cities (
        id text PRIMARY KEY,
        name text NOT NULL,
        state text NOT NULL,
        county text,
        center_lat double precision NOT NULL,
        center_lng double precision NOT NULL
      );

      CREATE TABLE IF NOT EXISTS neighborhoods (
        id text PRIMARY KEY,
        city_id text NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
        name text NOT NULL,
        center_lat double precision NOT NULL,
        center_lng double precision NOT NULL
      );

      CREATE TABLE IF NOT EXISTS houses (
        id text PRIMARY KEY,
        title text NOT NULL,
        description text NOT NULL,
        city_id text NOT NULL REFERENCES cities(id),
        neighborhood_id text REFERENCES neighborhoods(id),
        address_line_1 text NOT NULL,
        zip_code text NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        price integer NOT NULL,
        bedrooms integer NOT NULL,
        bathrooms numeric NOT NULL,
        square_feet integer NOT NULL,
        lot_size_acres numeric,
        year_built integer,
        property_type text NOT NULL,
        listing_status text NOT NULL,
        school_district text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        deleted_at timestamptz
      );

      CREATE TABLE IF NOT EXISTS house_amenities (
        house_id text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
        amenity text NOT NULL,
        PRIMARY KEY (house_id, amenity)
      );

      CREATE TABLE IF NOT EXISTS house_tags (
        house_id text NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
        tag text NOT NULL,
        PRIMARY KEY (house_id, tag)
      );

      CREATE TABLE IF NOT EXISTS saved_searches (
        id text PRIMARY KEY,
        name text NOT NULL,
        provider text NOT NULL,
        criteria jsonb NOT NULL,
        current_hit_count integer NOT NULL DEFAULT 0,
        last_evaluated_at timestamptz,
        new_matches_since_last_evaluation integer NOT NULL DEFAULT 0,
        seen_house_ids text[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_sync_outbox (
        id bigserial PRIMARY KEY,
        provider text NOT NULL CHECK (provider IN ('meilisearch', 'typesense')),
        house_id text NOT NULL,
        action text NOT NULL CHECK (action IN ('upsert', 'delete')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        error text
      );

      CREATE TABLE IF NOT EXISTS search_sync_state (
        provider text PRIMARY KEY,
        documents_indexed integer NOT NULL DEFAULT 0,
        documents_deleted integer NOT NULL DEFAULT 0,
        last_sync_time timestamptz,
        last_sync_error text,
        backfill_status text NOT NULL DEFAULT 'not_started'
      );

      INSERT INTO search_sync_state (provider)
      VALUES ('meilisearch'), ('typesense')
      ON CONFLICT (provider) DO NOTHING;

      CREATE INDEX IF NOT EXISTS houses_city_id_idx ON houses(city_id);
      CREATE INDEX IF NOT EXISTS houses_neighborhood_id_idx ON houses(neighborhood_id);
      CREATE INDEX IF NOT EXISTS houses_listing_status_idx ON houses(listing_status);
      CREATE INDEX IF NOT EXISTS houses_price_idx ON houses(price);
      CREATE INDEX IF NOT EXISTS houses_updated_at_idx ON houses(updated_at);
      CREATE INDEX IF NOT EXISTS house_amenities_amenity_idx ON house_amenities(amenity);
      CREATE INDEX IF NOT EXISTS search_sync_outbox_pending_idx ON search_sync_outbox(status, provider);
    `);
  }

  async seed(cities: City[], neighborhoods: Neighborhood[], houses: House[], savedSearches: SavedHouseSearch[]) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE house_tags, house_amenities, saved_searches, search_sync_outbox, houses, neighborhoods, cities RESTART IDENTITY CASCADE');
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

  async loadHouses(): Promise<House[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(`
      SELECT
        h.*,
        COALESCE(array_agg(DISTINCT ha.amenity) FILTER (WHERE ha.amenity IS NOT NULL), '{}') AS amenities,
        COALESCE(array_agg(DISTINCT ht.tag) FILTER (WHERE ht.tag IS NOT NULL), '{}') AS tags
      FROM houses h
      LEFT JOIN house_amenities ha ON ha.house_id = h.id
      LEFT JOIN house_tags ht ON ht.house_id = h.id
      GROUP BY h.id
      ORDER BY h.id
    `);
    return rows.map((row) => ({
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
    }));
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
    const existing = (await this.loadHouses()).find((house) => house.id === id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString(), deletedAt: patch.deleted ? new Date().toISOString() : existing.deletedAt };
    await this.pool.query(
      `UPDATE houses
       SET price = $2, listing_status = $3, updated_at = $4, deleted_at = $5
       WHERE id = $1`,
      [id, next.price, next.listingStatus, next.updatedAt, next.deletedAt ?? null]
    );
    await this.enqueueExternalSync(id, patch.deleted || patch.listingStatus === 'sold' ? 'delete' : 'upsert');
    return next;
  }

  async enqueueExternalSync(houseId: string, action: 'upsert' | 'delete') {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO search_sync_outbox (provider, house_id, action)
       VALUES ('meilisearch', $1, $2), ('typesense', $1, $2)`,
      [houseId, action]
    );
  }

  async syncSummary(): Promise<SyncSummary> {
    await this.ensureSchema();
    const outbox = await this.pool.query('SELECT * FROM search_sync_outbox ORDER BY id DESC LIMIT 50');
    const pending = await this.pool.query("SELECT count(*)::int AS count FROM search_sync_outbox WHERE status = 'pending'");
    const states = await this.pool.query('SELECT * FROM search_sync_state ORDER BY provider');
    const providers = Object.fromEntries(states.rows.map((row) => [
      row.provider,
      {
        documentsIndexed: row.documents_indexed,
        documentsDeleted: row.documents_deleted,
        lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time).toISOString() : undefined,
        lastSyncError: row.last_sync_error ?? undefined,
        backfillStatus: row.backfill_status
      }
    ])) as SyncSummary['providers'];
    return {
      outboxPendingCount: pending.rows[0].count,
      outbox: outbox.rows,
      providers
    };
  }

  async backfill(provider: ExternalProvider, cities: City[], neighborhoods: Neighborhood[]) {
    await this.ensureSchema();
    const houses = await this.loadHouses();
    const docs = houses
      .filter((house) => !house.deletedAt)
      .map((house) => toHouseSearchDocument(house, cities.find((city) => city.id === house.cityId)!, neighborhoods.find((item) => item.id === house.neighborhoodId)));
    const now = new Date().toISOString();
    try {
      if (provider === 'meilisearch') await this.backfillMeili(docs);
      else await this.backfillTypesense(docs);
      await this.pool.query(
        `UPDATE search_sync_state
         SET documents_indexed = $2, last_sync_time = $3, last_sync_error = NULL, backfill_status = 'complete'
         WHERE provider = $1`,
        [provider, docs.length, now]
      );
      return { provider, indexed: docs.length, lastSyncTime: now, status: 'complete' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query(
        `UPDATE search_sync_state
         SET last_sync_time = $2, last_sync_error = $3, backfill_status = 'failed'
         WHERE provider = $1`,
        [provider, now, message]
      );
      return { provider, indexed: 0, lastSyncTime: now, status: 'failed', error: message };
    }
  }

  async searchExternal(provider: ExternalProvider, request: HouseSearchRequest, cities: City[], neighborhoods: Neighborhood[]): Promise<ExternalSearchResult> {
    const houses = await this.loadHouses();
    if (provider === 'meilisearch') return this.searchMeili(request, houses, cities, neighborhoods);
    return this.searchTypesense(request, houses, cities, neighborhoods);
  }

  async runSyncWorker(cities: City[], neighborhoods: Neighborhood[]) {
    await this.ensureSchema();
    const { rows } = await this.pool.query("SELECT * FROM search_sync_outbox WHERE status = 'pending' ORDER BY id LIMIT 100");
    const houses = await this.loadHouses();
    const now = new Date().toISOString();
    let processed = 0;
    for (const row of rows) {
      try {
        const house = houses.find((candidate) => candidate.id === row.house_id);
        if (row.action === 'delete' || !house || house.deletedAt || house.listingStatus === 'sold') {
          await this.deleteExternal(row.provider, row.house_id);
          await this.pool.query('UPDATE search_sync_state SET documents_deleted = documents_deleted + 1 WHERE provider = $1', [row.provider]);
        } else {
          const doc = toHouseSearchDocument(house, cities.find((city) => city.id === house.cityId)!, neighborhoods.find((item) => item.id === house.neighborhoodId));
          await this.upsertExternal(row.provider, doc);
          await this.pool.query('UPDATE search_sync_state SET documents_indexed = documents_indexed + 1 WHERE provider = $1', [row.provider]);
        }
        await this.pool.query("UPDATE search_sync_outbox SET status = 'processed', processed_at = $2, error = NULL WHERE id = $1", [row.id, now]);
        await this.pool.query('UPDATE search_sync_state SET last_sync_time = $2, last_sync_error = NULL WHERE provider = $1', [row.provider, now]);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.pool.query("UPDATE search_sync_outbox SET status = 'failed', error = $2 WHERE id = $1", [row.id, message]);
        await this.pool.query('UPDATE search_sync_state SET last_sync_error = $2 WHERE provider = $1', [row.provider, message]);
      }
    }
    return { processed, lastSyncTime: now };
  }

  private async meili(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.config.meiliHost}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.meiliKey}`,
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

  private async backfillMeili(docs: HouseSearchDocument[]) {
    try {
      const deleteTask = await this.meili('/indexes/houses', { method: 'DELETE' });
      await this.waitForMeiliTask(deleteTask.taskUid);
    } catch {
      // Index may not exist on first run.
    }
    const createTask = await this.meili('/indexes', {
      method: 'POST',
      body: JSON.stringify({ uid: 'houses', primaryKey: 'id' })
    });
    await this.waitForMeiliTask(createTask.taskUid);
    const settingsTask = await this.meili('/indexes/houses/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        searchableAttributes: ['title', 'description', 'semanticText', 'city', 'neighborhood', 'schoolDistrict', 'amenities', 'tags'],
        filterableAttributes: [
          'cityFacet',
          'neighborhoodFacet',
          'schoolDistrictFacet',
          'propertyTypeFacet',
          'listingStatusFacet',
          'amenities',
          'bedrooms',
          'bathrooms',
          'squareFeet',
          'lotSizeAcres',
          'yearBuilt',
          'price',
          '_geo'
        ],
        sortableAttributes: ['price', 'updatedEpoch', '_geo']
      })
    });
    await this.waitForMeiliTask(settingsTask.taskUid);
    const documentTask = await this.meili('/indexes/houses/documents?primaryKey=id', {
      method: 'POST',
      body: JSON.stringify(docs.map(toMeiliDocument))
    });
    await this.waitForMeiliTask(documentTask.taskUid);
  }

  private async backfillTypesense(docs: HouseSearchDocument[]) {
    try {
      await this.typesense('/collections/houses', { method: 'DELETE' });
    } catch {
      // Collection may not exist on first run.
    }
    await this.typesense('/collections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'houses',
        fields: [
          { name: 'id', type: 'string' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'semanticText', type: 'string' },
          { name: 'city', type: 'string' },
          { name: 'neighborhood', type: 'string', optional: true },
          { name: 'schoolDistrict', type: 'string', optional: true },
          { name: 'amenities', type: 'string[]', facet: true },
          { name: 'tags', type: 'string[]', optional: true },
          { name: 'cityFacet', type: 'string', facet: true },
          { name: 'neighborhoodFacet', type: 'string', facet: true, optional: true },
          { name: 'schoolDistrictFacet', type: 'string', facet: true, optional: true },
          { name: 'propertyTypeFacet', type: 'string', facet: true },
          { name: 'listingStatusFacet', type: 'string', facet: true },
          { name: 'bedrooms', type: 'int32', facet: true },
          { name: 'bathrooms', type: 'float', facet: true },
          { name: 'squareFeet', type: 'int32', facet: true },
          { name: 'lotSizeAcres', type: 'float', facet: true, optional: true },
          { name: 'yearBuilt', type: 'int32', facet: true, optional: true },
          { name: 'price', type: 'int32', sort: true },
          { name: 'updatedEpoch', type: 'int64', sort: true },
          { name: 'location', type: 'geopoint' },
          { name: '.*', type: 'auto', optional: true }
        ],
        default_sorting_field: 'price'
      })
    });
    const ndjson = docs.map((doc) => JSON.stringify(toTypesenseDocument(doc))).join('\n');
    await this.typesense('/collections/houses/documents/import?action=upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: ndjson
    });
  }

  private async upsertExternal(provider: ExternalProvider, doc: HouseSearchDocument) {
    if (provider === 'meilisearch') {
      const task = await this.meili('/indexes/houses/documents?primaryKey=id', {
        method: 'POST',
        body: JSON.stringify([toMeiliDocument(doc)])
      });
      await this.waitForMeiliTask(task.taskUid);
    } else {
      await this.typesense('/collections/houses/documents?action=upsert', {
        method: 'POST',
        body: JSON.stringify(toTypesenseDocument(doc))
      });
    }
  }

  private async deleteExternal(provider: ExternalProvider, id: string) {
    if (provider === 'meilisearch') {
      const task = await this.meili(`/indexes/houses/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await this.waitForMeiliTask(task.taskUid);
    } else {
      try {
        await this.typesense(`/collections/houses/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('404')) throw error;
      }
    }
  }

  private async waitForMeiliTask(taskUid: number | undefined) {
    if (taskUid === undefined) return;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const task = await this.meili(`/tasks/${taskUid}`);
      if (task.status === 'succeeded') return;
      if (task.status === 'failed' || task.status === 'canceled') throw new Error(`Meilisearch task ${taskUid} ${task.status}: ${task.error?.message ?? 'unknown error'}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for Meilisearch task ${taskUid}`);
  }

  private async searchMeili(request: HouseSearchRequest, houses: House[], cities: City[], neighborhoods: Neighborhood[]): Promise<ExternalSearchResult> {
    const rawRequest = {
      q: request.q ?? '',
      filter: this.meiliFilters(request),
      facets: ['cityFacet', 'neighborhoodFacet', 'schoolDistrictFacet', 'propertyTypeFacet', 'bedrooms', 'amenities', 'listingStatusFacet'],
      sort: this.meiliSort(request),
      page: request.page,
      hitsPerPage: request.pageSize
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
    return {
      hits,
      totalHits: rawResponse.estimatedTotalHits ?? rawResponse.totalHits ?? hits.length,
      facets: this.meiliFacetDistribution(rawResponse.facetDistribution ?? {}),
      debug: {
        rawRequest,
        rawResponse,
        warnings: request.mode !== 'keyword' ? ['Meilisearch semantic/hybrid query requires a configured embedder; this demo sends keyword query text and records the requested mode.'] : []
      }
    };
  }

  private async searchTypesense(request: HouseSearchRequest, houses: House[], cities: City[], neighborhoods: Neighborhood[]): Promise<ExternalSearchResult> {
    const rawRequest = {
      q: request.q?.trim() || '*',
      query_by: request.mode === 'semantic' ? 'semanticText' : 'title,description,semanticText,city,neighborhood,schoolDistrict,amenities,tags',
      filter_by: this.typesenseFilters(request),
      facet_by: 'cityFacet,neighborhoodFacet,schoolDistrictFacet,propertyTypeFacet,bedrooms,amenities,listingStatusFacet',
      sort_by: this.typesenseSort(request),
      page: request.page,
      per_page: request.pageSize,
      max_facet_values: 20
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
    return {
      hits,
      totalHits: rawResponse.found ?? hits.length,
      facets: this.typesenseFacetCounts(rawResponse.facet_counts ?? []),
      debug: {
        rawRequest,
        rawResponse,
        warnings: request.mode !== 'keyword' ? ['Typesense semantic/hybrid mode is represented through semanticText in this local schema unless an embedding field is configured.'] : []
      }
    };
  }

  private meiliFilters(request: HouseSearchRequest): string[] {
    const filters: string[] = [];
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
    if (request.filters.minPrice) filters.push(`price >= ${request.filters.minPrice}`);
    if (request.filters.maxPrice) filters.push(`price <= ${request.filters.maxPrice}`);
    if (request.filters.minBedrooms) filters.push(`bedrooms >= ${request.filters.minBedrooms}`);
    if (request.filters.minBathrooms) filters.push(`bathrooms >= ${request.filters.minBathrooms}`);
    if (request.filters.minSquareFeet) filters.push(`squareFeet >= ${request.filters.minSquareFeet}`);
    if (request.filters.minYearBuilt) filters.push(`yearBuilt >= ${request.filters.minYearBuilt}`);
    if (request.filters.maxYearBuilt) filters.push(`yearBuilt <= ${request.filters.maxYearBuilt}`);
    if (request.filters.minLotSize) filters.push(`lotSizeAcres >= ${request.filters.minLotSize}`);
    if (request.filters.maxLotSize) filters.push(`lotSizeAcres <= ${request.filters.maxLotSize}`);
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

  private typesenseFilters(request: HouseSearchRequest): string {
    const filters: string[] = [];
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
    if (request.filters.minPrice) filters.push(`price:>=${request.filters.minPrice}`);
    if (request.filters.maxPrice) filters.push(`price:<=${request.filters.maxPrice}`);
    if (request.filters.minBedrooms) filters.push(`bedrooms:>=${request.filters.minBedrooms}`);
    if (request.filters.minBathrooms) filters.push(`bathrooms:>=${request.filters.minBathrooms}`);
    if (request.filters.minSquareFeet) filters.push(`squareFeet:>=${request.filters.minSquareFeet}`);
    if (request.filters.minYearBuilt) filters.push(`yearBuilt:>=${request.filters.minYearBuilt}`);
    if (request.filters.maxYearBuilt) filters.push(`yearBuilt:<=${request.filters.maxYearBuilt}`);
    if (request.filters.minLotSize) filters.push(`lotSizeAcres:>=${request.filters.minLotSize}`);
    if (request.filters.maxLotSize) filters.push(`lotSizeAcres:<=${request.filters.maxLotSize}`);
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
    return request.q?.trim() ? '_text_match:desc' : undefined;
  }

  private typesenseValue(value: string) {
    return value.includes(' ') ? `\`${value}\`` : value;
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
      const city = cities.find((candidate) => candidate.id === house.cityId)!;
      const neighborhood = neighborhoods.find((candidate) => candidate.id === house.neighborhoodId);
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
    typesenseKey: process.env.TYPESENSE_API_KEY ?? 'dev_typesense_api_key'
  };
}
