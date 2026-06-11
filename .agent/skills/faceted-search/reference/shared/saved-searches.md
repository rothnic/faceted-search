# Saved Searches and Alerting

Complete guide for implementing saved searches with alerting for faceted search applications.

## Contents

- [Overview](#overview)
- [Key Requirements](#key-requirements)
- [Data Model](#data-model)
- [Validation](#validation)
- [Evaluation Strategies](#evaluation-strategies)
- [PostgreSQL Implementation](#postgresql-implementation)
- [Meilisearch Integration](#meilisearch-integration)
- [Typesense Integration](#typesense-integration)
- [Alert Delivery](#alert-delivery)
- [Best Practices](#best-practices)

## Overview

Saved searches allow users to:
- Save complex search criteria
- Receive alerts when new matches appear
- Track inventory changes over time
- Monitor specific market segments

**Critical insight**: Allow zero-hit saved searches. Users often want to save searches even when no current matches exist.

## Key Requirements

### 1. Allow Zero-Hit Saved Searches

Users should be able to save searches with no current matches:

```text
User: "Save this search"
System: "No active matches right now"
Action: Still allow save + notify when matches appear
```

**Bad UX**:
```
❌ "Cannot save search with zero results"
```

**Good UX**:
```
✅ "Saved! We'll notify you when matching houses are listed."
```

### 2. Validate Filter Attributes

Only allow known, safe filterable fields:

```typescript
const ALLOWED_FILTERS = new Set([
  'city_facet',
  'neighborhood_facet',
  'school_district_facet',
  'property_type_facet',
  'price',
  'bedrooms',
  'bathrooms',
  'square_feet',
  'has_pool',
  'has_garage',
  'has_basement',
  'has_fenced_yard',
  'waterfront',
  'new_construction'
]);
```

Reject:
- Arbitrary user-supplied fields
- Internal metadata fields
- Security-sensitive fields

### 3. Track Seen Results

Prevent duplicate notifications:

```typescript
type SavedSearch = {
  id: string;
  seen_house_ids: string[]; // Already notified
  last_evaluated_at: Date;
};
```

### 4. Support Multiple Alert Frequencies

```typescript
type AlertFrequency = 
  | 'instant'  // Notify immediately
  | 'daily'    // Daily digest
  | 'weekly'   // Weekly digest
  | 'never';   // Saved but no alerts
```

## Data Model

### Saved Search Table

```sql
CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name text,
  criteria jsonb NOT NULL,
  
  alert_enabled boolean NOT NULL DEFAULT true,
  alert_frequency text NOT NULL DEFAULT 'instant',
  
  last_evaluated_at timestamptz,
  last_notified_at timestamptz,
  
  seen_house_ids uuid[] NOT NULL DEFAULT '{}',
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT alert_frequency_check CHECK (
    alert_frequency IN ('instant', 'daily', 'weekly', 'never')
  )
);

CREATE INDEX saved_searches_user_id_idx ON saved_searches(user_id);
CREATE INDEX saved_searches_alert_enabled_idx ON saved_searches(alert_enabled) WHERE alert_enabled = true;
CREATE INDEX saved_searches_last_evaluated_idx ON saved_searches(last_evaluated_at) WHERE alert_enabled = true;
```

### Criteria Structure

```typescript
type HouseSearchCriteria = {
  // Search query
  q?: string;
  
  // Search mode
  search_mode: 'keyword' | 'semantic' | 'hybrid';
  
  // Status filter
  listing_status?: 'active' | 'pending' | 'sold';
  
  // Geo filter
  geo?: {
    mode: 'radius' | 'bounding_box' | 'city' | 'none';
    
    center?: {
      lat: number;
      lng: number;
    };
    
    radius_miles?: number;
    
    bounding_box?: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
    
    city?: string;
    state?: string;
  };
  
  // Attribute filters
  filters: {
    city_facet?: string[];
    neighborhood_facet?: string[];
    school_district_facet?: string[];
    property_type_facet?: string[];
    
    min_price?: number;
    max_price?: number;
    
    min_bedrooms?: number;
    min_bathrooms?: number;
    min_square_feet?: number;
    min_lot_size_acres?: number;
    min_year_built?: number;
    
    has_pool?: boolean;
    has_garage?: boolean;
    has_basement?: boolean;
    has_fenced_yard?: boolean;
    waterfront?: boolean;
    new_construction?: boolean;
    
    tags?: string[];
  };
  
  // Sort preference
  sort?: 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'newest' | 'days_on_market';
};
```

### TypeScript Model

```typescript
type SavedHouseSearch = {
  id: string;
  user_id: string;
  
  name?: string;
  criteria: HouseSearchCriteria;
  
  alert_enabled: boolean;
  alert_frequency: 'instant' | 'daily' | 'weekly' | 'never';
  
  last_evaluated_at?: Date;
  last_notified_at?: Date;
  
  seen_house_ids: string[];
  
  created_at: Date;
  updated_at: Date;
};
```

## Validation

### Validate Criteria

```typescript
function validateSavedSearchCriteria(
  criteria: HouseSearchCriteria
): void {
  // Validate filter fields
  for (const key of Object.keys(criteria.filters)) {
    if (!ALLOWED_FILTERS.has(key)) {
      throw new Error(`Unsupported filter field: ${key}`);
    }
  }
  
  // Validate price range
  if (criteria.filters.min_price && criteria.filters.max_price) {
    if (criteria.filters.min_price > criteria.filters.max_price) {
      throw new Error('Minimum price cannot exceed maximum price');
    }
  }
  
  // Validate geo criteria
  if (criteria.geo?.mode === 'radius') {
    if (!criteria.geo.center || !criteria.geo.radius_miles) {
      throw new Error('Radius search requires center point and radius');
    }
    if (criteria.geo.radius_miles <= 0 || criteria.geo.radius_miles > 100) {
      throw new Error('Radius must be between 0 and 100 miles');
    }
  }
  
  // Validate bounding box
  if (criteria.geo?.mode === 'bounding_box') {
    const { north, south, east, west } = criteria.geo.bounding_box || {};
    if (!north || !south || !east || !west) {
      throw new Error('Bounding box requires all coordinates');
    }
    if (south >= north) {
      throw new Error('South latitude must be less than north latitude');
    }
  }
}
```

### Preview Before Saving

```typescript
async function saveSearch(
  userId: string,
  criteria: HouseSearchCriteria,
  allowZeroHits: boolean = true
) {
  // Validate criteria
  validateSavedSearchCriteria(criteria);
  
  // Preview results
  const preview = await runSearchPreview(criteria, { limit: 1 });
  
  // Check if zero hits
  if (!allowZeroHits && preview.totalHits === 0) {
    throw new Error('This search has no current matches');
  }
  
  // Save
  const savedSearch = await db.savedSearch.create({
    data: {
      user_id: userId,
      criteria,
      alert_enabled: true,
      alert_frequency: 'instant',
      seen_house_ids: preview.hits.map(h => h.id)
    }
  });
  
  return {
    savedSearch,
    currentMatches: preview.totalHits
  };
}
```

## Evaluation Strategies

### Strategy 1: Scheduled Polling

Evaluate all active saved searches periodically:

```typescript
async function evaluateSavedSearches() {
  const searches = await db.query(`
    SELECT *
    FROM saved_searches
    WHERE alert_enabled = true
      AND (
        last_evaluated_at IS NULL 
        OR last_evaluated_at < now() - interval '15 minutes'
      )
    ORDER BY last_evaluated_at NULLS FIRST
    LIMIT 100
  `);
  
  for (const search of searches.rows) {
    try {
      await evaluateSearch(search);
    } catch (error) {
      console.error(`Failed to evaluate search ${search.id}:`, error);
    }
  }
}

// Run every 15 minutes
setInterval(evaluateSavedSearches, 15 * 60 * 1000);
```

### Strategy 2: Event-Driven

Evaluate when houses are added/updated:

```typescript
async function onHouseCreated(house: House) {
  // Find potentially matching saved searches
  const searches = await findMatchingSearches(house);
  
  for (const search of searches) {
    await evaluateSearch(search);
  }
}

async function findMatchingSearches(house: House) {
  // Basic filters to narrow down
  return db.query(`
    SELECT *
    FROM saved_searches
    WHERE alert_enabled = true
      AND (
        criteria->'filters'->>'city_facet' IS NULL
        OR criteria->'filters'->>'city_facet' @> $1::jsonb
      )
      AND (
        criteria->'filters'->>'min_price' IS NULL
        OR (criteria->'filters'->>'min_price')::int <= $2
      )
      AND (
        criteria->'filters'->>'max_price' IS NULL
        OR (criteria->'filters'->>'max_price')::int >= $2
      )
  `, [JSON.stringify([house.city]), house.price]);
}
```

### Strategy 3: Hybrid

- Scheduled polling for most searches
- Event-driven for high-priority users
- Frequency-based (instant, daily, weekly)

## PostgreSQL Implementation

### Evaluate Search with pg_search

```typescript
async function evaluateSearchPgSearch(
  search: SavedHouseSearch
): Promise<House[]> {
  const { criteria } = search;
  
  // Build query
  let query = `
    SELECT
      h.id,
      h.title,
      h.city,
      h.state,
      h.price,
      h.bedrooms,
      pdb.score(h.id) AS score
    FROM houses h
    WHERE listing_status = 'active'
      AND h.id <> ALL($1::uuid[])
  `;
  
  const params: any[] = [search.seen_house_ids];
  let paramIndex = 2;
  
  // Text search
  if (criteria.q) {
    query += ` AND h.title @@@ $${paramIndex}`;
    params.push(criteria.q);
    paramIndex++;
  }
  
  // Price range
  if (criteria.filters.min_price) {
    query += ` AND h.price >= $${paramIndex}`;
    params.push(criteria.filters.min_price);
    paramIndex++;
  }
  if (criteria.filters.max_price) {
    query += ` AND h.price <= $${paramIndex}`;
    params.push(criteria.filters.max_price);
    paramIndex++;
  }
  
  // Bedrooms
  if (criteria.filters.min_bedrooms) {
    query += ` AND h.bedrooms >= $${paramIndex}`;
    params.push(criteria.filters.min_bedrooms);
    paramIndex++;
  }
  
  // City filter
  if (criteria.filters.city_facet?.length) {
    query += ` AND h.city = ANY($${paramIndex}::text[])`;
    params.push(criteria.filters.city_facet);
    paramIndex++;
  }
  
  // Geo filter
  if (criteria.geo?.mode === 'radius' && criteria.geo.center) {
    query += `
      AND ST_DWithin(
        h.geom,
        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
        $${paramIndex + 2} * 1609.344
      )
    `;
    params.push(
      criteria.geo.center.lng,
      criteria.geo.center.lat,
      criteria.geo.radius_miles
    );
    paramIndex += 3;
  }
  
  query += ` ORDER BY score DESC LIMIT 25`;
  
  const result = await db.query(query, params);
  return result.rows;
}
```

## Meilisearch Integration

```typescript
async function evaluateSearchMeilisearch(
  search: SavedHouseSearch
): Promise<House[]> {
  const { criteria } = search;
  
  // Build filter
  const filters: string[] = ['listing_status_facet = active'];
  
  if (criteria.filters.city_facet?.length) {
    const cities = criteria.filters.city_facet
      .map(c => `"${c}"`)
      .join(', ');
    filters.push(`city_facet IN [${cities}]`);
  }
  
  if (criteria.filters.min_price) {
    filters.push(`price >= ${criteria.filters.min_price}`);
  }
  
  if (criteria.filters.max_price) {
    filters.push(`price <= ${criteria.filters.max_price}`);
  }
  
  if (criteria.filters.min_bedrooms) {
    filters.push(`bedrooms >= ${criteria.filters.min_bedrooms}`);
  }
  
  if (criteria.geo?.mode === 'radius' && criteria.geo.center) {
    const meters = Math.round(criteria.geo.radius_miles! * 1609.344);
    filters.push(
      `_geoRadius(${criteria.geo.center.lat}, ${criteria.geo.center.lng}, ${meters})`
    );
  }
  
  // Execute search
  const results = await meilisearch.index('houses').search(
    criteria.q || '',
    {
      filter: filters,
      hybrid: criteria.search_mode === 'hybrid' ? {
        embedder: 'houses-openai',
        semanticRatio: 0.5
      } : undefined,
      limit: 25
    }
  );
  
  // Filter out already seen
  const newHits = results.hits.filter(
    h => !search.seen_house_ids.includes(h.id)
  );
  
  return newHits;
}
```

## Typesense Integration

```typescript
async function evaluateSearchTypesense(
  search: SavedHouseSearch
): Promise<House[]> {
  const { criteria } = search;
  
  // Build filter
  const filters: string[] = ['listing_status:=active'];
  
  if (criteria.filters.city_facet?.length) {
    filters.push(`city_facet:=[${criteria.filters.city_facet.join(',')}]`);
  }
  
  if (criteria.filters.min_price) {
    filters.push(`price:>=${criteria.filters.min_price}`);
  }
  
  if (criteria.filters.max_price) {
    filters.push(`price:<=${criteria.filters.max_price}`);
  }
  
  if (criteria.filters.min_bedrooms) {
    filters.push(`bedrooms:>=${criteria.filters.min_bedrooms}`);
  }
  
  if (criteria.geo?.mode === 'radius' && criteria.geo.center) {
    filters.push(
      `location:(${criteria.geo.center.lat}, ${criteria.geo.center.lng}, ${criteria.geo.radius_miles} mi)`
    );
  }
  
  // Build query_by based on search mode
  let queryBy: string;
  if (criteria.search_mode === 'semantic') {
    queryBy = 'embedding';
  } else if (criteria.search_mode === 'hybrid') {
    queryBy = 'title,description,city,neighborhood,embedding';
  } else {
    queryBy = 'title,description,city,neighborhood';
  }
  
  // Execute search
  const results = await typesense
    .collections('houses')
    .documents()
    .search({
      q: criteria.q || '*',
      query_by: queryBy,
      filter_by: filters.join(' && '),
      per_page: 25
    });
  
  // Filter out already seen
  const newHits = results.hits
    ?.map((h: any) => h.document)
    .filter((h: any) => !search.seen_house_ids.includes(h.id)) || [];
  
  return newHits;
}
```

## Alert Delivery

### Update Saved Search After Evaluation

```typescript
async function evaluateAndNotify(search: SavedHouseSearch) {
  // Evaluate search
  const newMatches = await evaluateSearch(search);
  
  // Update last_evaluated_at
  await db.query(
    `
    UPDATE saved_searches
    SET last_evaluated_at = now()
    WHERE id = $1
    `,
    [search.id]
  );
  
  // If no new matches, done
  if (newMatches.length === 0) {
    return;
  }
  
  // Check alert frequency
  const shouldNotify = shouldSendAlert(search);
  
  if (shouldNotify) {
    // Send notification
    await sendAlert(search, newMatches);
    
    // Update seen IDs and last_notified_at
    const newSeenIds = [
      ...search.seen_house_ids,
      ...newMatches.map(h => h.id)
    ];
    
    await db.query(
      `
      UPDATE saved_searches
      SET seen_house_ids = $1,
          last_notified_at = now()
      WHERE id = $2
      `,
      [newSeenIds, search.id]
    );
  }
}

function shouldSendAlert(search: SavedHouseSearch): boolean {
  if (!search.alert_enabled) return false;
  if (search.alert_frequency === 'never') return false;
  if (search.alert_frequency === 'instant') return true;
  
  const now = new Date();
  const lastNotified = search.last_notified_at;
  
  if (!lastNotified) return true;
  
  const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
  
  if (search.alert_frequency === 'daily') {
    return hoursSince >= 24;
  }
  
  if (search.alert_frequency === 'weekly') {
    return hoursSince >= 24 * 7;
  }
  
  return false;
}
```

### Send Alert

```typescript
async function sendAlert(
  search: SavedHouseSearch,
  newMatches: House[]
) {
  const user = await getUser(search.user_id);
  
  // Send email
  await sendEmail({
    to: user.email,
    subject: `${newMatches.length} new matches for your saved search`,
    template: 'saved-search-alert',
    data: {
      searchName: search.name || 'Your saved search',
      matches: newMatches,
      searchUrl: `/search/${search.id}`
    }
  });
  
  // Optional: Push notification
  if (user.push_enabled) {
    await sendPushNotification({
      userId: user.id,
      title: 'New matches found',
      body: `${newMatches.length} new houses match your search`,
      data: { searchId: search.id }
    });
  }
  
  // Log notification
  await db.query(
    `
    INSERT INTO saved_search_notifications (
      saved_search_id,
      house_ids,
      notification_type,
      sent_at
    ) VALUES ($1, $2, $3, now())
    `,
    [search.id, newMatches.map(h => h.id), 'email']
  );
}
```

## Best Practices

### 1. Allow Zero-Hit Searches

Always allow users to save searches even with no current matches:

```typescript
const allowZeroHits = true; // Default to true
```

### 2. Validate Inputs

Only allow known, safe filter fields:

```typescript
validateSavedSearchCriteria(criteria);
```

### 3. Track Seen Results

Prevent duplicate notifications:

```typescript
const newHits = hits.filter(h => !search.seen_house_ids.includes(h.id));
```

### 4. Rate Limit Evaluations

Don't overwhelm search engines:

```typescript
// Max 100 searches per evaluation cycle
const searches = await getSearchesToEvaluate(limit = 100);
```

### 5. Handle Failures Gracefully

```typescript
try {
  await evaluateSearch(search);
} catch (error) {
  console.error(`Failed to evaluate search ${search.id}:`, error);
  // Continue to next search
}
```

### 6. Provide Search Management UI

- View all saved searches
- Edit criteria
- Disable/enable alerts
- Change alert frequency
- Delete saved searches
- See notification history

### 7. Optimize for Common Filters

Index commonly used criteria fields:

```sql
CREATE INDEX saved_searches_city_gin_idx 
ON saved_searches USING gin ((criteria->'filters'->'city_facet'));
```

### 8. Monitor Performance

- Track evaluation time per search
- Monitor alert delivery success rate
- Watch for stale searches (not evaluated recently)
- Alert on evaluation failures

### 9. Clean Up Stale Searches

```sql
-- Delete searches not evaluated in 6 months
DELETE FROM saved_searches
WHERE alert_enabled = true
  AND last_evaluated_at < now() - interval '6 months';
```

### 10. Provide Clear Expectations

Tell users:
- How often searches are evaluated
- When they'll receive alerts
- That zero-hit searches are allowed
- How to modify alert settings

Example messaging:
```
✅ Search saved! 
We'll check for new matches every 15 minutes and notify you when houses matching your criteria are listed.
```
