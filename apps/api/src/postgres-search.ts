import type pg from 'pg';
import type { FacetBucket, HouseSearchHit, HouseSearchMapHit, HouseSearchRequest } from '../../../packages/search-contracts/src/search-provider.interface.js';
import { embedTexts, EMBEDDING_MODEL_KEY, EmbeddingUnavailableError, MIN_SEMANTIC_SIMILARITY } from './embeddings.js';

/** Transactional PostgreSQL search projection. It is refreshed in the source
 * transaction; no worker, Node scan, or external index is involved in FTS. */
export const POSTGRES_SEARCH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS house_search_documents (
    house_id text PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,
    search_text text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, search_text)) STORED
  );
  CREATE INDEX IF NOT EXISTS house_search_documents_fts_idx
    ON house_search_documents USING gin(search_vector);

  CREATE OR REPLACE FUNCTION refresh_house_search_document(target_id text) RETURNS void AS $$
  BEGIN
    INSERT INTO house_search_documents(house_id, search_text)
    SELECT h.id, lower(concat_ws(' ', nullif(h.title, ''), nullif(h.description, ''), nullif(c.name, ''),
      nullif(n.name, ''), nullif(h.school_district, ''), nullif(replace(h.property_type, '_', ' '), ''),
      (SELECT string_agg(amenity, ' ' ORDER BY amenity COLLATE "C") FROM house_amenities WHERE house_id=h.id),
      (SELECT string_agg(tag, ' ' ORDER BY tag COLLATE "C") FROM house_tags WHERE house_id=h.id)))
    FROM houses h JOIN cities c ON c.id=h.city_id LEFT JOIN neighborhoods n ON n.id=h.neighborhood_id
    WHERE h.id=target_id AND h.deleted_at IS NULL
    ON CONFLICT(house_id) DO UPDATE SET search_text=EXCLUDED.search_text
      WHERE house_search_documents.search_text IS DISTINCT FROM EXCLUDED.search_text;
    DELETE FROM house_search_documents s WHERE s.house_id=target_id
      AND NOT EXISTS (SELECT 1 FROM houses h WHERE h.id=target_id AND h.deleted_at IS NULL);
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION capture_house_search_change() RETURNS trigger AS $$
  BEGIN
    IF TG_TABLE_NAME = 'houses' THEN
      IF TG_OP <> 'INSERT' THEN PERFORM refresh_house_search_document(OLD.id); END IF;
      IF TG_OP <> 'DELETE' THEN PERFORM refresh_house_search_document(NEW.id); END IF;
    ELSIF TG_TABLE_NAME IN ('house_tags', 'house_amenities') THEN
      IF TG_OP <> 'INSERT' THEN PERFORM refresh_house_search_document(OLD.house_id); END IF;
      IF TG_OP <> 'DELETE' THEN PERFORM refresh_house_search_document(NEW.house_id); END IF;
    ELSIF TG_TABLE_NAME = 'cities' THEN
      PERFORM refresh_house_search_document(id) FROM houses WHERE city_id=NEW.id;
    ELSIF TG_TABLE_NAME = 'neighborhoods' THEN
      PERFORM refresh_house_search_document(id) FROM houses WHERE neighborhood_id=NEW.id;
    END IF;
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION capture_house_search_truncate() RETURNS trigger AS $$
  BEGIN
    DELETE FROM house_search_documents s WHERE NOT EXISTS (SELECT 1 FROM houses h WHERE h.id=s.house_id AND h.deleted_at IS NULL);
    PERFORM refresh_house_search_document(id) FROM houses WHERE deleted_at IS NULL;
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS houses_search_change ON houses;
  CREATE TRIGGER houses_search_change AFTER INSERT OR UPDATE OR DELETE ON houses
    FOR EACH ROW EXECUTE FUNCTION capture_house_search_change();
  DROP TRIGGER IF EXISTS amenities_search_change ON house_amenities;
  CREATE TRIGGER amenities_search_change AFTER INSERT OR UPDATE OR DELETE ON house_amenities
    FOR EACH ROW EXECUTE FUNCTION capture_house_search_change();
  DROP TRIGGER IF EXISTS tags_search_change ON house_tags;
  CREATE TRIGGER tags_search_change AFTER INSERT OR UPDATE OR DELETE ON house_tags
    FOR EACH ROW EXECUTE FUNCTION capture_house_search_change();
  DROP TRIGGER IF EXISTS cities_search_change ON cities;
  CREATE TRIGGER cities_search_change AFTER UPDATE ON cities
    FOR EACH ROW EXECUTE FUNCTION capture_house_search_change();
  DROP TRIGGER IF EXISTS neighborhoods_search_change ON neighborhoods;
  CREATE TRIGGER neighborhoods_search_change AFTER UPDATE ON neighborhoods
    FOR EACH ROW EXECUTE FUNCTION capture_house_search_change();
  DROP TRIGGER IF EXISTS houses_search_truncate ON houses;
  CREATE TRIGGER houses_search_truncate AFTER TRUNCATE ON houses
    FOR EACH STATEMENT EXECUTE FUNCTION capture_house_search_truncate();
  DROP TRIGGER IF EXISTS amenities_search_truncate ON house_amenities;
  CREATE TRIGGER amenities_search_truncate AFTER TRUNCATE ON house_amenities
    FOR EACH STATEMENT EXECUTE FUNCTION capture_house_search_truncate();
  DROP TRIGGER IF EXISTS tags_search_truncate ON house_tags;
  CREATE TRIGGER tags_search_truncate AFTER TRUNCATE ON house_tags
    FOR EACH STATEMENT EXECUTE FUNCTION capture_house_search_truncate();

  SELECT refresh_house_search_document(id) FROM houses;

  -- Plain PostgreSQL remains a supported deployment. Selecting pg_search there
  -- fails explicitly. If its files are installed, initialization must succeed.
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_search') THEN
      CREATE EXTENSION IF NOT EXISTS pg_search CASCADE;
      CREATE INDEX IF NOT EXISTS house_search_documents_bm25_idx
        ON house_search_documents USING paradedb(house_id, search_text);
    END IF;
  END;
  $$;
`;

export type PostgresSearchMatch = HouseSearchHit;

export type PostgresSearchResult = {
  hits: PostgresSearchMatch[];
  mapHits: HouseSearchMapHit[];
  totalHits: number;
  facets: Record<string, FacetBucket[]>;
  debug: {
    sql: string;
    rawRequest: { parameters: unknown[] };
    rawResponse: { found: number; returned: number; mapHits: number };
    notes: string[];
  };
};

type SearchRow = {
  hits: PostgresSearchMatch[];
  map_hits: HouseSearchMapHit[];
  total_hits: number;
  facets: Record<string, FacetBucket[]>;
  invalid_embeddings: number;
};

/** Executes filtering, ranking, pagination, geo and facet aggregation in SQL.
 * All response sections read one MATERIALIZED matching relation in one MVCC
 * snapshot. scopeIds is already evaluated saved-search membership, not a page. */
export class PostgresSearch {
  constructor(private readonly pool: pg.Pool) {}

  async search(request: HouseSearchRequest, scopeIds?: readonly string[]): Promise<PostgresSearchResult> {
    if (request.provider !== 'postgres_native' && request.provider !== 'pg_search') throw new Error('PostgresSearch requires a PostgreSQL provider.');
    const bm25 = request.provider === 'pg_search';
    if (bm25) {
      const { rows } = await this.pool.query<{ ready: boolean }>(`SELECT
        EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_search')
        AND to_regclass('house_search_documents_bm25_idx') IS NOT NULL AS ready`);
      if (!rows[0].ready) throw new EmbeddingUnavailableError('pg_search is unavailable. Install and preload the pinned ParadeDB extension and initialize its BM25 index; no alternate engine was used.');
    }
    const q = request.q?.trim() ?? '';
    const semantic = !!q && request.mode !== 'keyword';
    const parameters: unknown[] = [];
    const param = (value: unknown, cast = '') => { parameters.push(value); return `$${parameters.length}${cast}`; };
    const queryParameter = q ? param(q, '::text') : undefined;
    const query = q && !bm25 ? `websearch_to_tsquery('english'::regconfig, ${queryParameter})` : 'NULL::tsquery';
    const vector = semantic ? param(`[${Array.from((await embedTexts([q]))[0]).join(',')}]`, '::vector') : undefined;
    const model = semantic ? param(EMBEDDING_MODEL_KEY, '::text') : undefined;
    const f = request.filters ?? {};
    const predicates = ['h.deleted_at IS NULL'];
    if (scopeIds !== undefined) predicates.push(`h.id = ANY(${param([...scopeIds], '::text[]')})`);
    const facets: Array<[keyof typeof f, string, string]> = [
      ['city', 'c.name', 'text'], ['neighborhood', 'n.name', 'text'],
      ['schoolDistrict', 'h.school_district', 'text'], ['propertyType', 'h.property_type', 'text'],
      ['listingStatus', 'h.listing_status', 'text'], ['bedrooms', 'h.bedrooms', 'integer']
    ];
    for (const [field, column, type] of facets) {
      const values = f[field];
      if (Array.isArray(values) && values.length) predicates.push(`${column} = ANY(${param(values, `::${type}[]`)})`);
    }
    const ranges: Array<[keyof typeof f, string, string]> = [
      ['minPrice', 'h.price', '>='], ['maxPrice', 'h.price', '<='], ['minBedrooms', 'h.bedrooms', '>='],
      ['minBathrooms', 'h.bathrooms', '>='], ['minSquareFeet', 'h.square_feet', '>='],
      ['minYearBuilt', 'h.year_built', '>='], ['maxYearBuilt', 'h.year_built', '<='],
      ['minLotSize', 'h.lot_size_acres', '>='], ['maxLotSize', 'h.lot_size_acres', '<=']
    ];
    for (const [field, column, operator] of ranges) {
      const value = f[field];
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`Invalid ${field} filter.`);
        predicates.push(`${column} ${operator} ${param(value, '::numeric')}`);
      }
    }
    if (f.amenities?.length) {
      predicates.push(`NOT EXISTS (SELECT 1 FROM unnest(${param(f.amenities, '::text[]')}) wanted(amenity)
        WHERE NOT EXISTS (SELECT 1 FROM house_amenities selected WHERE selected.house_id=h.id AND selected.amenity=wanted.amenity))`);
    }
    if (request.viewport) {
      const v = request.viewport;
      if (![v.minLat, v.maxLat, v.minLng, v.maxLng].every(Number.isFinite)) throw new Error('Invalid viewport.');
      predicates.push(`h.lat BETWEEN ${param(v.minLat, '::float8')} AND ${param(v.maxLat, '::float8')}`);
      const minLng = param(v.minLng, '::float8'); const maxLng = param(v.maxLng, '::float8');
      // A viewport may cross the antimeridian.
      predicates.push(v.minLng <= v.maxLng ? `h.lng BETWEEN ${minLng} AND ${maxLng}` : `(h.lng >= ${minLng} OR h.lng <= ${maxLng})`);
    }
    let distance = 'NULL::float8';
    if (request.geo) {
      const { lat, lng, radiusMiles } = request.geo;
      if (![lat, lng, radiusMiles].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || radiusMiles < 0) throw new Error('Invalid geographic radius.');
      const latitude = param(lat, '::float8'); const longitude = param(lng, '::float8');
      distance = `3958.8 * 2 * asin(sqrt(least(1::float8, greatest(0::float8,
        power(sin(radians(h.lat - ${latitude}) / 2), 2) + cos(radians(${latitude})) * cos(radians(h.lat)) * power(sin(radians(h.lng - ${longitude}) / 2), 2)))))`;
      predicates.push(`(${distance}) <= ${param(radiusMiles, '::float8')}`);
    }
    if (q && request.mode === 'keyword') predicates.push(bm25 ? 'lex.house_id IS NOT NULL' : 's.search_vector @@ query_input.terms');
    const page = Number.isFinite(request.page) ? Math.max(1, Math.floor(request.page)) : 1;
    const pageSize = Number.isFinite(request.pageSize) ? Math.max(1, Math.min(50, Math.floor(request.pageSize))) : 12;
    const limit = param(pageSize, '::integer'); const offset = param((page - 1) * pageSize, '::bigint');
    const order = {
      relevance: 'score DESC, updated_at DESC, id ASC', distance: 'distance_miles ASC NULLS LAST, id ASC',
      price_asc: 'price ASC, id ASC', price_desc: 'price DESC, id ASC', newest: 'updated_at DESC, id ASC'
    }[request.sort] ?? 'score DESC, updated_at DESC, id ASC';
    // The worker hashes canonical Node text for cache/idempotency. Search uses the
    // transactionally fenced source generation instead of duplicating JS Unicode
    // trim/lowercase/UTF-16 truncation rules in SQL.
    const current = semantic ? `(e.model_key = ${model} AND e.source_version = w.desired_version)` : 'true';
    const similarity = semantic ? `CASE WHEN ${current} THEN 1 - (e.embedding <=> ${vector}) ELSE NULL END` : 'NULL::float8';
    const score = !q ? '20::float8' : request.mode === 'keyword' ? 'keyword_score * 100'
      : request.mode === 'semantic' ? 'similarity * 100' : 'keyword_score * 55 + greatest(0, similarity) * 45';
    const match = !q || request.mode === 'keyword' ? 'true' : request.mode === 'semantic'
      ? `similarity >= ${MIN_SEMANTIC_SIMILARITY}` : `(keyword_match OR similarity >= ${MIN_SEMANTIC_SIMILARITY})`;
    const facetSql = request.includeFacets ? `
      facet_values AS (
        SELECT kv.field, kv.value FROM matching m CROSS JOIN LATERAL (VALUES
          ('city', m.city), ('neighborhood', m.neighborhood), ('schoolDistrict', m.school_district),
          ('propertyType', m.property_type), ('listingStatus', m.listing_status), ('bedrooms', m.bedrooms::text)
        ) kv(field,value) WHERE kv.value IS NOT NULL
        UNION ALL SELECT 'amenities', amenity FROM matching m JOIN house_amenities ha ON ha.house_id=m.id
      ),
      facet_counts AS (SELECT field,value,count(*)::integer AS count FROM facet_values GROUP BY field,value),
      facet_ranks AS (SELECT *, row_number() OVER(PARTITION BY field ORDER BY count DESC,value COLLATE "C") AS position FROM facet_counts),
      facet_groups AS (SELECT field,jsonb_agg(jsonb_build_object('value',value,'count',count) ORDER BY count DESC,value COLLATE "C") AS buckets
        FROM facet_ranks WHERE position<=20 GROUP BY field),` : '';
    // pdb.score must be evaluated in the same real BM25 scan as the ||| predicate.
    // Materializing this relation preserves that context before relational joins.
    const lexical = bm25 && !!q;
    const sql = `WITH query_input AS (SELECT ${query} AS terms),
      ${lexical ? `lexical AS MATERIALIZED (SELECT house_id,pdb.score(house_id) AS raw_score
        FROM house_search_documents WHERE search_text ||| ${queryParameter}),` : ''}
      candidates AS MATERIALIZED (
        SELECT h.id,h.title,h.description,h.city_id,h.neighborhood_id,h.address_line_1,h.zip_code,
          h.lat,h.lng,h.price,h.bedrooms,h.bathrooms,h.square_feet,h.lot_size_acres,h.year_built,
          h.school_district,h.property_type,h.listing_status,h.created_at,h.updated_at,s.search_text AS semantic_text,
          COALESCE((SELECT jsonb_agg(amenity ORDER BY amenity) FROM house_amenities WHERE house_id=h.id),'[]'::jsonb) AS amenities,
          COALESCE((SELECT jsonb_agg(tag ORDER BY tag) FROM house_tags WHERE house_id=h.id),'[]'::jsonb) AS tags,
          c.name AS city,n.name AS neighborhood,${distance} AS distance_miles,
          ${q ? bm25 ? 'lex.house_id IS NOT NULL' : 's.search_vector @@ query_input.terms' : 'false'} AS keyword_match,
          ${q ? bm25 ? 'COALESCE(lex.raw_score / (1 + lex.raw_score), 0)' : 'ts_rank(s.search_vector, query_input.terms, 32)' : '0::float4'} AS keyword_score,
          ${current} AS embedding_current,${similarity} AS similarity
        FROM houses h JOIN cities c ON c.id=h.city_id
        LEFT JOIN neighborhoods n ON n.id=h.neighborhood_id
        JOIN house_search_documents s ON s.house_id=h.id
        ${lexical ? 'LEFT JOIN lexical lex ON lex.house_id=h.id' : ''}
        ${semantic ? 'LEFT JOIN house_embeddings e ON e.house_id=h.id LEFT JOIN house_embedding_work w ON w.house_id=h.id' : ''}
        CROSS JOIN query_input WHERE ${predicates.join('\n          AND ')}
      ),
      invalid AS (SELECT count(*)::integer AS count FROM candidates WHERE embedding_current IS NOT TRUE OR ${semantic ? "similarity IS NULL OR similarity::text IN ('NaN','Infinity','-Infinity')" : 'false'}),
      matching AS MATERIALIZED (
        SELECT *,${score} AS score FROM candidates WHERE (${match}) AND (SELECT count FROM invalid)=0
      ),
      ordered AS (SELECT *,row_number() OVER(ORDER BY ${order}) AS position FROM matching),
      paginated AS (SELECT * FROM ordered ORDER BY position LIMIT ${limit} OFFSET ${offset}),
      ${facetSql}
      result AS (SELECT
        (SELECT count(*)::integer FROM matching) AS total_hits,
        (SELECT count FROM invalid) AS invalid_embeddings,
        COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'score',score,
          'semanticScore',similarity,'distanceMiles',distance_miles,'matchedTerms',jsonb_build_array(),
          'title',title,'description',description,'cityId',city_id,'neighborhoodId',neighborhood_id,
          'addressLine1',address_line_1,'zipCode',zip_code,'lat',lat,'lng',lng,'price',price,'bedrooms',bedrooms,
          'bathrooms',bathrooms,'squareFeet',square_feet,'lotSizeAcres',lot_size_acres,'yearBuilt',year_built,
          'schoolDistrict',school_district,'propertyType',property_type,'listingStatus',listing_status,
          'createdAt',created_at,'updatedAt',updated_at,'city',city,'neighborhood',neighborhood,
          'amenities',amenities,'tags',tags,'semanticText',semantic_text)) ORDER BY position) FROM paginated), '[]'::jsonb) AS hits,
        ${request.includeMap === false ? "'[]'::jsonb" : `COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'title',title,'lat',lat,'lng',lng,'price',price,
          'city',city,'neighborhood',neighborhood,'propertyType',property_type,'listingStatus',listing_status)) ORDER BY position) FROM ordered), '[]'::jsonb)`} AS map_hits,
        ${request.includeFacets ? `jsonb_build_object('city','[]'::jsonb,'neighborhood','[]'::jsonb,'schoolDistrict','[]'::jsonb,
          'propertyType','[]'::jsonb,'listingStatus','[]'::jsonb,'bedrooms','[]'::jsonb,'amenities','[]'::jsonb)
          || COALESCE((SELECT jsonb_object_agg(field,buckets) FROM facet_groups),'{}'::jsonb)` : "'{}'::jsonb"} AS facets)
      SELECT * FROM result`;
    const { rows } = await this.pool.query<SearchRow>(sql, parameters);
    const row = rows[0];
    if (row.invalid_embeddings) throw new EmbeddingUnavailableError(`Document embeddings are pending, outdated or invalid for ${row.invalid_embeddings} filtered house(s). Wait for the CPU queue or use keyword mode.`);
    return {
      hits: row.hits, mapHits: row.map_hits, totalHits: row.total_hits, facets: row.facets,
      debug: { sql, rawRequest: { parameters }, rawResponse: { found: row.total_hits, returned: row.hits.length, mapHits: row.map_hits.length },
        notes: [`PostgreSQL executes ${bm25 ? 'ParadeDB pg_search BM25 matching and ranking' : 'English full-text matching and ts_rank'}${semantic ? ', pgvector cosine scoring' : ''}, filters, ordering, facets and pagination. Geo uses SQL spherical haversine distance in miles, not PostGIS.`,
          ...(semantic ? [`Exact pgvector cosine scan; no ANN index or approximate candidate truncation. Hybrid weights normalized ${bm25 ? 'BM25 (score/(1+score))' : 'ts_rank'} 55% and nonnegative cosine 45%.`] : [])] }
    };
  }
}
