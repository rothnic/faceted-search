import assert from 'node:assert/strict';
import pg from 'pg';
import { RealServices } from '../apps/api/src/real-services.js';
import { cities, neighborhoods } from '../packages/test-fixtures/src/cities.fixture.js';
import { houses } from '../packages/test-fixtures/src/houses.fixture.js';
import { DATABASE_SCHEMA_SQL } from '../apps/api/src/schema.js';
import { PostgresSearch, POSTGRES_SEARCH_SCHEMA_SQL } from '../apps/api/src/postgres-search.js';
import { embedTexts, EMBEDDING_MODEL, EMBEDDING_MODEL_KEY, EmbeddingUnavailableError, embeddingContentHash } from '../apps/api/src/embeddings.js';
import type { HouseSearchRequest } from '../packages/search-contracts/src/search-provider.interface.js';

// This verifier uses real PostgreSQL, pgvector and pinned CPU model inference.
// It never accepts an application's DATABASE_URL or installs mock components.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/^faceted_postgres_search_test(?:_[a-z0-9]+)?$/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)))) {
  throw new Error('Set TEST_DATABASE_URL to a disposable faceted_postgres_search_test database.');
}
const pool = new pg.Pool({ connectionString: databaseUrl });
const engine = new PostgresSearch(pool);
const checks: string[] = [];
const base: HouseSearchRequest = { provider: 'postgres_native', q: '', mode: 'keyword', filters: {}, sort: 'relevance', page: 1, pageSize: 50, includeFacets: true };
const search = (input: Partial<HouseSearchRequest> = {}, scope?: string[]) => engine.search({ ...base, ...input }, scope);
const ids = (result: Awaited<ReturnType<typeof search>>) => result.hits.map((hit) => hit.id);
async function refreshVectors() {
  const { rows } = await pool.query<{ house_id: string; search_text: string; desired_version: string }>(`SELECT s.*,w.desired_version FROM house_search_documents s JOIN house_embedding_work w ON w.house_id=s.house_id`);
  const vectors = await embedTexts(rows.map((row) => row.search_text));
  for (let i=0; i<rows.length; i++) {
    const row=rows[i];
    await pool.query(`INSERT INTO house_embeddings(house_id,model_key,content_hash,embedding,model,source_version)
      VALUES($1,$2,$3,$4::vector,$5::jsonb,$6) ON CONFLICT(house_id) DO UPDATE SET model_key=EXCLUDED.model_key,
      content_hash=EXCLUDED.content_hash,embedding=EXCLUDED.embedding,model=EXCLUDED.model,source_version=EXCLUDED.source_version`,
    [row.house_id, EMBEDDING_MODEL_KEY, embeddingContentHash(row.search_text), `[${Array.from(vectors[i]).join(',')}]`, JSON.stringify(EMBEDDING_MODEL), row.desired_version]);
  }
}
try {
  await pool.query(DATABASE_SCHEMA_SQL);
  await pool.query(POSTGRES_SEARCH_SCHEMA_SQL);
  await pool.query('TRUNCATE houses,cities CASCADE');
  await pool.query(`INSERT INTO cities VALUES('near','Near City','AL','County',34,-86),('far','Far City','AL','County',38,-86);
    INSERT INTO neighborhoods VALUES('garden','near','Garden District',34,-86),('center','near','Center',34.01,-86),('forest','far','Forest',38,-86)`);
  for (const [id,title,description,city,n,lat,price,beds,baths,sqft,year,lot,type,status,updated] of [
    ['a','Garden cottage','A home for running with a beautiful garden and quiet fenced yard','near','garden',34,200000,3,2,1800,2005,0.5,'single_family','active','2026-01-01'],
    ['b','City condominium','Single-level condo with walkable dining and low maintenance finishes','near','center',34.01,300000,2,1.5,1200,2010,0,'condo','active','2026-01-02'],
    ['c','Forest cabin','Secluded mountain retreat surrounded by trees','far','forest',38,100000,1,1,900,1990,2,'single_family','pending','2026-01-03'],
    ['d','Second garden cottage','A home with a garden and quiet fenced yard','near','garden',34.02,400000,4,3,2200,2020,1,'single_family','sold','2026-01-04']
  ] as const) {
    await pool.query(`INSERT INTO houses(id,title,description,city_id,neighborhood_id,address_line_1,zip_code,lat,lng,
      price,bedrooms,bathrooms,square_feet,year_built,lot_size_acres,property_type,listing_status,school_district,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'1 Test Lane','00000',$6,-86,$7,$8,$9,$10,$11,$12,$13,$14,'Test Schools',$15,$15)`,
    [id,title,description,city,n,lat,price,beds,baths,sqft,year,lot,type,status,updated]);
  }
  await pool.query(`INSERT INTO house_amenities VALUES('a','garden'),('a','fenced_yard'),('b','garage'),('d','garden');
    INSERT INTO house_tags VALUES('a','family_friendly'),('b','walkable')`);
  const all = await search();
  assert.equal(all.totalHits,4); assert.equal(all.mapHits.length,4);
  assert.deepEqual(ids(await search({q:'gardens'})),['d','a']);
  assert.deepEqual(ids(await search({q:'runs'})),['a'], 'English stemming must match running');
  assert.equal((await search({q:'"quiet fenced"'})).totalHits,2);
  assert.equal((await search({q:'garden OR forest'})).totalHits,3);
  assert.equal((await search({q:'garden -second'})).totalHits,1);
  assert.equal((await search({q:'the and'})).totalHits,0);
  assert.equal((await search({q:"x'); DROP TABLE houses; --"})).totalHits,0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM houses')).rows[0].count,4);
  await pool.query('SET enable_seqscan=off');
  const plan=(await pool.query(`EXPLAIN SELECT house_id FROM house_search_documents WHERE search_vector @@ websearch_to_tsquery('english','garden')`)).rows.map((row)=>row['QUERY PLAN']).join('\n');
  assert.match(plan,/house_search_documents_fts_idx/); await pool.query('RESET enable_seqscan');
  checks.push('real English FTS stemming, phrases, boolean/negative queries, SQL-injection safety, and GIN index eligibility');
  const combined=await search({filters:{city:['Near City'],neighborhood:['Garden District'],schoolDistrict:['Test Schools'],propertyType:['single_family'],listingStatus:['active'],bedrooms:[3],minPrice:200000,maxPrice:200000,minBedrooms:3,minBathrooms:2,minSquareFeet:1800,minYearBuilt:2005,maxYearBuilt:2005,minLotSize:0.5,maxLotSize:0.5,amenities:['garden','fenced_yard']}});
  assert.deepEqual(ids(combined),['a']);
  assert.equal((await search({filters:{maxPrice:0}})).totalHits,0);
  assert.deepEqual(ids(await search({filters:{maxLotSize:0}})),['b']);
  assert.deepEqual(ids(await search({filters:{amenities:['garden','garage']}})),[]);
  const scoped=await search({pageSize:1,sort:'price_asc'},['a','b']);
  assert.deepEqual(ids(scoped),['a']); assert.deepEqual(scoped.mapHits.map((hit)=>hit.id),['a','b']);
  assert.equal(scoped.totalHits,2); assert.deepEqual(scoped.facets.city,[{value:'Near City',count:2}]);
  assert.equal((await search({},[])).totalHits,0);
  assert.deepEqual((await search({includeFacets:false})).facets,{});
  assert.equal((await search({page:99,pageSize:1})).hits.length,0);
  assert.deepEqual(ids(await search({sort:'price_desc'})),['d','b','a','c']);
  assert.deepEqual(ids(await search({sort:'newest'})),['d','c','b','a']);
  const near=await search({geo:{lat:34,lng:-86,radiusMiles:1},sort:'distance'});
  assert.deepEqual(ids(near),['a','b']); assert.equal(near.hits[0].distanceMiles,0);
  assert(Math.abs(near.hits[1].distanceMiles!-0.69094)<0.001);
  assert.deepEqual(ids(await search({viewport:{minLat:33.99,maxLat:34.015,minLng:-86.01,maxLng:-85.99},sort:'price_asc'})),['a','b']);
  checks.push('all declared filters, zero-valued bounds, all-of amenities, sorting, radius/viewport, saved scope, pages/count/maps/facets in one relation');
  await refreshVectors();
  const semantic=await search({q:'effortless upkeep condominium beside eateries',mode:'semantic'});
  assert.equal(semantic.hits[0].id,'b'); assert(semantic.hits[0].semanticScore!>0.45);
  assert.equal(semantic.mapHits.length,semantic.totalHits);
  assert.equal(semantic.facets.city.reduce((sum,bucket)=>sum+bucket.count,0),semantic.totalHits);
  const hybrid=await search({q:'quiet garden',mode:'hybrid'});
  assert(hybrid.hits.some((hit)=>hit.id==='a')); assert.match(hybrid.debug.sql,/ts_rank\(/); assert.match(hybrid.debug.sql,/<=>/);
  assert.equal((await search({q:'garden',mode:'hybrid'},['c'])).mapHits.every((hit)=>hit.id==='c'),true);
  assert.equal((await search({q:'anything',mode:'semantic'},[])).totalHits,0);
  checks.push('real pinned MiniLM query/document inference, pgvector cosine SQL, hybrid SQL, and semantic map/facet agreement');
  if (process.env.TEST_PG_SEARCH === '1') {
    const bm25 = await search({provider:'pg_search',q:'garden'});
    assert.equal(bm25.totalHits,2); assert(bm25.hits.every((hit)=>hit.score>0));
    assert.match(bm25.debug.sql,/pdb.score/); assert.match(bm25.debug.sql,/search_text \\|\\|\\|/);
    const bm25Page = await search({provider:'pg_search',q:'garden',pageSize:1,sort:'price_asc'},['a','d']);
    assert.deepEqual(ids(bm25Page),['a']); assert.equal(bm25Page.mapHits.length,2);
    assert.deepEqual(bm25Page.facets.city,[{value:'Near City',count:2}]);
    const bm25Semantic = await search({provider:'pg_search',q:'effortless upkeep condominium beside eateries',mode:'semantic'});
    assert.equal(bm25Semantic.hits[0].id,'b');
    const bm25Hybrid = await search({provider:'pg_search',q:'quiet garden',mode:'hybrid'});
    assert(bm25Hybrid.hits.some((hit)=>hit.id==='a'));
    assert.equal(bm25Hybrid.totalHits,bm25Hybrid.mapHits.length);
    const score = (await pool.query(`SELECT pdb.score(house_id) AS score FROM house_search_documents WHERE search_text ||| $1::text AND house_id='a'`,['garden'])).rows[0].score;
    assert(Math.abs(bm25.hits.find((hit)=>hit.id==='a')!.score - score/(1+score)*100)<0.0001);
    checks.push('real pg_search0.26 BM25 scores, relational CTE join, page/map/facet agreement, semantic and hybrid modes');
  } else {
    await assert.rejects(()=>search({provider:'pg_search',q:'garden'}),/pg_search is unavailable/);
    checks.push('uninstalled pg_search fails explicitly without fallback');
  }
  for (const statement of [
    "UPDATE house_embeddings SET model_key='obsolete' WHERE house_id='a'",
    "UPDATE house_embeddings SET source_version=0 WHERE house_id='a'",
    "DELETE FROM house_embeddings WHERE house_id='a'"
  ]) {
    await pool.query(statement);
    await assert.rejects(()=>search({q:'garden',mode:'semantic'}),EmbeddingUnavailableError);
    assert.equal((await search({q:'gardens'})).totalHits,2);
    await refreshVectors();
  }
  await pool.query("UPDATE houses SET title='Transactional zebra' WHERE id='a'");
  assert.deepEqual(ids(await search({q:'zebra'})),['a']);
  await assert.rejects(()=>search({q:'garden',mode:'hybrid'}),EmbeddingUnavailableError);
  const tx=await pool.connect();
  try { await tx.query('BEGIN'); await tx.query("UPDATE houses SET title='Rollback giraffe' WHERE id='a'"); await tx.query('ROLLBACK'); }
  finally {tx.release();}
  assert.equal((await search({q:'giraffe'})).totalHits,0);
  await pool.query("UPDATE cities SET name='Renamedville' WHERE id='near'");
  assert.equal((await search({q:'renamedville'})).totalHits,3);
  await pool.query("UPDATE neighborhoods SET name='Orchid' WHERE id='garden'");
  assert.equal((await search({q:'orchid'})).totalHits,2);
  await pool.query("INSERT INTO house_amenities VALUES('a','observatory'); INSERT INTO house_tags VALUES('a','astronomy')");
  assert.deepEqual(ids(await search({q:'observatory astronomy'})),['a']);
  await pool.query('TRUNCATE house_tags');
  assert.equal((await search({q:'astronomy'})).totalHits,0);
  await pool.query("UPDATE houses SET deleted_at=now() WHERE id='a'");
  assert.equal((await search({q:'zebra'})).totalHits,0); assert.equal((await search()).totalHits,3);
  await pool.query("DELETE FROM houses WHERE id='b'");
  assert.equal((await search()).totalHits,2);
  checks.push('fail-closed missing/stale model and source versions; transactional source/join/tag/amenity/truncate refresh; rollback and soft/hard deletion');
  await pool.query("UPDATE houses SET title=E'\\n\\t Unicode \u00a0Home \u2003' WHERE id='c'");
  await refreshVectors();
  await search({q:'home',mode:'semantic'});
  const coherent = await search({q:'',filters:{minPrice:0}});
  for (const hit of coherent.hits) {
    assert.equal(hit.price,coherent.mapHits.find((map)=>map.id===hit.id)?.price);
    assert(typeof hit.description==='string' && Array.isArray(hit.amenities));
  }
  checks.push('complete hit metadata shares the SQL result snapshot; semantic generation fencing accepts valid whitespace/Unicode source text');
  const fixtureServices = new RealServices({databaseUrl,meiliHost:'http://127.0.0.1:1',meiliKey:'',typesenseHost:'http://127.0.0.1:1',typesenseKey:'',syncProviders:[]});
  try {
    await fixtureServices.seed(cities,neighborhoods,houses,[]);
    const documents=(await fixtureServices.loadHouses()).map((house)=>fixtureServices.documentFor(house));
    const stored=(await pool.query(`SELECT house_id,search_text,
      encode(sha256(convert_to(left(replace(btrim(search_text), '_', ' '), 8192), 'UTF8')), 'hex') AS hash
      FROM house_search_documents`)).rows;
    assert.equal(stored.length,126);
    for (const row of stored) {
      const document=documents.find((item)=>item.id===row.house_id)!;
      assert.equal(row.search_text,document.semanticText,`SQL source text differs for ${row.house_id}`);
      assert.equal(row.hash,embeddingContentHash(document.semanticText),`SQL source hash differs for ${row.house_id}`);
    }
    await refreshVectors();
    for (const provider of process.env.TEST_PG_SEARCH==='1' ? ['postgres_native','pg_search'] as const : ['postgres_native'] as const) {
      assert.equal((await search({provider})).totalHits,126);
      const full=await search({provider,q:'effortless upkeep condominium beside eateries',mode:'semantic',pageSize:2});
      assert.equal(full.hits[0].id,'target-retiree-low-maintenance');
      assert.equal(full.mapHits.length,full.totalHits);
      assert.equal(full.facets.city.reduce((sum,bucket)=>sum+bucket.count,0),full.totalHits);
    }
    checks.push('full 126-house fixture: SQL/Node semantic-text and SHA256 parity, real document inference, both PostgreSQL semantic engines and all-hit maps/facets');
  } finally { await fixtureServices.close(); }
  console.log(JSON.stringify({ok:true,postgres:(await pool.query('SELECT version()')).rows[0].version,checks,plan},null,2));
} finally { await pool.end(); }
