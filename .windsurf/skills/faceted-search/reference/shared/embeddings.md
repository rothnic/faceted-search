# Embedding Strategy for Semantic Search

Guide for generating and managing vector embeddings for semantic and hybrid search.

## Contents

- [What Are Embeddings](#what-are-embeddings)
- [Which Fields to Embed](#which-fields-to-embed)
- [Building Semantic Text](#building-semantic-text)
- [Embedding Generation](#embedding-generation)
- [Update Strategies](#update-strategies)
- [PostgreSQL + pgvector](#postgresql-pgvector)
- [pg_search Embeddings](#pgsearch-embeddings)
- [Meilisearch Embedders](#meilisearch-embedders)
- [Typesense Auto-Embedding](#typesense-auto-embedding)
- [External Embedding Services](#external-embedding-services)
- [Performance Considerations](#performance-considerations)
- [Cost Management](#cost-management)

## What Are Embeddings

**Vector embeddings** are dense numerical representations of text that capture semantic meaning. They enable:

- **Semantic search**: Find conceptually similar content
- **Intent matching**: Match user intent, not just keywords
- **Multilingual search**: Cross-language similarity
- **Hybrid search**: Combine with keyword search

Example query: `"quiet home with space for kids"`

May match houses with:
- "large fenced backyard"
- "cul-de-sac location"
- "bonus room"
- "near elementary school"
- "family-friendly neighborhood"

Even though none of these exact words appear in the query.

## Which Fields to Embed

### Do Embed (Semantic Fields)

✅ **Text descriptions**
- title
- description
- summary

✅ **Location context**
- city
- neighborhood
- school_district
- area_description

✅ **Categorical context**
- property_type (with context: "single family home")
- style (with context: "modern farmhouse style")

✅ **Features and amenities**
- tags: ["mountain_view", "walkable", "near_trails"]
- amenities: ["updated_kitchen", "hardwood_floors"]

### Don't Embed (Structured Fields)

❌ **Numeric attributes**
- price (use filter)
- bedrooms (use filter)
- bathrooms (use filter)
- square_feet (use filter)
- lot_size_acres (use filter)
- year_built (use filter)

❌ **Dates and timestamps**
- created_at
- updated_at
- days_on_market

❌ **IDs and keys**
- id
- city_id
- user_id

❌ **Raw booleans**
- has_pool (can mention in context: "includes pool")
- has_garage (can mention: "two-car garage")

❌ **Status flags**
- listing_status
- is_active
- is_featured

### Include with Context

⚠️ **Structured data that provides meaning**

Instead of:
```
bedrooms: 4
bathrooms: 3
```

Include as:
```
"4 bedrooms, 3 bathrooms"
```

This provides semantic context without emphasizing the exact numbers.

## Building Semantic Text

### Pattern: Narrative Description

```typescript
function buildHouseSemanticText(house: House): string {
  const parts: string[] = [];
  
  // Core description
  parts.push(`Title: ${house.title}`);
  parts.push(`Description: ${house.description}`);
  
  // Location context
  if (house.neighborhood) {
    parts.push(`Located in ${house.neighborhood}, ${house.city}, ${house.state}`);
  } else {
    parts.push(`Located in ${house.city}, ${house.state}`);
  }
  
  // School context
  if (house.school_district) {
    parts.push(`School district: ${house.school_district}`);
  }
  
  // Property context
  parts.push(`Property type: ${house.property_type.replace('_', ' ')}`);
  parts.push(`${house.bedrooms} bedrooms, ${house.bathrooms} bathrooms`);
  
  // Amenities (convert booleans to descriptive text)
  const amenities: string[] = [];
  if (house.has_garage) amenities.push('garage');
  if (house.has_pool) amenities.push('pool');
  if (house.has_basement) amenities.push('basement');
  if (house.has_fenced_yard) amenities.push('fenced yard');
  if (house.waterfront) amenities.push('waterfront');
  if (house.new_construction) amenities.push('new construction');
  
  if (amenities.length > 0) {
    parts.push(`Features: ${amenities.join(', ')}`);
  }
  
  // Tags
  if (house.tags && house.tags.length > 0) {
    parts.push(`Attributes: ${house.tags.join(', ')}`);
  }
  
  return parts.filter(Boolean).join('\n');
}
```

Example output:
```
Title: 4 bedroom home near Hampton Cove
Description: Spacious single-family home with fenced yard, two-car garage, mountain views, and access to nearby walking trails.
Located in Hampton Cove, Owens Cross Roads, AL
School district: Madison County
Property type: single family
4 bedrooms, 3 bathrooms
Features: garage, fenced yard
Attributes: mountain_view, family_friendly, near_trails
```

### Pattern: Compact Template

```typescript
function buildCompactSemanticText(house: House): string {
  return [
    house.title,
    house.description,
    `${house.neighborhood || ''} ${house.city}, ${house.state}`,
    house.school_district,
    house.property_type.replace('_', ' '),
    house.tags?.join(' ')
  ]
    .filter(Boolean)
    .join('. ');
}
```

Example output:
```
4 bedroom home near Hampton Cove. Spacious single-family home with fenced yard, two-car garage, mountain views, and access to nearby walking trails. Hampton Cove Owens Cross Roads, AL. Madison County. single family. mountain_view family_friendly near_trails
```

### Pattern: Structured Template (for Meilisearch)

```handlebars
House: {{doc.title}}.
Description: {{doc.description}}.
Location: {{doc.neighborhood}}, {{doc.city}}, {{doc.state}}.
School district: {{doc.school_district}}.
Property type: {{doc.property_type}}.
Bedrooms: {{doc.bedrooms}}.
Bathrooms: {{doc.bathrooms}}.
Features: {{doc.tags}}.
```

## Embedding Generation

### Embedding Providers

**OpenAI**
- Models: text-embedding-3-small (1536d), text-embedding-3-large (3072d)
- Cost: $0.02 / 1M tokens (3-small), $0.13 / 1M tokens (3-large)
- Quality: Excellent
- Speed: ~50-200ms per batch

**HuggingFace**
- Models: all-MiniLM-L6-v2, all-MiniLM-L12-v2, etc.
- Cost: Free (self-hosted) or inference API
- Quality: Good
- Speed: Depends on hardware

**Cohere**
- Models: embed-english-v3.0, embed-multilingual-v3.0
- Cost: $0.10 / 1M tokens
- Quality: Excellent
- Speed: Fast

**Typesense Built-in**
- Models: ts/all-MiniLM-L12-v2
- Cost: Included
- Quality: Good
- Speed: Fast (local)

### Token Estimation

Rough estimate: 1 token ≈ 4 characters

For houses:
```
Title: ~20 tokens
Description: ~100 tokens
Location: ~10 tokens
Context: ~30 tokens
Total: ~160 tokens per house
```

Cost for 100k houses with OpenAI:
```
100,000 houses × 160 tokens = 16M tokens
16M tokens × $0.02 / 1M = $0.32
```

## Update Strategies

### When to Regenerate Embeddings

**Always regenerate when these change:**
- title
- description
- city / neighborhood
- school_district
- property_type
- tags / amenities (if included)

**Never regenerate when only these change:**
- price
- listing_status
- days_on_market
- view_count
- updated_at (metadata only)

### Tracking Semantic Changes

```typescript
const SEMANTIC_FIELDS = new Set([
  'title',
  'description',
  'city',
  'neighborhood',
  'school_district',
  'property_type',
  'has_garage',
  'has_pool',
  'has_basement',
  'has_fenced_yard',
  'waterfront',
  'new_construction',
  'tags'
]);

function shouldRegenerateEmbedding(
  changedFields: string[]
): boolean {
  return changedFields.some(field => 
    SEMANTIC_FIELDS.has(field)
  );
}

// Usage
const changedFields = ['price', 'days_on_market'];
if (shouldRegenerateEmbedding(changedFields)) {
  await updateEmbedding(house);
} else {
  // Skip embedding generation
}
```

## PostgreSQL + pgvector

### Schema

```sql
ALTER TABLE houses
ADD COLUMN semantic_text text,
ADD COLUMN embedding vector(1536);

CREATE INDEX houses_embedding_hnsw_idx
ON houses
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### Generation Pipeline

```typescript
import { OpenAI } from 'openai';
import { pool } from './db';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  
  return response.data[0].embedding;
}

async function updateHouseEmbedding(houseId: string) {
  // Fetch house data
  const house = await pool.query(
    'SELECT * FROM houses WHERE id = $1',
    [houseId]
  );
  
  const row = house.rows[0];
  
  // Build semantic text
  const semanticText = buildHouseSemanticText(row);
  
  // Generate embedding
  const embedding = await generateEmbedding(semanticText);
  
  // Store in database
  await pool.query(
    `
    UPDATE houses
    SET semantic_text = $1,
        embedding = $2,
        updated_at = now()
    WHERE id = $3
    `,
    [semanticText, `[${embedding.join(',')}]`, houseId]
  );
}
```

### Batch Generation

```typescript
async function batchGenerateEmbeddings(batchSize: number = 100) {
  const result = await pool.query(`
    SELECT id, title, description, city, neighborhood, school_district, 
           property_type, bedrooms, bathrooms, has_garage, has_pool, 
           has_basement, has_fenced_yard, waterfront, new_construction, tags
    FROM houses
    WHERE embedding IS NULL
      AND listing_status = 'active'
    LIMIT $1
  `, [batchSize]);
  
  for (const row of result.rows) {
    const semanticText = buildHouseSemanticText(row);
    const embedding = await generateEmbedding(semanticText);
    
    await pool.query(
      `
      UPDATE houses
      SET semantic_text = $1,
          embedding = $2
      WHERE id = $3
      `,
      [semanticText, `[${embedding.join(',')}]`, row.id]
    );
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

## pg_search Embeddings

Same as PostgreSQL + pgvector. The pg_search extension doesn't manage embeddings.

## Meilisearch Embedders

### Configuration

```typescript
await client.index('houses').updateEmbedders({
  'houses-openai': {
    source: 'openAi',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    dimensions: 1536,
    documentTemplate: `
House: {{doc.title}}.
Description: {{doc.description}}.
Location: {{doc.neighborhood}}, {{doc.city}}, {{doc.state}}.
School district: {{doc.school_district}}.
Property type: {{doc.property_type}}.
Bedrooms: {{doc.bedrooms}}.
Features: {{doc.tags}}.
    `.trim()
  }
});
```

### How It Works

1. You configure embedder with document template
2. Meilisearch generates embeddings automatically when documents are added/updated
3. Embeddings are cached
4. Only regenerates when template fields change
5. Batching is automatic

### Updating Documents

```typescript
// Just update the document - embedding regenerates automatically
await client.index('houses').updateDocuments([
  {
    id: 'house_1001',
    title: 'Updated title',
    description: 'Updated description'
  }
]);
```

If `title` or `description` changed, embedding regenerates.  
If only `price` changed, embedding is reused.

### Multiple Embedders

```typescript
await client.index('houses').updateEmbedders({
  'default': {
    source: 'openAi',
    model: 'text-embedding-3-small',
    documentTemplate: '...'
  },
  'detailed': {
    source: 'openAi',
    model: 'text-embedding-3-large',
    documentTemplate: '...' // More detailed template
  }
});

// Use specific embedder
await client.index('houses').search('query', {
  hybrid: {
    embedder: 'detailed',
    semanticRatio: 0.8
  }
});
```

## Typesense Auto-Embedding

### Schema Configuration

```typescript
{
  name: 'embedding',
  type: 'float[]',
  embed: {
    from: [
      'title',
      'description',
      'city',
      'neighborhood',
      'school_district',
      'property_type',
      'tags'
    ],
    model_config: {
      model_name: 'ts/all-MiniLM-L12-v2'
    }
  }
}
```

### How It Works

1. You list fields in `embed.from`
2. Typesense concatenates those fields
3. Generates embedding using built-in model
4. Only regenerates when `embed.from` fields change

### Updating Documents

```typescript
// These changes regenerate embedding (in embed.from):
await client.collections('houses').documents('house_1001').update({
  title: 'Updated title',
  description: 'Updated description'
});

// These don't regenerate embedding (not in embed.from):
await client.collections('houses').documents('house_1001').update({
  price: 475000,
  days_on_market: 21
});
```

### External Embeddings

If you prefer external service:

```typescript
{
  name: 'embedding',
  type: 'float[]',
  num_dim: 1536  // No embed config
}

// Include embedding in document
{
  id: 'house_1001',
  title: '...',
  embedding: [0.123, -0.456, ...] // Provide your own
}
```

## External Embedding Services

### OpenAI

```typescript
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    encoding_format: 'float'
  });
  
  return response.data[0].embedding;
}

// Batch
async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts // Up to 2048 inputs
  });
  
  return response.data.map(d => d.embedding);
}
```

### HuggingFace Inference API

```typescript
async function embed(text: string): Promise<number[]> {
  const response = await fetch(
    'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HF_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: text })
    }
  );
  
  return response.json();
}
```

### Cohere

```typescript
import { CohereClient } from 'cohere-ai';

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY
});

async function embed(texts: string[]): Promise<number[][]> {
  const response = await cohere.embed({
    texts,
    model: 'embed-english-v3.0',
    inputType: 'search_document'
  });
  
  return response.embeddings;
}
```

## Performance Considerations

### Batch Processing

Always batch when possible:

```typescript
// Bad: One at a time
for (const house of houses) {
  const embedding = await embed(house.semanticText);
  await saveEmbedding(house.id, embedding);
}

// Good: Batch requests
const texts = houses.map(h => h.semanticText);
const embeddings = await embedBatch(texts);

for (let i = 0; i < houses.length; i++) {
  await saveEmbedding(houses[i].id, embeddings[i]);
}
```

### Rate Limiting

```typescript
async function generateWithRateLimit(
  items: any[],
  ratePerMinute: number
) {
  const delay = (60 * 1000) / ratePerMinute;
  
  for (const item of items) {
    await generateEmbedding(item);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
```

### Caching

```typescript
const embeddingCache = new Map<string, number[]>();

async function getCachedEmbedding(text: string): Promise<number[]> {
  if (embeddingCache.has(text)) {
    return embeddingCache.get(text)!;
  }
  
  const embedding = await generateEmbedding(text);
  embeddingCache.set(text, embedding);
  return embedding;
}
```

### Async Processing

Use background jobs:

```typescript
// Trigger on house update
await db.query('UPDATE houses SET ... WHERE id = $1', [id]);
await queue.add('generate-embedding', { houseId: id });

// Worker processes queue
queue.process('generate-embedding', async (job) => {
  const { houseId } = job.data;
  await updateHouseEmbedding(houseId);
});
```

## Cost Management

### Estimation

```typescript
function estimateEmbeddingCost(
  numDocuments: number,
  avgTokens: number,
  costPer1MTokens: number
): number {
  const totalTokens = numDocuments * avgTokens;
  return (totalTokens / 1_000_000) * costPer1MTokens;
}

// Example: 100k houses, 160 tokens avg, OpenAI 3-small
const cost = estimateEmbeddingCost(100_000, 160, 0.02);
console.log(`Estimated cost: $${cost.toFixed(2)}`); // $0.32
```

### Strategies to Reduce Cost

1. **Use smaller models**
   - text-embedding-3-small instead of 3-large
   - Local models (HuggingFace) if acceptable quality

2. **Reduce semantic text length**
   - Only include essential fields
   - Trim long descriptions

3. **Skip unchanged documents**
   - Track semantic field changes
   - Only regenerate when needed

4. **Use built-in embedders**
   - Typesense includes free embedding
   - No API costs

5. **Cache aggressively**
   - Meilisearch caches automatically
   - Build your own cache for PostgreSQL

6. **Batch generation during off-peak**
   - Process updates in batches
   - Schedule during low-traffic hours

## Best Practices

1. **Keep semantic text focused**
   - Only include meaning-rich fields
   - Exclude structured data

2. **Build consistent templates**
   - Use same format for all documents
   - Include sufficient context

3. **Track what changes**
   - Only regenerate when semantic fields change
   - Monitor embedding staleness

4. **Test embedding quality**
   - Validate with real user queries
   - Measure semantic search relevance

5. **Monitor costs**
   - Track API usage
   - Set up alerts for unusual spikes

6. **Use appropriate dimensions**
   - 384-512d for basic needs (HuggingFace models)
   - 1536d for better quality (OpenAI 3-small)
   - 3072d only if needed (OpenAI 3-large)

7. **Batch operations**
   - Generate embeddings in batches
   - Use async processing

8. **Choose right tool**
   - Meilisearch: hands-off, automatic
   - Typesense: explicit control, built-in model
   - PostgreSQL: full control, more work
