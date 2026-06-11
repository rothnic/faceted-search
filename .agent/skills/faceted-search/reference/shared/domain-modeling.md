# Domain Modeling for Faceted Search

Guide for designing data models and search documents for faceted, geo-aware, and semantic search.

## Contents

- [Core Principles](#core-principles)
- [Source of Truth vs Search Documents](#source-of-truth-vs-search-documents)
- [Example Domain: House Search](#example-domain-house-search)
- [Document Design Patterns](#document-design-patterns)
- [Field Naming Conventions](#field-naming-conventions)
- [Facet Field Design](#facet-field-design)
- [Geo Field Design](#geo-field-design)
- [Denormalization Strategy](#denormalization-strategy)
- [Handling Relationships](#handling-relationships)
- [Schema Evolution](#schema-evolution)

## Core Principles

### 1. PostgreSQL as Source of Truth

For architectures using external search engines (Meilisearch, Typesense):
- PostgreSQL stores normalized relational data
- Search engine receives denormalized search documents
- Sync pipeline transforms relational → search documents
- Never mutate source data based on search state

### 2. Denormalization for Search

Search documents should be:
- **Self-contained**: All searchable data in one document
- **Flat when possible**: Avoid deep nesting
- **Optimized for read**: Duplicate data for search performance
- **Semantic-friendly**: Include context for embeddings

### 3. Convention Over Configuration

Use naming patterns for clarity:
- Fields ending in `_facet` → facetable fields
- Fields starting with `_` → special fields (e.g., `_geo`)
- Boolean `has_*` → amenity flags
- Arrays for multi-value attributes

## Source of Truth vs Search Documents

### PostgreSQL Tables (normalized)

```sql
CREATE TABLE cities (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL,
  county text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  population integer,
  median_home_price integer
);

CREATE TABLE houses (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text,
  
  city_id uuid REFERENCES cities(id),
  address_line_1 text,
  neighborhood text,
  zip_code text,
  
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  
  price integer NOT NULL,
  bedrooms integer NOT NULL,
  bathrooms numeric NOT NULL,
  -- ... more fields
);

CREATE TABLE house_schools (
  house_id uuid REFERENCES houses(id),
  school_id uuid REFERENCES schools(id),
  school_type text -- 'elementary', 'middle', 'high'
);
```

### Search Documents (denormalized)

```json
{
  "id": "house_1001",
  "title": "4 bedroom home near Hampton Cove",
  "description": "Spacious single-family home...",
  
  "city": "Owens Cross Roads",
  "state": "AL",
  "county": "Madison",
  "neighborhood": "Hampton Cove",
  "zip_code": "35763",
  
  "location": [34.6532, -86.4778],
  
  "price": 485000,
  "bedrooms": 4,
  "bathrooms": 3,
  "square_feet": 2750,
  
  "property_type": "single_family",
  "listing_status": "active",
  
  "school_district": "Madison County",
  "elementary_school": "Hampton Cove Elementary",
  "middle_school": "Hampton Cove Middle",
  "high_school": "Huntsville High",
  
  "has_pool": false,
  "has_garage": true,
  "has_basement": false,
  "has_fenced_yard": true,
  "waterfront": false,
  "new_construction": false,
  
  "tags": ["mountain_view", "family_friendly", "near_trails"],
  
  "city_facet": "Owens Cross Roads",
  "state_facet": "AL",
  "neighborhood_facet": "Hampton Cove",
  "property_type_facet": "single_family",
  "school_district_facet": "Madison County"
}
```

## Example Domain: House Search

### City Model

```typescript
type City = {
  id: string;
  name: string;
  state: string;
  county?: string;
  center_lat: number;
  center_lng: number;
  population?: number;
  median_home_price?: number;
  school_rating_avg?: number;
};
```

### House Model (PostgreSQL)

```typescript
type House = {
  id: string;
  title: string;
  description: string;
  
  // Location
  address_line_1: string;
  city_id: string;
  neighborhood?: string;
  zip_code: string;
  lat: number;
  lng: number;
  
  // Attributes
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  lot_size_acres?: number;
  year_built?: number;
  
  // Categorical
  property_type: 'single_family' | 'townhouse' | 'condo' | 'multi_family' | 'land';
  listing_status: 'active' | 'pending' | 'sold';
  
  // Amenities
  has_pool?: boolean;
  has_garage?: boolean;
  has_basement?: boolean;
  has_fenced_yard?: boolean;
  waterfront?: boolean;
  new_construction?: boolean;
  
  hoa_fee?: number;
  days_on_market?: number;
  
  created_at: string;
  updated_at: string;
};
```

### House Search Document

```typescript
type HouseSearchDocument = {
  objectID: string; // or 'id' depending on search engine
  
  // Searchable text
  title: string;
  description: string;
  
  // Location context (denormalized from city)
  city: string;
  state: string;
  county?: string;
  neighborhood?: string;
  zip_code: string;
  
  // Geo point
  location: [number, number]; // or { lat, lng } for Meilisearch
  
  // Structured attributes
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  lot_size_acres?: number;
  year_built?: number;
  
  // Categorical
  property_type: string;
  listing_status: string;
  school_district?: string;
  elementary_school?: string;
  middle_school?: string;
  high_school?: string;
  
  // Amenities
  has_pool: boolean;
  has_garage: boolean;
  has_basement: boolean;
  has_fenced_yard: boolean;
  waterfront: boolean;
  new_construction: boolean;
  
  hoa_fee?: number;
  days_on_market?: number;
  
  tags?: string[];
  
  // Facet fields (explicit for clarity)
  city_facet: string;
  state_facet: string;
  county_facet?: string;
  neighborhood_facet?: string;
  property_type_facet: string;
  listing_status_facet: string;
  school_district_facet?: string;
};
```

## Document Design Patterns

### Pattern 1: Explicit Facet Fields

Use separate `*_facet` fields for clarity:

```json
{
  "city": "Owens Cross Roads",
  "city_facet": "Owens Cross Roads",
  
  "property_type": "single_family",
  "property_type_facet": "single_family"
}
```

**Pros:**
- Clear intent
- Can differ from display value
- Easy to identify facetable fields

**Cons:**
- Duplication
- More fields

### Pattern 2: Single Field for Display and Facet

```json
{
  "city": "Owens Cross Roads",
  "property_type": "single_family"
}
```

Mark these fields as facetable in search engine config.

**Pros:**
- Less duplication
- Simpler document

**Cons:**
- Less explicit
- Harder to distinguish facet vs display fields

**Recommendation**: Use explicit `*_facet` fields for complex domains with many attributes.

### Pattern 3: Nested Objects

```json
{
  "location": {
    "city": "Owens Cross Roads",
    "state": "AL",
    "county": "Madison",
    "neighborhood": "Hampton Cove"
  }
}
```

**Pros:**
- Logical grouping
- Cleaner structure

**Cons:**
- Search engines may require flattening
- Faceting syntax becomes nested
- Embedding generation harder

**Recommendation**: Avoid deep nesting for search documents. Flatten at root level.

### Pattern 4: Array Fields for Multi-Value

```json
{
  "tags": ["mountain_view", "family_friendly", "near_trails"],
  "amenities": ["garage", "fenced_yard"],
  "schools": [
    "Hampton Cove Elementary",
    "Hampton Cove Middle",
    "Huntsville High"
  ]
}
```

**Pros:**
- Natural for multi-value attributes
- Faceting works well
- Easy to filter

**Cons:**
- May need separate fields for different types
- Harder to maintain relationships

**Recommendation**: Use arrays for tags, amenities, and simple lists. Use separate fields for typed data (elementary_school, middle_school).

## Field Naming Conventions

### Recommended Conventions

```typescript
// Display fields (searchable)
title: string;
description: string;
city: string;
neighborhood: string;

// Facet fields (filterable + facetable)
city_facet: string;
property_type_facet: string;
school_district_facet: string;

// Boolean amenities (filterable)
has_pool: boolean;
has_garage: boolean;
has_basement: boolean;

// Numeric attributes (filterable, sortable)
price: number;
bedrooms: number;
bathrooms: number;

// Special fields (search engine specific)
_geo: { lat: number; lng: number }; // Meilisearch
location: [number, number];         // Typesense

// Arrays (multi-value)
tags: string[];
amenities: string[];

// Optional fields (nullable)
neighborhood?: string;
lot_size_acres?: number;
```

### Naming Rules

1. **Use snake_case** for consistency with databases
2. **Prefix booleans** with `has_`, `is_`, `can_`
3. **Suffix facets** with `_facet` for clarity
4. **Use singular** for single values, plural for arrays
5. **Avoid abbreviations** except common ones (lat/lng, sqft)

## Facet Field Design

### Principle: Separate Display from Facet Value

**Display value** (for UI):
```json
{
  "city": "Owens Cross Roads, AL"
}
```

**Facet value** (for filtering):
```json
{
  "city_facet": "Owens Cross Roads"
}
```

This allows:
- Display: "Owens Cross Roads, AL (82)"
- Filter: city_facet = "Owens Cross Roads"

### Hierarchical Facets

For nested categories:

```json
{
  "location_hierarchy": [
    "United States",
    "United States > Alabama",
    "United States > Alabama > Madison County",
    "United States > Alabama > Madison County > Owens Cross Roads"
  ]
}
```

Search engines can provide hierarchical menu widgets.

### Numeric Range Facets

Don't create buckets in documents. Let search engine or application handle:

```json
{
  "price": 485000,
  "bedrooms": 4
}
```

Application creates ranges:
- $300k - $500k
- $500k - $750k
- $750k+

### Boolean Facets

Store as booleans:

```json
{
  "has_pool": false,
  "has_garage": true,
  "waterfront": false
}
```

UI shows:
- Has pool (124)
- Has garage (856)
- Waterfront (45)

## Geo Field Design

### Meilisearch Format

```json
{
  "_geo": {
    "lat": 34.6532,
    "lng": -86.4778
  }
}
```

Special `_geo` field required.

### Typesense Format

```json
{
  "location": [34.6532, -86.4778]
}
```

Schema defines as `geopoint` type.

### PostgreSQL Format

```sql
-- Separate columns
lat double precision,
lng double precision,

-- Geography column (PostGIS)
geom geography(Point, 4326)
```

### Recommendations

- Store lat/lng as separate fields in PostgreSQL
- Use computed geography column for PostGIS queries
- Transform to search engine format during sync
- Always use WGS84 (SRID 4326) for consistency

## Denormalization Strategy

### What to Denormalize

**Always denormalize:**
- Foreign key references (city name, not city_id)
- Frequently filtered attributes
- Display values for results
- Location context

**Example:**

Instead of:
```json
{
  "city_id": "city_huntsville_al"
}
```

Use:
```json
{
  "city": "Huntsville",
  "state": "AL",
  "county": "Madison"
}
```

### What to Keep Normalized

**Keep in PostgreSQL, reference by ID:**
- User data (for permissions)
- Large binary data (images, PDFs)
- Frequently changing metadata
- Complex relationships

### Materialized vs Real-Time

**Materialized (in search document):**
- School district name
- City population
- Median home price in area

**Real-time (fetch separately):**
- Current user saved status
- View count
- Real-time availability

## Handling Relationships

### One-to-Many (e.g., House → Schools)

**Option 1: Flatten into document**

```json
{
  "elementary_school": "Hampton Cove Elementary",
  "middle_school": "Hampton Cove Middle",
  "high_school": "Huntsville High",
  "school_district": "Madison County"
}
```

Best for fixed cardinality.

**Option 2: Array**

```json
{
  "schools": [
    { "name": "Hampton Cove Elementary", "type": "elementary", "rating": 8 },
    { "name": "Hampton Cove Middle", "type": "middle", "rating": 7 },
    { "name": "Huntsville High", "type": "high", "rating": 9 }
  ]
}
```

Best for variable cardinality.

### Many-to-Many (e.g., House → Amenities)

**Use array:**

```json
{
  "tags": ["mountain_view", "family_friendly", "near_trails", "updated_kitchen"]
}
```

Or separate boolean fields:

```json
{
  "has_mountain_view": true,
  "has_updated_kitchen": true,
  "near_trails": true
}
```

### Parent-Child (e.g., City → Houses)

**Denormalize parent into child:**

```json
{
  "id": "house_1001",
  "city": "Owens Cross Roads",
  "city_population": 9000,
  "city_median_price": 425000
}
```

Don't index City as separate search documents unless needed.

## Schema Evolution

### Adding New Fields

**Safe (non-breaking):**
- Add optional fields
- Add new facet fields
- Add new arrays

**Process:**
1. Update PostgreSQL schema
2. Update search document transformer
3. Backfill existing documents
4. Update search engine settings (if needed)

### Removing Fields

**Process:**
1. Remove from application queries first
2. Deprecate in transformer (keep for backcompat)
3. Remove from search engine settings
4. Finally remove from PostgreSQL

### Renaming Fields

**Process:**
1. Add new field alongside old
2. Update application to use new field
3. Deprecate old field
4. Remove old field after grace period

**Example:**

```json
{
  "property_type": "single_family",          // old
  "property_type_facet": "single_family"     // new
}
```

### Changing Field Types

**Breaking change** - requires reindex:
- String → Array
- Number → String
- Boolean → Number

**Process:**
1. Create new index with new schema
2. Backfill all documents
3. Switch application to new index
4. Delete old index

## Best Practices

### 1. Keep It Flat

Avoid:
```json
{
  "location": {
    "address": {
      "city": {
        "name": "Huntsville"
      }
    }
  }
}
```

Prefer:
```json
{
  "city": "Huntsville",
  "state": "AL"
}
```

### 2. Explicit Facet Fields

Use `*_facet` convention:
```json
{
  "city": "Owens Cross Roads",
  "city_facet": "Owens Cross Roads"
}
```

### 3. Boolean Over Strings

Avoid:
```json
{
  "pool": "yes",
  "garage": "no"
}
```

Prefer:
```json
{
  "has_pool": true,
  "has_garage": false
}
```

### 4. Arrays for Tags

```json
{
  "tags": ["new_construction", "smart_home", "solar"]
}
```

### 5. Standard Geo Format

Follow search engine conventions:
- Meilisearch: `_geo: { lat, lng }`
- Typesense: `location: [lat, lng]`

### 6. Include Context for Embeddings

For semantic search, include descriptive context:

```json
{
  "title": "4 bedroom home near Hampton Cove",
  "description": "Spacious single-family home...",
  "city": "Owens Cross Roads",
  "neighborhood": "Hampton Cove",
  "school_district": "Madison County",
  "property_type": "single_family",
  "tags": ["mountain_view", "family_friendly"]
}
```

These fields provide meaning for vector embeddings.

### 7. Separate Concerns

- **Searchable**: title, description, city
- **Filterable**: price, bedrooms, listing_status
- **Facetable**: city_facet, property_type_facet
- **Sortable**: price, square_feet, days_on_market

Some overlap is fine, but keep intent clear.

## Complete Example

```typescript
// PostgreSQL query for sync
const query = `
  SELECT
    h.id,
    h.title,
    h.description,
    c.name AS city,
    c.state,
    c.county,
    h.neighborhood,
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
    sd.name AS school_district,
    h.has_pool,
    h.has_garage,
    h.has_basement,
    h.has_fenced_yard,
    h.waterfront,
    h.new_construction,
    h.tags
  FROM houses h
  JOIN cities c ON h.city_id = c.id
  LEFT JOIN school_districts sd ON h.school_district_id = sd.id
  WHERE h.listing_status = 'active'
`;

// Transform to search document
function toSearchDocument(row: any): HouseSearchDocument {
  return {
    objectID: row.id,
    title: row.title,
    description: row.description,
    city: row.city,
    state: row.state,
    county: row.county,
    neighborhood: row.neighborhood,
    zip_code: row.zip_code,
    location: [row.lat, row.lng],
    price: row.price,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    square_feet: row.square_feet,
    lot_size_acres: row.lot_size_acres,
    year_built: row.year_built,
    property_type: row.property_type,
    listing_status: row.listing_status,
    school_district: row.school_district,
    has_pool: row.has_pool ?? false,
    has_garage: row.has_garage ?? false,
    has_basement: row.has_basement ?? false,
    has_fenced_yard: row.has_fenced_yard ?? false,
    waterfront: row.waterfront ?? false,
    new_construction: row.new_construction ?? false,
    tags: row.tags ?? [],
    // Facet fields
    city_facet: row.city,
    state_facet: row.state,
    county_facet: row.county,
    neighborhood_facet: row.neighborhood,
    property_type_facet: row.property_type,
    listing_status_facet: row.listing_status,
    school_district_facet: row.school_district
  };
}
```
