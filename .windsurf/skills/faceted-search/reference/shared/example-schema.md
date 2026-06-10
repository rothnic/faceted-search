# Example Schema: House Search

Complete PostgreSQL schema for the house search example used throughout this skill.

## Domain Overview

This example models a real estate search application for the Huntsville, Alabama metro area (Madison County). The domain includes:

- **Houses** - Residential properties for sale
- **Cities** - Cities in the metro area (e.g., Huntsville, Madison, Owens Cross Roads)
- **Neighborhoods** - Named subdivisions and communities
- **Amenities** - Property features (pool, garage, basement, etc.)
- **Tags** - Descriptive labels (family-friendly, luxury, walkable, etc.)

## Complete Schema

### Cities Table

```sql
CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic info
  name text NOT NULL,
  state text NOT NULL,
  county text,
  
  -- Geography
  center_lat double precision,
  center_lng double precision,
  boundary_geom geometry(Polygon, 4326),
  
  -- Statistics
  population integer,
  median_home_price integer,
  school_rating_avg numeric(3, 2),
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT cities_name_state_unique UNIQUE (name, state)
);

CREATE INDEX cities_name_idx ON cities (name);
CREATE INDEX cities_state_idx ON cities (state);
CREATE INDEX cities_county_idx ON cities (county);
CREATE INDEX cities_boundary_geom_idx ON cities USING gist (boundary_geom);
CREATE INDEX cities_updated_at_idx ON cities (updated_at);
```

**Purpose:** Source of truth for city data. When a city's name or boundaries change, search documents can be updated via sync.

### Neighborhoods Table

```sql
CREATE TABLE neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  
  -- Basic info
  name text NOT NULL,
  description text,
  
  -- Geography
  center_lat double precision,
  center_lng double precision,
  boundary_geom geometry(Polygon, 4326),
  
  -- Statistics
  median_home_price integer,
  school_rating_avg numeric(3, 2),
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT neighborhoods_city_name_unique UNIQUE (city_id, name)
);

CREATE INDEX neighborhoods_city_id_idx ON neighborhoods (city_id);
CREATE INDEX neighborhoods_name_idx ON neighborhoods (name);
CREATE INDEX neighborhoods_boundary_geom_idx ON neighborhoods USING gist (boundary_geom);
CREATE INDEX neighborhoods_updated_at_idx ON neighborhoods (updated_at);
```

**Purpose:** Subdivisions within cities. Houses can optionally belong to a neighborhood.

### Houses Table

```sql
CREATE TABLE houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic info
  title text NOT NULL,
  description text,
  
  -- Location
  address_line_1 text,
  address_line_2 text,
  city_id uuid NOT NULL REFERENCES cities(id),
  neighborhood_id uuid REFERENCES neighborhoods(id),
  zip_code text NOT NULL,
  
  -- Geography (PostGIS)
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geom geometry(Point, 4326),
  
  -- Core attributes
  price integer NOT NULL,
  bedrooms integer NOT NULL,
  bathrooms numeric(3, 1) NOT NULL,
  square_feet integer NOT NULL,
  lot_size_acres numeric(5, 2),
  year_built integer,
  
  -- Property details
  property_type text NOT NULL,
  listing_status text NOT NULL,
  
  -- Schools
  school_district text,
  elementary_school text,
  middle_school text,
  high_school text,
  
  -- Additional details
  hoa_fee integer,
  days_on_market integer,
  parking_spaces integer,
  stories integer,
  
  -- Important dates
  listed_at timestamptz,
  sold_at timestamptz,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  
  CONSTRAINT houses_price_positive CHECK (price > 0),
  CONSTRAINT houses_bedrooms_positive CHECK (bedrooms >= 0),
  CONSTRAINT houses_bathrooms_positive CHECK (bathrooms >= 0),
  CONSTRAINT houses_square_feet_positive CHECK (square_feet > 0),
  CONSTRAINT houses_property_type_valid CHECK (property_type IN (
    'single_family', 'townhouse', 'condo', 'multi_family', 'land', 'manufactured'
  )),
  CONSTRAINT houses_listing_status_valid CHECK (listing_status IN (
    'active', 'pending', 'sold', 'withdrawn', 'expired'
  ))
);

-- Indexes for queries
CREATE INDEX houses_city_id_idx ON houses (city_id);
CREATE INDEX houses_neighborhood_id_idx ON houses (neighborhood_id);
CREATE INDEX houses_zip_code_idx ON houses (zip_code);
CREATE INDEX houses_property_type_idx ON houses (property_type);
CREATE INDEX houses_listing_status_idx ON houses (listing_status);
CREATE INDEX houses_price_idx ON houses (price);
CREATE INDEX houses_bedrooms_idx ON houses (bedrooms);
CREATE INDEX houses_bathrooms_idx ON houses (bathrooms);
CREATE INDEX houses_square_feet_idx ON houses (square_feet);
CREATE INDEX houses_school_district_idx ON houses (school_district);
CREATE INDEX houses_updated_at_idx ON houses (updated_at);
CREATE INDEX houses_deleted_at_idx ON houses (deleted_at) WHERE deleted_at IS NULL;

-- Geography index
CREATE INDEX houses_geom_idx ON houses USING gist (geom);

-- Full-text search (for PostgreSQL-native and pg_search)
CREATE INDEX houses_title_trgm_idx ON houses USING gin (title gin_trgm_ops);
CREATE INDEX houses_description_trgm_idx ON houses USING gin (description gin_trgm_ops);

-- Composite indexes for common queries
CREATE INDEX houses_active_by_city_idx ON houses (city_id, price) 
  WHERE deleted_at IS NULL AND listing_status = 'active';
CREATE INDEX houses_active_by_price_idx ON houses (price) 
  WHERE deleted_at IS NULL AND listing_status = 'active';
```

**Purpose:** Core table for property listings. Most search queries filter to `deleted_at IS NULL AND listing_status = 'active'`.

### House Amenities Table

```sql
CREATE TABLE house_amenities (
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  amenity text NOT NULL,
  
  PRIMARY KEY (house_id, amenity)
);

CREATE INDEX house_amenities_house_id_idx ON house_amenities (house_id);
CREATE INDEX house_amenities_amenity_idx ON house_amenities (amenity);
```

**Amenity vocabulary:**
```
pool, hot_tub, garage, carport, covered_parking, basement, finished_basement,
attic, fenced_yard, deck, patio, fireplace, central_air, central_heat,
hardwood_floors, tile_floors, carpet, granite_counters, stainless_appliances,
updated_kitchen, updated_bathrooms, walk_in_closet, master_on_main,
laundry_room, mudroom, home_office, bonus_room, media_room, game_room,
workshop, storage_shed, sprinkler_system, security_system, smart_home,
energy_efficient, solar_panels, new_roof, new_hvac, new_windows,
waterfront, lake_view, mountain_view, golf_course_view, wooded_lot,
corner_lot, cul_de_sac, private_lot, gated_community, community_pool,
community_clubhouse, tennis_courts, playground, walking_trails
```

### House Tags Table

```sql
CREATE TABLE house_tags (
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  tag text NOT NULL,
  
  PRIMARY KEY (house_id, tag)
);

CREATE INDEX house_tags_house_id_idx ON house_tags (house_id);
CREATE INDEX house_tags_tag_idx ON house_tags (tag);
```

**Tag vocabulary:**
```
family_friendly, starter_home, move_in_ready, fixer_upper, investment_property,
luxury, executive, estate, custom_built, new_construction, recent_renovation,
low_maintenance, retirement_ready, accessible, pet_friendly, walkable,
bike_friendly, near_research_park, near_redstone_arsenal, near_downtown,
near_shopping, near_restaurants, near_schools, near_parks, near_trails,
near_golf, good_schools, top_rated_schools, private_school_nearby,
quiet_area, established_neighborhood, up_and_coming, historic, modern,
contemporary, traditional, ranch_style, split_level, open_floor_plan,
formal_dining, eat_in_kitchen, breakfast_nook, large_yard, small_yard,
easy_commute, close_to_highway, rural_feel, suburban, urban
```

### Users Table (for saved searches)

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_email_idx ON users (email);
```

### Saved Searches Table

```sql
CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name text,
  criteria jsonb NOT NULL,
  
  alert_enabled boolean NOT NULL DEFAULT true,
  alert_frequency text NOT NULL DEFAULT 'instant',
  
  seen_house_ids uuid[] NOT NULL DEFAULT '{}',
  
  last_evaluated_at timestamptz,
  last_notified_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT saved_searches_alert_frequency_valid CHECK (alert_frequency IN (
    'instant', 'hourly', 'daily', 'weekly', 'never'
  ))
);

CREATE INDEX saved_searches_user_id_idx ON saved_searches (user_id);
CREATE INDEX saved_searches_alert_enabled_idx ON saved_searches (alert_enabled) 
  WHERE alert_enabled = true;
CREATE INDEX saved_searches_last_evaluated_at_idx ON saved_searches (last_evaluated_at);
```

### Search Sync Outbox (for Meilisearch/Typesense)

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

CREATE INDEX search_sync_outbox_processed_at_idx 
ON search_sync_outbox (processed_at) 
WHERE processed_at IS NOT NULL;
```

## Sample Data

### Cities

```sql
INSERT INTO cities (id, name, state, county, center_lat, center_lng, population, median_home_price) VALUES
('c1', 'Huntsville', 'AL', 'Madison', 34.7304, -86.5861, 215006, 285000),
('c2', 'Madison', 'AL', 'Madison', 34.6993, -86.7483, 51593, 325000),
('c3', 'Owens Cross Roads', 'AL', 'Madison', 34.5851, -86.4532, 2708, 425000),
('c4', 'Athens', 'AL', 'Limestone', 34.8026, -86.9719, 25406, 245000);
```

### Neighborhoods

```sql
INSERT INTO neighborhoods (id, city_id, name, center_lat, center_lng) VALUES
('n1', 'c1', 'Hampton Cove', 34.6620, -86.4783),
('n2', 'c1', 'Jones Valley', 34.7015, -86.5397),
('n3', 'c2', 'Hughes Road', 34.6848, -86.7301),
('n4', 'c3', 'Nolen Farm', 34.5887, -86.4612);
```

### Houses

```sql
INSERT INTO houses (
  id, title, description, city_id, neighborhood_id, zip_code,
  lat, lng, price, bedrooms, bathrooms, square_feet,
  property_type, listing_status, school_district
) VALUES
(
  'h1',
  '4 bedroom home near Hampton Cove Golf Course',
  'Spacious single-family home with mountain views, fenced yard, and updated kitchen. Perfect for families looking for space and great schools.',
  'c3',
  'n4',
  '35763',
  34.6532,
  -86.4778,
  485000,
  4,
  3.0,
  2750,
  'single_family',
  'active',
  'Madison County'
),
(
  'h2',
  'Townhouse in Madison with community amenities',
  'Low-maintenance townhouse in gated community. Access to pool, clubhouse, and walking trails. Close to shopping and restaurants.',
  'c2',
  'n3',
  '35758',
  34.6901,
  -86.7402,
  325000,
  3,
  2.5,
  1850,
  'townhouse',
  'active',
  'Madison City'
),
(
  'h3',
  'Luxury estate in Hampton Cove',
  'Custom-built executive home on 2 acres with lake views. Gourmet kitchen, home theater, and wine cellar. Guard-gated golf course community.',
  'c1',
  'n1',
  '35763',
  34.6589,
  -86.4691,
  875000,
  5,
  4.5,
  4200,
  'single_family',
  'active',
  'Madison County'
);
```

### Amenities

```sql
INSERT INTO house_amenities (house_id, amenity) VALUES
('h1', 'garage'),
('h1', 'fenced_yard'),
('h1', 'updated_kitchen'),
('h1', 'mountain_view'),
('h1', 'home_office'),
('h2', 'covered_parking'),
('h2', 'community_pool'),
('h2', 'community_clubhouse'),
('h2', 'walking_trails'),
('h3', 'pool'),
('h3', 'garage'),
('h3', 'basement'),
('h3', 'lake_view'),
('h3', 'gated_community'),
('h3', 'media_room'),
('h3', 'wine_cellar');
```

### Tags

```sql
INSERT INTO house_tags (house_id, tag) VALUES
('h1', 'family_friendly'),
('h1', 'good_schools'),
('h1', 'near_golf'),
('h1', 'mountain_view'),
('h2', 'low_maintenance'),
('h2', 'walkable'),
('h2', 'near_shopping'),
('h2', 'gated_community'),
('h3', 'luxury'),
('h3', 'executive'),
('h3', 'custom_built'),
('h3', 'gated_community'),
('h3', 'lake_view'),
('h3', 'good_schools');
```

## Flattened Search Document

For Meilisearch and Typesense, the normalized data is flattened into search documents:

```typescript
type HouseSearchDocument = {
  // IDs
  id: string;
  objectID: string;  // For InstantSearch.js compatibility
  
  // Searchable text
  title: string;
  description: string;
  
  // Location (denormalized from cities and neighborhoods)
  address_line_1?: string;
  city: string;
  state: string;
  county?: string;
  neighborhood?: string;
  zip_code: string;
  
  // Geography
  lat: number;
  lng: number;
  // Meilisearch uses: _geo: { lat, lng }
  // Typesense uses: location: [lat, lng]
  
  // Core attributes
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  lot_size_acres?: number;
  year_built?: number;
  
  // Property details
  property_type: string;
  listing_status: string;
  
  // Schools
  school_district?: string;
  elementary_school?: string;
  middle_school?: string;
  high_school?: string;
  
  // Additional details
  hoa_fee?: number;
  days_on_market?: number;
  parking_spaces?: number;
  stories?: number;
  
  // Amenities and tags (denormalized from junction tables)
  amenities: string[];
  tags: string[];
  
  // Facet fields (explicit for clarity)
  city_facet: string;
  state_facet: string;
  county_facet?: string;
  neighborhood_facet?: string;
  zip_code_facet: string;
  property_type_facet: string;
  listing_status_facet: string;
  school_district_facet?: string;
  
  // Semantic search
  semantic_text: string;  // Built from searchable fields
  
  // Metadata
  updated_at: string;
};
```

### Example Flattened Document

```json
{
  "id": "h1",
  "objectID": "h1",
  "title": "4 bedroom home near Hampton Cove Golf Course",
  "description": "Spacious single-family home with mountain views...",
  "city": "Owens Cross Roads",
  "state": "AL",
  "county": "Madison",
  "neighborhood": "Nolen Farm",
  "zip_code": "35763",
  "lat": 34.6532,
  "lng": -86.4778,
  "price": 485000,
  "bedrooms": 4,
  "bathrooms": 3.0,
  "square_feet": 2750,
  "property_type": "single_family",
  "listing_status": "active",
  "school_district": "Madison County",
  "amenities": ["garage", "fenced_yard", "updated_kitchen", "mountain_view", "home_office"],
  "tags": ["family_friendly", "good_schools", "near_golf", "mountain_view"],
  "city_facet": "Owens Cross Roads",
  "state_facet": "AL",
  "county_facet": "Madison",
  "neighborhood_facet": "Nolen Farm",
  "zip_code_facet": "35763",
  "property_type_facet": "single_family",
  "listing_status_facet": "active",
  "school_district_facet": "Madison County",
  "semantic_text": "Title: 4 bedroom home near Hampton Cove Golf Course\nDescription: Spacious single-family home with mountain views, fenced yard, and updated kitchen. Perfect for families looking for space and great schools.\nLocation: Nolen Farm, Owens Cross Roads, AL\nSchool district: Madison County\nProperty type: single_family\nBedrooms: 4\nBathrooms: 3.0\nSquare feet: 2750\nAmenities: garage, fenced_yard, updated_kitchen, mountain_view, home_office\nTags: family_friendly, good_schools, near_golf, mountain_view",
  "updated_at": "2026-06-10T15:30:00Z"
}
```

## SQL Query to Build Flattened Document

This query is used by sync workers for Meilisearch/Typesense:

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
  h.parking_spaces,
  h.stories,
  
  h.updated_at,
  
  -- Denormalized city data
  c.name AS city,
  c.state,
  c.county,
  
  -- Denormalized neighborhood data
  n.name AS neighborhood,
  
  -- Aggregate amenities
  COALESCE(
    array_agg(DISTINCT ha.amenity) FILTER (WHERE ha.amenity IS NOT NULL),
    '{}'
  ) AS amenities,
  
  -- Aggregate tags
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

## Common Query Patterns

### Search for Active Houses in a City

```sql
SELECT h.*
FROM houses h
JOIN cities c ON c.id = h.city_id
WHERE c.name = 'Huntsville'
  AND h.listing_status = 'active'
  AND h.deleted_at IS NULL
ORDER BY h.price ASC;
```

### Search with Filters

```sql
SELECT h.*
FROM houses h
JOIN cities c ON c.id = h.city_id
WHERE c.name = 'Madison'
  AND h.listing_status = 'active'
  AND h.deleted_at IS NULL
  AND h.bedrooms >= 3
  AND h.bathrooms >= 2
  AND h.price BETWEEN 300000 AND 400000
ORDER BY h.price ASC;
```

### Radius Search

```sql
SELECT h.*, 
  ST_Distance(
    h.geom::geography, 
    ST_SetSRID(ST_MakePoint(-86.5861, 34.7304), 4326)::geography
  ) / 1609.34 AS distance_miles
FROM houses h
WHERE h.listing_status = 'active'
  AND h.deleted_at IS NULL
  AND ST_DWithin(
    h.geom::geography,
    ST_SetSRID(ST_MakePoint(-86.5861, 34.7304), 4326)::geography,
    16093.4  -- 10 miles in meters
  )
ORDER BY distance_miles ASC;
```

### Houses with Specific Amenities

```sql
SELECT h.*
FROM houses h
WHERE h.listing_status = 'active'
  AND h.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM house_amenities ha
    WHERE ha.house_id = h.id
      AND ha.amenity = ANY(ARRAY['pool', 'garage'])
  )
ORDER BY h.price ASC;
```

## Field Naming Conventions

### PostgreSQL Tables
- Use `snake_case` for all table and column names
- Use `id` as primary key
- Use `{table}_id` for foreign keys
- Use `created_at`, `updated_at`, `deleted_at` for timestamps

### Search Documents
- Use `snake_case` for field names
- Use `*_facet` suffix for explicit facet fields
- Use `id` and `objectID` for identifiers
- Use `semantic_text` for combined text for embeddings

### Enum Values
- Use `snake_case` for enum values (e.g., `single_family`, not `Single Family`)
- This ensures consistent filtering across PostgreSQL and search engines

## Geographic Data

This schema uses PostGIS for geographic data:

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Update geometry from lat/lng
UPDATE houses 
SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326);

-- Update city boundaries (example)
UPDATE cities
SET boundary_geom = ST_GeomFromText('POLYGON((...coordinates...))', 4326)
WHERE name = 'Huntsville';
```

**Coordinate system:** SRID 4326 (WGS 84, standard lat/lng)

## Using This Schema

### For PostgreSQL-Native Search
Use this schema as-is with full-text search indexes and PostGIS geo queries.

### For pg_search Extension
Use this schema as-is, but add BM25 indexes:

```sql
CREATE INDEX houses_search_idx
ON houses
USING bm25 (id, title, description, city, neighborhood)
WITH (key_field = 'id');
```

### For Meilisearch/Typesense
Use this schema for the source of truth, then sync flattened documents to the external search service.

## Next Steps

- See `domain-modeling.md` for denormalization patterns
- See `embeddings.md` for building semantic_text
- See specific search option deployment docs for indexes and configuration
