# PostgreSQL Sync Pipeline

Complete guide for syncing PostgreSQL to Typesense or Meilisearch using the outbox pattern.

## Contents

- [Core Architecture](#core-architecture)
- [Why Flatten Data](#why-flatten-data)
- [PostgreSQL Schema](#postgresql-schema)
- [Sync Tracking Schema](#sync-tracking-schema)
- [Triggering Sync Events](#triggering-sync-events)
- [Document Transformation](#document-transformation)
- [Engine-Specific Documents](#engine-specific-documents)
- [Search Engine Configuration](#search-engine-configuration)
- [Sync Worker Implementation](#sync-worker-implementation)
- [Upserting Documents](#upserting-documents)
- [Full Backfill Pipeline](#full-backfill-pipeline)
- [Incremental Sync](#incremental-sync)
- [Handling Related Changes](#handling-related-changes)
- [Delete Handling](#delete-handling)
- [Vector Update Optimization](#vector-update-optimization)
- [Document Versioning](#document-versioning)
- [Best Practices](#best-practices)

## Core Architecture

If PostgreSQL is the source of truth and Typesense or Meilisearch is used for search, do not try to make the search engine your primary database.

### Recommended Architecture

```
PostgreSQL
  ├─ Normalized source of truth
  └─ Relational data with referential integrity

Sync Pipeline
  ├─ Detects changed records
  ├─ Builds flattened search documents
  ├─ Upserts/deletes search documents
  └─ Retries failed sync work

Typesense or Meilisearch
  ├─ Denormalized search index
  ├─ Full-text search
  ├─ Facets
  ├─ Geo search
  ├─ Semantic/hybrid search
  └─ Autocomplete

Angular/React App
  ├─ Reads search results from search engine
  └─ Reads authoritative detail pages from PostgreSQL/API
```

### What Belongs in Search Engine

The search engine should contain just enough flattened data to support:

✅ **Include:**
- Search results
- Filters and facets
- Sorting
- Autocomplete
- Saved search evaluation
- Result cards

❌ **Don't include:**
- User authentication data
- Payment information
- Private notes
- Audit trails
- Binary data (images, PDFs)
- Frequently changing metadata

## Why Flatten Data

### PostgreSQL: Normalized Relational Data

```sql
-- Normalized (good for writes, consistency)
houses
cities
neighborhoods
schools
house_amenities
house_tags
listing_agents
saved_searches
```

**Pros:**
- No duplication
- Easy to update
- Referential integrity
- Transactional consistency

**Cons:**
- Requires joins for queries
- Complex query patterns
- Slower for reads

### Search Engine: Self-Contained Documents

```
one document = one searchable house
```

**Pros:**
- Fast search (no joins)
- Self-contained
- Optimized for reads

**Cons:**
- Data duplication
- Must sync changes
- Eventually consistent

A search engine should not need to join `houses → cities → neighborhoods → tags → amenities` on every query. Instead, those joins happen during indexing, and the search engine receives a pre-built document.

## PostgreSQL Schema

Practical normalized schema for the housing example:

### Cities Table

```sql
CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL,
  county text,
  center_lat double precision,
  center_lng double precision,
  population integer,
  median_home_price integer,
  school_rating_avg numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cities_name_state_idx ON cities (name, state);
CREATE INDEX cities_updated_at_idx ON cities (updated_at);
```

### Neighborhoods Table

```sql
CREATE TABLE neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id),
  name text NOT NULL,
  center_lat double precision,
  center_lng double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX neighborhoods_city_id_idx ON neighborhoods (city_id);
CREATE INDEX neighborhoods_name_idx ON neighborhoods (name);
```

### Houses Table

```sql
CREATE TABLE houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  title text NOT NULL,
  description text,

  address_line_1 text,
  city_id uuid NOT NULL REFERENCES cities(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
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
  elementary_school text,
  middle_school text,
  high_school text,

  hoa_fee integer,
  days_on_market integer,

  listed_at timestamptz,
  sold_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX houses_city_id_idx ON houses (city_id);
CREATE INDEX houses_neighborhood_id_idx ON houses (neighborhood_id);
CREATE INDEX houses_listing_status_idx ON houses (listing_status);
CREATE INDEX houses_updated_at_idx ON houses (updated_at);
CREATE INDEX houses_deleted_at_idx ON houses (deleted_at) WHERE deleted_at IS NULL;
```

### House Amenities Table

```sql
CREATE TABLE house_amenities (
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  amenity text NOT NULL,
  PRIMARY KEY (house_id, amenity)
);

CREATE INDEX house_amenities_house_id_idx ON house_amenities (house_id);
```

Example amenities:
```
pool, garage, basement, fenced_yard, waterfront, new_construction,
mountain_view, near_trails, home_office, cul_de_sac
```

### House Tags Table

```sql
CREATE TABLE house_tags (
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (house_id, tag)
);

CREATE INDEX house_tags_house_id_idx ON house_tags (house_id);
```

Example tags:
```
family_friendly, starter_home, luxury, low_maintenance, walkable,
near_research_park, good_schools, quiet_area
```

## Sync Tracking Schema

Two good sync approaches:

1. **Polling based on `updated_at`** - Simple but misses some changes
2. **Outbox table** - Explicit, retryable, inspectable (recommended)

### Search Sync Outbox Table

```sql
CREATE TABLE search_sync_outbox (
  id bigserial PRIMARY KEY,

  entity_type text NOT NULL,
  entity_id uuid NOT NULL,

  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),

  reason text,
  payload jsonb,

  attempts integer NOT NULL DEFAULT 0,
  last_error text,

  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_sync_outbox_pending_idx 
ON search_sync_outbox (available_at, id) 
WHERE processed_at IS NULL;

CREATE INDEX search_sync_outbox_entity_idx 
ON search_sync_outbox (entity_type, entity_id);
```

### Example Outbox Rows

```
| entity_type | entity_id  | operation | reason            |
|-------------|------------|-----------|-------------------|
| house       | house_1001 | upsert    | house_updated     |
| house       | house_1002 | delete    | house_deleted     |
| house       | house_1003 | upsert    | city_changed      |
| house       | house_1004 | upsert    | amenities_changed |
```

### Why Use an Outbox?

❌ **Fragile pattern (don't do this):**

```typescript
// API request
await db.query('UPDATE houses SET ...');
await typesense.upsert(...); // If this fails, search is stale!
```

✅ **Reliable pattern (do this):**

```typescript
// API request - single transaction
await db.query('BEGIN');
await db.query('UPDATE houses SET ...');
await db.query('INSERT INTO search_sync_outbox ...');
await db.query('COMMIT');

// Background worker (separate process)
const event = await fetchNextOutboxEvent();
const document = await buildSearchDocument(event.entity_id);
await typesense.upsert(document);
await markOutboxEventProcessed(event.id);
```

**Benefits:**
- Transactional safety
- Automatic retries
- Observability
- Recovery after failures
- Decoupled sync pipeline

## Triggering Sync Events

Whenever a house changes, enqueue a search sync event.

### House Trigger Function

```sql
CREATE OR REPLACE FUNCTION enqueue_house_search_sync()
RETURNS trigger AS $$
BEGIN
  INSERT INTO search_sync_outbox (
    entity_type,
    entity_id,
    operation,
    reason
  )
  VALUES (
    'house',
    COALESCE(NEW.id, OLD.id),
    CASE
      WHEN TG_OP = 'DELETE' THEN 'delete'
      WHEN NEW.deleted_at IS NOT NULL THEN 'delete'
      ELSE 'upsert'
    END,
    TG_OP
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER houses_search_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON houses
FOR EACH ROW
EXECUTE FUNCTION enqueue_house_search_sync();
```

### Related Tables Trigger

For amenities and tags, enqueue the affected house:

```sql
CREATE OR REPLACE FUNCTION enqueue_related_house_search_sync()
RETURNS trigger AS $$
BEGIN
  INSERT INTO search_sync_outbox (
    entity_type,
    entity_id,
    operation,
    reason
  )
  VALUES (
    'house',
    COALESCE(NEW.house_id, OLD.house_id),
    'upsert',
    TG_TABLE_NAME || '_' || TG_OP
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER house_amenities_search_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON house_amenities
FOR EACH ROW
EXECUTE FUNCTION enqueue_related_house_search_sync();

CREATE TRIGGER house_tags_search_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON house_tags
FOR EACH ROW
EXECUTE FUNCTION enqueue_related_house_search_sync();
```

### City/Neighborhood Changes

If a city or neighborhood changes, enqueue all affected houses:

```sql
-- When a city is updated
INSERT INTO search_sync_outbox (
  entity_type,
  entity_id,
  operation,
  reason
)
SELECT
  'house',
  h.id,
  'upsert',
  'city_changed'
FROM houses h
WHERE h.city_id = $1
  AND h.deleted_at IS NULL;
```

## Document Transformation

The sync worker transforms normalized relational data into one document per house.

### Canonical Internal Document

```typescript
type HouseSearchDocument = {
  id: string;
  objectID: string; // For InstantSearch compatibility

  title: string;
  description: string;

  address_line_1?: string;

  city: string;
  state: string;
  county?: string;
  neighborhood?: string;
  zip_code: string;

  lat: number;
  lng: number;

  price: number;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  lot_size_acres?: number;
  year_built?: number;

  property_type: string;
  listing_status: string;

  school_district?: string;
  elementary_school?: string;
  middle_school?: string;
  high_school?: string;

  hoa_fee?: number;
  days_on_market?: number;

  amenities: string[];
  tags: string[];

  // Facet fields (explicit)
  city_facet: string;
  state_facet: string;
  county_facet?: string;
  neighborhood_facet?: string;
  zip_code_facet: string;
  property_type_facet: string;
  listing_status_facet: string;
  school_district_facet?: string;

  semantic_text: string;

  updated_at: string;
};
```

### SQL Query to Build Document

```sql
SELECT
  h.id,
  h.title,
  h.description,
  h.address_line_1,
  h.zip_code,

  h.lat,
  h.lng,

  h.price,
  h.bedrooms,
  h.bathrooms,
  h.square_feet,
  h.lot_size_acres,
  h.year_built,

  h.property_type,
  h.listing_status,

  h.school_district,
  h.elementary_school,
  h.middle_school,
  h.high_school,

  h.hoa_fee,
  h.days_on_market,

  h.updated_at,

  c.name AS city,
  c.state,
  c.county,

  n.name AS neighborhood,

  COALESCE(
    array_agg(DISTINCT ha.amenity) FILTER (WHERE ha.amenity IS NOT NULL),
    '{}'
  ) AS amenities,

  COALESCE(
    array_agg(DISTINCT ht.tag) FILTER (WHERE ht.tag IS NOT NULL),
    '{}'
  ) AS tags

FROM houses h
JOIN cities c ON c.id = h.city_id
LEFT JOIN neighborhoods n ON n.id = h.neighborhood_id
LEFT JOIN house_amenities ha ON ha.house_id = h.id
LEFT JOIN house_tags ht ON ht.house_id = h.id

WHERE h.id = $1
  AND h.deleted_at IS NULL

GROUP BY
  h.id,
  c.id,
  n.id;
```

### Transform Function

```typescript
type HouseRow = {
  id: string;
  title: string;
  description?: string;
  address_line_1?: string;
  zip_code: string;

  lat: number;
  lng: number;

  price: number;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  lot_size_acres?: number;
  year_built?: number;

  property_type: string;
  listing_status: string;

  school_district?: string;
  elementary_school?: string;
  middle_school?: string;
  high_school?: string;

  hoa_fee?: number;
  days_on_market?: number;

  city: string;
  state: string;
  county?: string;
  neighborhood?: string;

  amenities: string[];
  tags: string[];

  updated_at: string;
};

function buildSemanticText(row: HouseRow): string {
  return [
    `Title: ${row.title}`,
    row.description ? `Description: ${row.description}` : '',
    `Location: ${[row.neighborhood, row.city, row.state].filter(Boolean).join(', ')}`,
    row.school_district ? `School district: ${row.school_district}` : '',
    `Property type: ${row.property_type}`,
    `Bedrooms: ${row.bedrooms}`,
    `Bathrooms: ${row.bathrooms}`,
    row.square_feet ? `Square feet: ${row.square_feet}` : '',
    row.lot_size_acres ? `Lot size acres: ${row.lot_size_acres}` : '',
    row.amenities.length ? `Amenities: ${row.amenities.join(', ')}` : '',
    row.tags.length ? `Tags: ${row.tags.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function toHouseSearchDocument(row: HouseRow): HouseSearchDocument {
  return {
    id: row.id,
    objectID: row.id,

    title: row.title,
    description: row.description ?? '',

    address_line_1: row.address_line_1,

    city: row.city,
    state: row.state,
    county: row.county,
    neighborhood: row.neighborhood,
    zip_code: row.zip_code,

    lat: row.lat,
    lng: row.lng,

    price: row.price,
    bedrooms: row.bedrooms,
    bathrooms: Number(row.bathrooms),
    square_feet: row.square_feet,
    lot_size_acres: row.lot_size_acres ? Number(row.lot_size_acres) : undefined,
    year_built: row.year_built,

    property_type: row.property_type,
    listing_status: row.listing_status,

    school_district: row.school_district,
    elementary_school: row.elementary_school,
    middle_school: row.middle_school,
    high_school: row.high_school,

    hoa_fee: row.hoa_fee,
    days_on_market: row.days_on_market,

    amenities: row.amenities ?? [],
    tags: row.tags ?? [],

    // Facet fields
    city_facet: row.city,
    state_facet: row.state,
    county_facet: row.county,
    neighborhood_facet: row.neighborhood,
    zip_code_facet: row.zip_code,
    property_type_facet: row.property_type,
    listing_status_facet: row.listing_status,
    school_district_facet: row.school_district,

    semantic_text: buildSemanticText(row),

    updated_at: row.updated_at
  };
}
```

## Engine-Specific Documents

Use one canonical document internally, then adapt for the target engine.

### Typesense Document

Typesense expects `geopoint` fields as latitude/longitude arrays:

```typescript
function toTypesenseDocument(doc: HouseSearchDocument) {
  return {
    ...doc,
    location: [doc.lat, doc.lng],
    // Optional: avoid indexing duplicate geo fields
    lat: undefined,
    lng: undefined
  };
}
```

Example:
```json
{
  "id": "house_1001",
  "objectID": "house_1001",
  "title": "4 bedroom home near Hampton Cove",
  "location": [34.6532, -86.4778],
  "price": 485000,
  "city_facet": "Owens Cross Roads",
  "amenities": ["garage", "fenced_yard"],
  "semantic_text": "Title: 4 bedroom home..."
}
```

### Meilisearch Document

Meilisearch expects geo fields under `_geo`:

```typescript
function toMeiliDocument(doc: HouseSearchDocument) {
  return {
    ...doc,
    _geo: {
      lat: doc.lat,
      lng: doc.lng
    }
  };
}
```

Example:
```json
{
  "id": "house_1001",
  "objectID": "house_1001",
  "title": "4 bedroom home near Hampton Cove",
  "_geo": {
    "lat": 34.6532,
    "lng": -86.4778
  },
  "price": 485000,
  "city_facet": "Owens Cross Roads",
  "amenities": ["garage", "fenced_yard"]
}
```

## Search Engine Configuration

### Typesense Collection Schema

```typescript
const housesSchema = {
  name: 'houses',
  fields: [
    { name: '.*', type: 'auto' },
    { name: '.*_facet', type: 'auto', facet: true },

    { name: 'id', type: 'string' },
    { name: 'objectID', type: 'string' },

    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'semantic_text', type: 'string' },

    { name: 'city', type: 'string', facet: true },
    { name: 'state', type: 'string', facet: true },
    { name: 'county', type: 'string', optional: true, facet: true },
    { name: 'neighborhood', type: 'string', optional: true, facet: true },
    { name: 'zip_code', type: 'string', facet: true },

    { name: 'location', type: 'geopoint' },

    { name: 'price', type: 'int32', facet: true },
    { name: 'bedrooms', type: 'int32', facet: true },
    { name: 'bathrooms', type: 'float', facet: true },
    { name: 'square_feet', type: 'int32', facet: true },
    { name: 'lot_size_acres', type: 'float', optional: true, facet: true },
    { name: 'year_built', type: 'int32', optional: true, facet: true },

    { name: 'property_type', type: 'string', facet: true },
    { name: 'listing_status', type: 'string', facet: true },
    { name: 'school_district', type: 'string', optional: true, facet: true },

    { name: 'amenities', type: 'string[]', optional: true, facet: true },
    { name: 'tags', type: 'string[]', optional: true, facet: true },

    // Auto-embedding from semantic_text
    {
      name: 'embedding',
      type: 'float[]',
      embed: {
        from: ['semantic_text'],
        model_config: {
          model_name: 'ts/all-MiniLM-L12-v2'
        }
      }
    }
  ],
  default_sorting_field: 'price'
};

await typesense.collections().create(housesSchema);
```

### Meilisearch Settings

```typescript
await client.index('houses').updateSettings({
  searchableAttributes: [
    'title',
    'description',
    'semantic_text',
    'city',
    'neighborhood',
    'school_district',
    'zip_code',
    'amenities',
    'tags'
  ],

  filterableAttributes: [
    'city_facet',
    'state_facet',
    'county_facet',
    'neighborhood_facet',
    'zip_code_facet',
    'property_type_facet',
    'listing_status_facet',
    'school_district_facet',
    'price',
    'bedrooms',
    'bathrooms',
    'square_feet',
    'lot_size_acres',
    'year_built',
    'amenities',
    'tags',
    '_geo'
  ],

  sortableAttributes: [
    'price',
    'square_feet',
    'days_on_market',
    '_geo'
  ]
});

// Configure embedder
await client.index('houses').updateEmbedders({
  'houses-openai': {
    source: 'openAi',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    documentTemplate: '{{doc.semantic_text}}'
  }
});
```

## Sync Worker Implementation

The sync worker should be boring, retryable, and idempotent.

### Worker Loop

```typescript
import { pool } from './db';

async function runSearchSyncWorker() {
  while (true) {
    try {
      const events = await pool.query(`
        SELECT *
        FROM search_sync_outbox
        WHERE processed_at IS NULL
          AND available_at <= now()
        ORDER BY id
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `);

      if (events.rows.length === 0) {
        await sleep(5000); // Wait 5 seconds
        continue;
      }

      for (const event of events.rows) {
        await processEvent(event);
      }
    } catch (error) {
      console.error('Sync worker error:', error);
      await sleep(10000);
    }
  }
}

async function processEvent(event: any) {
  try {
    if (event.operation === 'delete') {
      await deleteFromSearch(event.entity_id);
    } else {
      const row = await fetchHouseSearchRow(event.entity_id);

      if (!row) {
        // House was deleted
        await deleteFromSearch(event.entity_id);
      } else {
        const canonicalDoc = toHouseSearchDocument(row);
        await upsertToSearch(canonicalDoc);
      }
    }

    await markEventProcessed(event.id);
  } catch (error) {
    await markEventFailed(event.id, error);
  }
}

async function fetchHouseSearchRow(houseId: string) {
  const result = await pool.query(`
    SELECT
      h.id,
      h.title,
      h.description,
      -- ... all fields from transform query
    FROM houses h
    JOIN cities c ON c.id = h.city_id
    LEFT JOIN neighborhoods n ON n.id = h.neighborhood_id
    LEFT JOIN house_amenities ha ON ha.house_id = h.id
    LEFT JOIN house_tags ht ON ht.house_id = h.id
    WHERE h.id = $1
      AND h.deleted_at IS NULL
    GROUP BY h.id, c.id, n.id
  `, [houseId]);

  return result.rows[0];
}

async function markEventProcessed(eventId: number) {
  await pool.query(`
    UPDATE search_sync_outbox
    SET processed_at = now()
    WHERE id = $1
  `, [eventId]);
}

async function markEventFailed(eventId: number, error: unknown) {
  await pool.query(`
    UPDATE search_sync_outbox
    SET attempts = attempts + 1,
        last_error = $2,
        available_at = now() + make_interval(secs => LEAST(300, POWER(2, attempts)))
    WHERE id = $1
  `, [eventId, String(error)]);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Retry Behavior

The exponential backoff formula:

```sql
available_at = now() + make_interval(secs => LEAST(300, POWER(2, attempts)))
```

Results in:
- Attempt 1: 2 seconds
- Attempt 2: 4 seconds
- Attempt 3: 8 seconds
- Attempt 4: 16 seconds
- Attempt 5+: 300 seconds (5 minutes max)

### Idempotency

Every document should use a stable ID:

```
Postgres house id = search document id
```

Then every upsert can be safely retried:
```
Upsert house_1001
Upsert house_1001 again (retry)
Upsert house_1001 again (duplicate event)
→ Result: One search document
```

## Upserting Documents

### Typesense Upsert

```typescript
import Typesense from 'typesense';

const typesense = new Typesense.Client({
  nodes: [{
    host: 'search.example.com',
    port: 443,
    protocol: 'https'
  }],
  apiKey: 'your_api_key'
});

async function upsertToSearch(doc: HouseSearchDocument) {
  const typesenseDoc = toTypesenseDocument(doc);
  
  await typesense
    .collections('houses')
    .documents()
    .upsert(typesenseDoc);
}

async function deleteFromSearch(id: string) {
  try {
    await typesense
      .collections('houses')
      .documents(id)
      .delete();
  } catch (error: any) {
    if (error.httpStatus === 404) {
      // Already deleted, ignore
      return;
    }
    throw error;
  }
}
```

### Batch Upserts (Typesense)

For higher throughput, buffer documents and batch:

```typescript
const documentBuffer: HouseSearchDocument[] = [];
const BATCH_SIZE = 100;
const BATCH_TIMEOUT = 5000; // 5 seconds

async function upsertToSearchBuffered(doc: HouseSearchDocument) {
  documentBuffer.push(doc);
  
  if (documentBuffer.length >= BATCH_SIZE) {
    await flushBuffer();
  }
}

async function flushBuffer() {
  if (documentBuffer.length === 0) return;
  
  const batch = documentBuffer.splice(0, documentBuffer.length);
  const typesenseDocs = batch.map(toTypesenseDocument);
  
  await typesense
    .collections('houses')
    .documents()
    .import(typesenseDocs, {
      action: 'upsert'
    });
}

// Flush on interval
setInterval(flushBuffer, BATCH_TIMEOUT);
```

### Meilisearch Upsert

```typescript
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({
  host: 'https://search.example.com',
  apiKey: 'MEILI_MASTER_KEY'
});

async function upsertToSearch(doc: HouseSearchDocument) {
  const meiliDoc = toMeiliDocument(doc);
  
  const task = await client
    .index('houses')
    .addDocuments([meiliDoc], {
      primaryKey: 'id'
    });
  
  // Optional: wait for completion
  await client.waitForTask(task.taskUid);
}

async function deleteFromSearch(id: string) {
  const task = await client
    .index('houses')
    .deleteDocument(id);
  
  // Optional: wait for completion
  await client.waitForTask(task.taskUid);
}
```

## Full Backfill Pipeline

You need a full backfill path for:

- Initial launch
- Schema changes
- Facet changes
- Search setting changes
- Embedding model/template changes
- Data repair
- Disaster recovery

### Backfill Steps

```
1. Create a new search index or collection
2. Configure schema/settings
3. Read all active houses from Postgres in batches
4. Transform each row into a flattened search document
5. Bulk import into the new search index
6. Validate document counts and sample queries
7. Replay any outbox events created during backfill
8. Atomically swap the live alias/index
9. Keep old index temporarily for rollback
10. Delete old index after confidence window
```

### Backfill Implementation

```typescript
async function fullBackfill() {
  console.log('Starting full backfill...');
  
  // Step 1: Create new collection
  const timestamp = Date.now();
  const newCollectionName = `houses_${timestamp}`;
  
  await typesense.collections().create({
    ...housesSchema,
    name: newCollectionName
  });
  
  console.log(`Created collection: ${newCollectionName}`);
  
  // Step 2: Batch query and import
  let offset = 0;
  const batchSize = 1000;
  let processedCount = 0;
  
  while (true) {
    const houses = await pool.query(`
      SELECT h.id
      FROM houses h
      WHERE h.deleted_at IS NULL
      ORDER BY h.id
      LIMIT $1
      OFFSET $2
    `, [batchSize, offset]);
    
    if (houses.rows.length === 0) break;
    
    const ids = houses.rows.map(r => r.id);
    const documents: HouseSearchDocument[] = [];
    
    for (const id of ids) {
      const row = await fetchHouseSearchRow(id);
      if (row) {
        documents.push(toHouseSearchDocument(row));
      }
    }
    
    if (documents.length > 0) {
      const typesenseDocs = documents.map(toTypesenseDocument);
      await typesense
        .collections(newCollectionName)
        .documents()
        .import(typesenseDocs, { action: 'upsert' });
      
      processedCount += documents.length;
      console.log(`Imported ${processedCount} documents...`);
    }
    
    offset += batchSize;
  }
  
  console.log(`Backfill complete: ${processedCount} documents`);
  
  // Step 3: Validate
  const stats = await typesense.collections(newCollectionName).retrieve();
  console.log(`Collection stats:`, stats.num_documents);
  
  // Step 4: Swap alias
  await typesense.aliases().upsert('houses', {
    collection_name: newCollectionName
  });
  
  console.log(`Alias 'houses' now points to ${newCollectionName}`);
}
```

### Keyset Pagination (for large datasets)

Better than offset pagination for very large tables:

```sql
SELECT h.id
FROM houses h
WHERE h.deleted_at IS NULL
  AND h.id > $1  -- Last seen ID
ORDER BY h.id
LIMIT $2;
```

## Incremental Sync

After backfill, incremental sync keeps search fresh.

### Flow

```
1. User updates house in application
2. Postgres transaction updates normalized tables
3. Same transaction inserts outbox event
4. Worker reads outbox event
5. Worker fetches current normalized state
6. Worker transforms row into flattened document
7. Worker upserts/deletes document in search engine
8. Worker marks event processed
```

### Why Rebuild from Current State

Instead of applying deltas, always rebuild:

✅ **Rebuild from current state:**
```typescript
const row = await fetchHouseSearchRow(houseId);
const doc = toHouseSearchDocument(row);
await upsert(doc);
```

❌ **Apply deltas (fragile):**
```typescript
// If price changed
await updateFields({ id: houseId, price: newPrice });
// What if amenities also changed?
// What if city name changed?
// What if sync failed partway?
```

Rebuilding from current state avoids:
- Stale partial updates
- Missing related changes
- Complex delta logic
- Ordering dependencies

## Handling Related Changes

A house search document contains flattened city and neighborhood data. Changes to these tables must reindex affected houses.

### Examples

**City changed:**
```sql
INSERT INTO search_sync_outbox (
  entity_type,
  entity_id,
  operation,
  reason
)
SELECT
  'house',
  h.id,
  'upsert',
  'city_changed'
FROM houses h
WHERE h.city_id = $1
  AND h.deleted_at IS NULL;
```

**Neighborhood changed:**
```sql
INSERT INTO search_sync_outbox (
  entity_type,
  entity_id,
  operation,
  reason
)
SELECT
  'house',
  h.id,
  'upsert',
  'neighborhood_changed'
FROM houses h
WHERE h.neighborhood_id = $1
  AND h.deleted_at IS NULL;
```

**Amenity added/removed:**

Already handled by trigger on `house_amenities` table.

## Delete Handling

Prefer soft delete in PostgreSQL:

```sql
UPDATE houses
SET deleted_at = now(),
    listing_status = 'inactive',
    updated_at = now()
WHERE id = $1;
```

The trigger automatically enqueues a delete event.

### Keep Sold History

If houses should remain searchable as sold history:

```sql
UPDATE houses
SET listing_status = 'sold',
    sold_at = now(),
    updated_at = now()
WHERE id = $1;
```

This enqueues an upsert that updates `listing_status_facet = 'sold'`.

Public UI filters to `listing_status_facet = 'active'`.

## Vector Update Optimization

Don't regenerate vectors for every change.

### Semantic Fields

Fields that affect semantic meaning:
```
title, description, city, neighborhood, school_district,
property_type, amenities, tags
```

### Non-Semantic Fields

Fields that don't affect semantic meaning:
```
price, days_on_market, listing_status, updated_at,
view_count, favorite_count
```

### Typesense Optimization

Use `embed.from` to control what triggers regeneration:

```typescript
{
  name: 'embedding',
  type: 'float[]',
  embed: {
    from: ['semantic_text'], // Only regenerate when this changes
    model_config: {
      model_name: 'ts/all-MiniLM-L12-v2'
    }
  }
}
```

Control `semantic_text` in transform function:

```typescript
function buildSemanticText(row: HouseRow): string {
  // Only include semantic fields
  // Exclude: price, days_on_market, listing_status
}
```

### Meilisearch Optimization

Use document template with only semantic fields:

```typescript
documentTemplate: '{{doc.semantic_text}}'
```

## Document Versioning

Add versioning to avoid redundant writes.

### Sync State Table

```sql
CREATE TABLE search_sync_state (
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  target text NOT NULL,
  document_hash text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, target)
);

CREATE INDEX search_sync_state_hash_idx 
ON search_sync_state (document_hash);
```

### Hash and Skip

```typescript
import { createHash } from 'crypto';

function hashDocument(doc: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(doc))
    .digest('hex');
}

async function upsertToSearchWithVersioning(doc: HouseSearchDocument) {
  const hash = hashDocument(doc);
  
  // Check if already synced
  const existing = await pool.query(`
    SELECT document_hash
    FROM search_sync_state
    WHERE entity_type = 'house'
      AND entity_id = $1
      AND target = 'typesense'
  `, [doc.id]);
  
  if (existing.rows.length > 0 && existing.rows[0].document_hash === hash) {
    console.log(`Skipping ${doc.id}: unchanged`);
    return;
  }
  
  // Upsert to search engine
  await upsertToSearch(doc);
  
  // Update sync state
  await pool.query(`
    INSERT INTO search_sync_state (
      entity_type,
      entity_id,
      target,
      document_hash,
      synced_at
    ) VALUES ('house', $1, 'typesense', $2, now())
    ON CONFLICT (entity_type, entity_id, target)
    DO UPDATE SET
      document_hash = EXCLUDED.document_hash,
      synced_at = EXCLUDED.synced_at
  `, [doc.id, hash]);
}
```

## Best Practices

### For Early Implementation

Start with:

✅ Outbox table
✅ Background worker
✅ Batch upserts every 5-10 seconds
✅ Full backfill script
✅ Manual reindex command
✅ Basic retry handling

This is enough for most teams.

### For Higher Scale

Move to:

✅ Logical replication / CDC
✅ Queue-based worker (Bull, BeeQueue, SQS)
✅ Bulk upserts (batching)
✅ Versioned indexes/collections
✅ Alias or index swap
✅ Document checksums
✅ Metrics and alerting
✅ Dead-letter queue

### Avoid

❌ **Don't do this:**
- Application writes directly to both Postgres and search engine
- No queue
- No retries
- No replay
- No full backfill path
- No monitoring

**Result:** Search will drift from source of truth.

## Pipeline Comparison

### Typesense Pipeline

```
PostgreSQL normalized tables
  ↓
Outbox event (trigger)
  ↓
Sync worker
  ↓
Flatten to Typesense document
  - location: [lat, lng]
  - *_facet fields
  - semantic_text
  ↓
Bulk import (action=upsert)
  ↓
Typesense collection
```

**Best for:**
- Strict schema validation
- Pattern-based facet fields
- Auto-embedding from selected fields
- Strong geo + facet + hybrid search

### Meilisearch Pipeline

```
PostgreSQL normalized tables
  ↓
Outbox event (trigger)
  ↓
Sync worker
  ↓
Flatten to Meilisearch document
  - _geo: { lat, lng }
  - *_facet fields
  - semantic_text
  ↓
Add/update documents
  ↓
Meilisearch index (async task queue)
```

**Best for:**
- Simpler setup
- Fast iteration
- Good defaults
- Managed embedders

## Final Recommendation

Use this pattern:

```
✅ PostgreSQL normalized schema
✅ search_sync_outbox table
✅ Triggers on all relevant tables
✅ Background sync worker
✅ Flattened search documents
✅ Typesense or Meilisearch
✅ Full backfill capability
✅ Alias/index swap for zero-downtime
```

### Default Recommendation

```
PostgreSQL as source of truth
  +
Typesense as search engine
  +
Outbox-based sync worker
  +
One flattened document per house
  +
Typesense alias for zero-downtime reindexing
```

Choose **Meilisearch** instead if team wants simpler setup and faster iteration.

### Most Important Design Choice

The most important design choice is **not** Typesense vs Meilisearch.

It's having a **reliable sync pipeline** with:

✅ Full backfill capability
✅ Incremental outbox sync
✅ Delete handling
✅ Related-record reindexing
✅ Document transformation
✅ Retries
✅ Observability
✅ Zero-downtime reindexing
