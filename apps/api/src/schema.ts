/** Single source for schema creation and the read-only schema inspector.
 * This describes application DDL, never a live database inspection.
 */
export const DATABASE_SCHEMA_SQL = `
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
    `;

export function describeSchema(storageMode: 'memory' | 'postgres') {
  const tables = [...DATABASE_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n      \);/g)].map((match) => {
    const definitions = match[2].trim().split(/,\n\s*/);
    const constraints = definitions.filter((line) => /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/.test(line));
    const primaryColumns = new Set(constraints.flatMap((constraint) => constraint.match(/^PRIMARY KEY\s*\(([^)]+)\)/)?.[1].split(',').map((name) => name.trim()) ?? []));
    const columns = definitions.filter((line) => !constraints.includes(line)).map((definition) => {
      const [, name, typeAndConstraints] = definition.match(/^(\w+)\s+([\s\S]+)$/)!;
      const type = typeAndConstraints.split(/\s+(?:PRIMARY|NOT|REFERENCES|DEFAULT|CHECK|UNIQUE)\b/)[0];
      const reference = definition.match(/REFERENCES (\w+)\((\w+)\)/);
      const primaryKey = /PRIMARY KEY/.test(definition) || primaryColumns.has(name);
      return { name, type, nullable: !primaryKey && !/NOT NULL/.test(definition), primaryKey, reference: reference ? `${reference[1]}.${reference[2]}` : undefined, definition };
    });
    const indexes = [...DATABASE_SCHEMA_SQL.matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)\(([^;]+)\);/g)]
      .filter((index) => index[2] === match[1])
      .map((index) => ({ name: index[1], columns: index[3], definition: index[0] }));
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
