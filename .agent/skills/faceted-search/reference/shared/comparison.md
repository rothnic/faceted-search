# Search Engine Comparison

Comprehensive comparison of PostgreSQL, pg_search extension, Meilisearch, and Typesense for faceted, geo-aware, and semantic search.

**Note:** "pg_search" refers to the open source PostgreSQL extension (formerly associated with ParadeDB). It's not an external service.

## Quick Comparison Table

| Aspect | Native PostgreSQL | pg_search | Meilisearch | Typesense |
|--------|------------------|----------|-------------|-----------|
| **Deployment** | Single database | Single database | Separate service | Separate service |
| **Source of truth** | Yes | Yes | No (sync required) | No (sync required) |
| **Setup complexity** | Low | Medium | Low | Medium |
| **Full-text search** | tsvector (good) | BM25 (strong) | BM25-like (strong) | BM25-like (strong) |
| **Search relevance** | Moderate | Strong | Strong | Strong |
| **Faceting** | Manual SQL GROUP BY | Built-in aggregations | Built-in | Built-in |
| **Facet performance** | Slow on large sets | Good | Excellent | Excellent |
| **Geo search** | PostGIS (excellent) | PostGIS (excellent) | Built-in (good) | Built-in (good) |
| **Semantic search** | pgvector | pgvector | Built-in embedders | Built-in auto-embed |
| **Hybrid search** | Manual RRF | BM25 + pgvector RRF | Built-in | Built-in |
| **Embedding management** | Manual | Manual | Managed | Managed |
| **Embedding regeneration** | Manual tracking | Manual tracking | Automatic | Auto (on field change) |
| **InstantSearch.js** | Custom adapter | Custom adapter | Direct adapter | Direct adapter |
| **Typo tolerance** | Limited (pg_trgm) | Limited | Strong | Strong |
| **Autocomplete** | Custom | Custom | Easy | Easy |
| **Schema flexibility** | High | High | Medium | High |
| **Schema conventions** | Manual | Manual | Some patterns | Strong (wildcards) |
| **Frontend complexity** | High | Medium | Low | Low |
| **Backend complexity** | Medium | Medium | Low | Low |
| **Operational complexity** | Lowest | Low | Medium | Medium |
| **Learning curve** | Medium | Medium | Low | Low |
| **Best for** | Simple/internal | Postgres-first + BM25 | Fast shipping | Advanced faceting |

## Detailed Feature Comparison

### Full-Text Search

#### PostgreSQL
- **Mechanism**: tsvector with GIN indexes
- **Ranking**: ts_rank (basic TF-IDF)
- **Strengths**: Integrated with database, good for moderate use
- **Weaknesses**: Limited relevance tuning, no BM25

#### pg_search
- **Mechanism**: BM25 index
- **Ranking**: BM25 (industry standard)
- **Strengths**: Strong relevance, better than tsvector
- **Weaknesses**: Still requires custom frontend adapter

#### Meilisearch
- **Mechanism**: Custom search engine with BM25-like ranking
- **Ranking**: Excellent defaults
- **Strengths**: Fast setup, great out-of-box experience
- **Weaknesses**: Less control over ranking algorithm

#### Typesense
- **Mechanism**: Custom search engine with BM25-like ranking
- **Ranking**: Configurable field weights
- **Strengths**: Strong control, good defaults
- **Weaknesses**: Requires schema planning

**Winner**: pg_search, Meilisearch, Typesense (tie) - all have strong BM25-based ranking

### Faceted Search

#### PostgreSQL
- **Implementation**: Manual SQL GROUP BY
- **Performance**: Slow on large result sets
- **Flexibility**: Complete control
- **Ease of use**: ⭐⭐☆☆☆

Example:
```sql
SELECT city, count(*) FROM houses GROUP BY city;
```

#### pg_search
- **Implementation**: `pdb.agg()` function
- **Performance**: Good
- **Flexibility**: Search-engine-style aggregations
- **Ease of use**: ⭐⭐⭐☆☆

Example:
```sql
SELECT pdb.agg('{"city": {"terms": {"field": "city"}}}') OVER () AS facets
```

#### Meilisearch
- **Implementation**: `facets` parameter
- **Performance**: Excellent
- **Flexibility**: Simple configuration
- **Ease of use**: ⭐⭐⭐⭐⭐

Example:
```typescript
facets: ['city_facet', 'property_type_facet']
```

#### Typesense
- **Implementation**: `facet_by` parameter
- **Performance**: Excellent
- **Flexibility**: Schema-driven, supports wildcards
- **Ease of use**: ⭐⭐⭐⭐⭐

Example:
```typescript
facet_by: 'city_facet,property_type_facet'
```

**Winner**: Meilisearch and Typesense (tie) - both excellent for faceting

### Geo Search

#### PostgreSQL
- **Implementation**: PostGIS extension
- **Capabilities**: Industry-leading geospatial
- **Features**: Radius, bounding box, polygon, distance calc
- **Ease of use**: ⭐⭐⭐⭐☆

**Strengths**:
- Most powerful geo capabilities
- Complex spatial queries
- Accurate distance calculations

#### pg_search
- **Implementation**: PostGIS (same as PostgreSQL)
- **Capabilities**: Industry-leading geospatial
- **Features**: Same as PostgreSQL
- **Ease of use**: ⭐⭐⭐⭐☆

#### Meilisearch
- **Implementation**: Built-in `_geo` field
- **Capabilities**: Radius and bounding box
- **Features**: `_geoRadius()`, `_geoBoundingBox()`, distance sorting
- **Ease of use**: ⭐⭐⭐⭐⭐

**Strengths**:
- Simple API
- Good for common use cases
- Fast

**Weaknesses**:
- Less powerful than PostGIS
- Limited to radius/bbox

#### Typesense
- **Implementation**: Built-in geopoint type
- **Capabilities**: Radius, polygon, exclusion
- **Features**: `location:(lat, lng, radius)`, polygon filtering
- **Ease of use**: ⭐⭐⭐⭐⭐

**Strengths**:
- Simple and powerful
- Polygon support
- Good performance

**Winner**: PostgreSQL/ParadeDB for power, Meilisearch/Typesense for ease of use

### Semantic Search

#### PostgreSQL
- **Implementation**: pgvector extension
- **Embedding generation**: Manual (application-managed)
- **Index**: HNSW or IVFFlat
- **Update strategy**: Manual tracking
- **Ease of use**: ⭐⭐☆☆☆

**Pros**: Full control  
**Cons**: Most work required

#### pg_search
- **Implementation**: pgvector extension
- **Embedding generation**: Manual (application-managed)
- **Index**: HNSW or IVFFlat
- **Update strategy**: Manual tracking
- **Ease of use**: ⭐⭐☆☆☆

Same as PostgreSQL - no difference in embedding management.

#### Meilisearch
- **Implementation**: Built-in embedders
- **Embedding generation**: Managed by Meilisearch
- **Index**: Internal vector index
- **Update strategy**: Document template-based auto-regeneration
- **Ease of use**: ⭐⭐⭐⭐⭐

**Pros**: Easiest to implement, automatic caching  
**Cons**: Less control over embedding pipeline

#### Typesense
- **Implementation**: Built-in auto-embedding
- **Embedding generation**: Managed by Typesense
- **Index**: Internal vector index
- **Update strategy**: `embed.from` field-based regeneration
- **Ease of use**: ⭐⭐⭐⭐⭐

**Pros**: Explicit field control, efficient regeneration  
**Cons**: Built-in model options may be limited

**Winner**: Typesense (best control + ease of use), Meilisearch (easiest overall)

### Hybrid Search

#### PostgreSQL
- **Implementation**: Manual RRF in SQL
- **Complexity**: High
- **Flexibility**: Complete control
- **Ease of use**: ⭐⭐☆☆☆

Example:
```sql
WITH lexical AS (...), semantic AS (...)
SELECT sum(1.0 / (60 + rank)) FROM ...
```

#### pg_search
- **Implementation**: BM25 + pgvector RRF
- **Complexity**: Medium
- **Flexibility**: SQL-based control
- **Ease of use**: ⭐⭐⭐☆☆

Same pattern as PostgreSQL but with BM25 instead of ts_rank.

#### Meilisearch
- **Implementation**: Built-in with `semanticRatio`
- **Complexity**: Low
- **Flexibility**: Ratio-based tuning
- **Ease of use**: ⭐⭐⭐⭐⭐

Example:
```typescript
hybrid: { embedder: 'default', semanticRatio: 0.5 }
```

#### Typesense
- **Implementation**: Include embedding in `query_by`
- **Complexity**: Low
- **Flexibility**: Field weight tuning
- **Ease of use**: ⭐⭐⭐⭐⭐

Example:
```typescript
query_by: 'title,description,embedding',
query_by_weights: '3,2,1'
```

**Winner**: Meilisearch (simplest), Typesense (most flexible)

### Frontend Integration

#### PostgreSQL
- **InstantSearch support**: Custom adapter required
- **Work required**: High
- **Maintainability**: Custom code
- **Ease of use**: ⭐⭐☆☆☆

Must build:
- API endpoint
- Filter parser
- Facet aggregation
- InstantSearch response formatter

#### pg_search
- **InstantSearch support**: Custom adapter required
- **Work required**: Medium-High
- **Maintainability**: Custom code
- **Ease of use**: ⭐⭐⭐☆☆

Similar to PostgreSQL but with built-in faceting.

#### Meilisearch
- **InstantSearch support**: Direct adapter
- **Work required**: Minimal
- **Maintainability**: Official adapter
- **Ease of use**: ⭐⭐⭐⭐⭐

```typescript
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
const { searchClient } = instantMeiliSearch(...);
```

#### Typesense
- **InstantSearch support**: Direct adapter
- **Work required**: Minimal
- **Maintainability**: Official adapter
- **Ease of use**: ⭐⭐⭐⭐⭐

```typescript
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
const adapter = new TypesenseInstantSearchAdapter(...);
```

**Winner**: Meilisearch and Typesense (tie) - both have official adapters

## Use Case Decision Matrix

### Choose PostgreSQL Native When:

✅ **Good fit:**
- Dataset is small (<100k records)
- Search is not a core product feature
- Faceting needs are limited
- You need exact transactional freshness
- Internal admin tools
- Simple search requirements
- Team doesn't want additional services

❌ **Poor fit:**
- Customer-facing search UI
- Heavy faceting requirements
- Need typo tolerance
- Want InstantSearch.js
- Large datasets (>500k records)

### Choose pg_search When:

✅ **Good fit:**
- Must keep search in Postgres
- Need BM25 ranking (better than tsvector)
- Want faceting without external service
- Need hybrid search with vectors
- Complex permissions tied to database
- Team prefers SQL-based solutions
- Comfortable building custom API

❌ **Poor fit:**
- Want fastest time-to-market
- Want off-the-shelf InstantSearch
- Don't want custom adapter work
- Need managed embeddings

### Choose Meilisearch When:

✅ **Good fit:**
- Want to ship quickly
- Need good defaults immediately
- Want typo tolerance out-of-box
- Want simple configuration
- Direct InstantSearch.js integration
- Managed semantic search
- MVP/prototype phase
- Small to medium team

❌ **Poor fit:**
- Need deep schema customization
- Want fine-grained field control
- Frequent schema changes
- Complex custom ranking logic

### Choose Typesense When:

✅ **Good fit:**
- Faceting is core to product
- Need strong schema control
- Want convention-based fields (`*_facet`)
- Explicit embedding field control
- Geo-heavy applications
- Direct InstantSearch.js integration
- Need hybrid search with field weights
- Want efficient embedding regeneration

❌ **Poor fit:**
- Want zero configuration
- Prefer managed everything
- Team unfamiliar with schema design

## Cost Comparison

### Infrastructure Costs

| Solution | Hosting | Compute | Storage |
|----------|---------|---------|---------|
| **PostgreSQL** | Existing DB | +10-20% CPU | Included |
| **ParadeDB** | Existing DB | +15-30% CPU | Included |
| **Meilisearch** | Separate service | $50-500/mo | Separate |
| **Typesense** | Separate service | $50-500/mo | Separate |

### Operational Costs

| Solution | Setup Time | Maintenance | Expertise Required |
|----------|------------|-------------|-------------------|
| **PostgreSQL** | 2-4 weeks | Medium | SQL, PostgreSQL |
| **ParadeDB** | 1-3 weeks | Medium | SQL, PostgreSQL |
| **Meilisearch** | 1-5 days | Low | Basic API |
| **Typesense** | 2-7 days | Low | Schema design |

### Development Costs

| Solution | Frontend Work | Backend Work | Total Dev Time |
|----------|---------------|--------------|----------------|
| **PostgreSQL** | High (custom adapter) | High (query builder) | 3-6 weeks |
| **ParadeDB** | Medium-High | Medium | 2-4 weeks |
| **Meilisearch** | Low (direct adapter) | Low (simple sync) | 1-2 weeks |
| **Typesense** | Low (direct adapter) | Medium (schema + sync) | 1-3 weeks |

## Performance Comparison

### Search Latency (typical)

| Solution | Simple Query | Complex Facets | Semantic | Hybrid |
|----------|--------------|----------------|----------|--------|
| **PostgreSQL** | 10-50ms | 100-500ms | 20-100ms | 50-200ms |
| **ParadeDB** | 5-30ms | 50-200ms | 20-100ms | 40-150ms |
| **Meilisearch** | 5-15ms | 10-30ms | 15-50ms | 20-60ms |
| **Typesense** | 5-15ms | 10-30ms | 15-50ms | 20-60ms |

*Results vary based on dataset size, hardware, and query complexity.*

### Scalability

| Solution | Ideal Dataset Size | Max Practical Size |
|----------|-------------------|-------------------|
| **PostgreSQL** | <100k | ~500k |
| **ParadeDB** | <500k | ~2M |
| **Meilisearch** | <1M | ~10M+ |
| **Typesense** | <1M | ~10M+ |

## Migration Paths

### From PostgreSQL Native

**To ParadeDB**: Easy (same database)
- Install extension
- Create BM25 index
- Adjust queries

**To Meilisearch**: Medium
- Set up Meilisearch instance
- Build sync pipeline
- Update frontend

**To Typesense**: Medium
- Set up Typesense cluster
- Define schema
- Build sync pipeline
- Update frontend

### From pg_search

**To PostgreSQL**: Easy (downgrade)
- Remove BM25 index
- Use tsvector

**To Meilisearch/Typesense**: Medium (same as from PostgreSQL)

## Recommendations by Team Size

### Solo Developer / Small Startup
**Recommended**: Meilisearch
- Fastest time to value
- Good defaults
- Minimal maintenance

### Small Team (2-5 developers)
**Recommended**: Typesense or Meilisearch
- Typesense if faceting is core
- Meilisearch if speed is priority

### Medium Team (5-15 developers)
**Recommended**: Typesense or ParadeDB
- Typesense for customer-facing
- ParadeDB if Postgres-first architecture

### Large Team (15+ developers)
**Recommended**: Typesense or custom solution
- Resources for proper schema design
- Can handle operational complexity

## Real-World Scenarios

### Scenario 1: Real Estate Search (like the example)
**Best choice**: **Typesense**
- Heavy faceting (city, type, bedrooms, etc.)
- Geo search is core
- Semantic search for intent queries
- Customer-facing UI

### Scenario 2: E-commerce Product Search
**Best choice**: **Meilisearch**
- Fast time to market
- Good faceting
- Typo tolerance critical
- Frequent updates

### Scenario 3: Internal Admin Dashboard
**Best choice**: **PostgreSQL Native** or **ParadeDB**
- Already have Postgres
- Internal users (tolerant of limitations)
- Don't need polish
- Tight integration with other data

### Scenario 4: Job Board
**Best choice**: **Typesense**
- Location-based matching
- Skills faceting
- Semantic job description matching
- Need hybrid search

### Scenario 5: Document/Knowledge Base Search
**Best choice**: **Meilisearch** or **Typesense**
- Semantic search critical
- Less faceting, more text
- Typo tolerance important
- Either works well

## Summary Recommendations

| Priority | Recommendation |
|----------|---------------|
| **Fastest to ship** | Meilisearch |
| **Best faceting** | Typesense |
| **Most powerful geo** | PostgreSQL + PostGIS |
| **Best hybrid search** | Typesense |
| **Lowest infrastructure** | ParadeDB |
| **Easiest maintenance** | Meilisearch |
| **Best schema control** | Typesense |
| **Best for Postgres-first teams** | ParadeDB |
| **Best for MVP** | Meilisearch |
| **Best for production at scale** | Typesense |

**Overall winner for location-based faceted search**: **Typesense** (best balance of features, control, and ease of use)

**Runner-up**: **Meilisearch** (fastest to implement, great for MVPs)
