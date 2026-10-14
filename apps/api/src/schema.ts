import { POSTGRES_SEARCH_SCHEMA_SQL } from './postgres-search.js';
import { EMBEDDING_QUEUE_SQL } from './embedding-queue.sql.js';
/** Single source for schema creation and the read-only schema inspector.
 * This describes application DDL, never a live database inspection.
 */
export const DATABASE_SCHEMA_SQL = `
      CREATE EXTENSION IF NOT EXISTS vector;
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

      CREATE SEQUENCE IF NOT EXISTS house_embedding_version;

      CREATE TABLE IF NOT EXISTS house_embedding_work (
        house_id text PRIMARY KEY,
        desired_version bigint NOT NULL DEFAULT nextval('house_embedding_version'),
        completed_version bigint NOT NULL DEFAULT 0,
        job_id bigint,
        dispatched_version bigint,
        attempted_version bigint,
        attempt_read_ct integer,
        attempt_state text,
        lease_expires_at timestamptz,
        last_heartbeat_at timestamptz,
        failed_version bigint,
        last_error text,
        last_attempt_at timestamptz,
        last_success_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS house_embeddings (
        house_id text PRIMARY KEY REFERENCES houses(id) ON DELETE CASCADE,
        model_key text NOT NULL,
        content_hash text NOT NULL,
        embedding vector(384) NOT NULL,
        model jsonb NOT NULL,
        source_version bigint NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS house_embedding_work_dirty_idx ON house_embedding_work(desired_version, completed_version);

      -- Change capture only. No inference or remote calls occur in a source transaction.
      CREATE OR REPLACE FUNCTION invalidate_house_embedding(target_id text) RETURNS void AS $$
      BEGIN
        INSERT INTO house_embedding_work (house_id) VALUES (target_id)
        ON CONFLICT (house_id) DO UPDATE
          SET desired_version = nextval('house_embedding_version'), updated_at = now();
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION capture_house_embedding_change() RETURNS trigger AS $$
      BEGIN
        IF TG_TABLE_NAME = 'houses' THEN
          IF TG_OP <> 'INSERT' THEN PERFORM invalidate_house_embedding(OLD.id); END IF;
          IF TG_OP <> 'DELETE' THEN PERFORM invalidate_house_embedding(NEW.id); END IF;
          -- A soft delete must immediately make a persisted vector unavailable.
          IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
            DELETE FROM house_embeddings WHERE house_id = NEW.id;
          END IF;
        ELSIF TG_TABLE_NAME IN ('house_tags', 'house_amenities') THEN
          IF TG_OP <> 'INSERT' THEN PERFORM invalidate_house_embedding(OLD.house_id); END IF;
          IF TG_OP <> 'DELETE' THEN PERFORM invalidate_house_embedding(NEW.house_id); END IF;
        ELSIF TG_TABLE_NAME = 'cities' THEN
          PERFORM invalidate_house_embedding(id) FROM houses WHERE city_id = NEW.id;
        ELSIF TG_TABLE_NAME = 'neighborhoods' THEN
          PERFORM invalidate_house_embedding(id) FROM houses WHERE neighborhood_id = NEW.id;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION capture_house_embedding_truncate() RETURNS trigger AS $$
      BEGIN
        UPDATE house_embedding_work SET desired_version = nextval('house_embedding_version'), updated_at = now();
        INSERT INTO house_embedding_work (house_id) SELECT id FROM houses ON CONFLICT DO NOTHING;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS houses_embedding_change ON houses;
      CREATE TRIGGER houses_embedding_change AFTER INSERT OR UPDATE OR DELETE ON houses
        FOR EACH ROW EXECUTE FUNCTION capture_house_embedding_change();
      DROP TRIGGER IF EXISTS amenities_embedding_change ON house_amenities;
      CREATE TRIGGER amenities_embedding_change AFTER INSERT OR UPDATE OR DELETE ON house_amenities
        FOR EACH ROW EXECUTE FUNCTION capture_house_embedding_change();
      DROP TRIGGER IF EXISTS tags_embedding_change ON house_tags;
      CREATE TRIGGER tags_embedding_change AFTER INSERT OR UPDATE OR DELETE ON house_tags
        FOR EACH ROW EXECUTE FUNCTION capture_house_embedding_change();
      DROP TRIGGER IF EXISTS cities_embedding_change ON cities;
      CREATE TRIGGER cities_embedding_change AFTER UPDATE ON cities
        FOR EACH ROW EXECUTE FUNCTION capture_house_embedding_change();
      DROP TRIGGER IF EXISTS neighborhoods_embedding_change ON neighborhoods;
      CREATE TRIGGER neighborhoods_embedding_change AFTER UPDATE ON neighborhoods
        FOR EACH ROW EXECUTE FUNCTION capture_house_embedding_change();
      DROP TRIGGER IF EXISTS houses_embedding_truncate ON houses;
      CREATE TRIGGER houses_embedding_truncate AFTER TRUNCATE ON houses
        FOR EACH STATEMENT EXECUTE FUNCTION capture_house_embedding_truncate();
      DROP TRIGGER IF EXISTS amenities_embedding_truncate ON house_amenities;
      CREATE TRIGGER amenities_embedding_truncate AFTER TRUNCATE ON house_amenities
        FOR EACH STATEMENT EXECUTE FUNCTION capture_house_embedding_truncate();
      DROP TRIGGER IF EXISTS tags_embedding_truncate ON house_tags;
      CREATE TRIGGER tags_embedding_truncate AFTER TRUNCATE ON house_tags
        FOR EACH STATEMENT EXECUTE FUNCTION capture_house_embedding_truncate();

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
      ${EMBEDDING_QUEUE_SQL}
      ${POSTGRES_SEARCH_SCHEMA_SQL}
    `;

export function describeSchema(storageMode: 'memory' | 'postgres') {
  const tables = [...DATABASE_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\);/g)].map((match) => {
    const definitions = match[2].trim().split(/,\n\s*/);
    const constraints = definitions.filter((line) => /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/.test(line));
    const primaryColumns = new Set(constraints.flatMap((constraint) => constraint.match(/^PRIMARY KEY\s*\(([^)]+)\)/)?.[1].split(',').map((name) => name.trim()) ?? []));
    const columns = definitions.filter((line) => !constraints.includes(line)).map((definition) => {
      const [, name, typeAndConstraints] = definition.match(/^(\w+)\s+([\s\S]+)$/)!;
      const type = typeAndConstraints.split(/\s+(?:PRIMARY|NOT|REFERENCES|DEFAULT|CHECK|UNIQUE|GENERATED)\b/)[0];
      const reference = definition.match(/REFERENCES (\w+)\((\w+)\)/);
      const primaryKey = /PRIMARY KEY/.test(definition) || primaryColumns.has(name);
      return { name, type, nullable: !primaryKey && !/NOT NULL/.test(definition), primaryKey, reference: reference ? `${reference[1]}.${reference[2]}` : undefined, definition };
    });
    const indexes = [...DATABASE_SCHEMA_SQL.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)\s+ON (\w+)(?:\s+USING (\w+))?\s*\(([^;]+)\);/g)]
      .filter((index) => index[2] === match[1])
      .map((index) => ({ name: index[1], columns: index[4], definition: index[0] }));
    return { name: match[1], columns, constraints, indexes, ddl: match[0] };
  });
  return {
    source: 'application-ddl' as const,
    storageMode,
    observedAt: new Date().toISOString(),
    liveIntrospection: false,
    note: storageMode === 'memory'
      ? 'Demo data is held in memory. These tables describe the optional PostgreSQL implementation, not a connected database.'
      : 'Declared application schema used by schema initialization. Live database drift, installed extensions and index health have not been inspected.',
    tables
  };
}
