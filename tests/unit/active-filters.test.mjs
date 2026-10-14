import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeFilters, clearFacetCriteria, clearQueryCriteria, removeFacetCriteria } from '../../apps/web-angular/src/search/active-filters.js';

const request = () => ({ provider:'typesense', mode:'hybrid', q:'garage', sort:'price_desc', page:4, pageSize:18, includeFacets:true,
  savedSearchIds:['one','two'], filters:{ city:['Huntsville','Madison'], minPrice:0, maxPrice:500000, bedrooms:[0,3], amenities:[] },
  geo:{ lat:34, lng:-86, radiusMiles:0 }, viewport:{ minLat:33,maxLat:35,minLng:-87,maxLng:-85 } });

test('facet clear preserves query, provider, mode, sort and union scopes, resets page', () => {
  const before=request(); const next=clearFacetCriteria(before);
  assert.deepEqual(next,{provider:'typesense',mode:'hybrid',q:'garage',sort:'price_desc',page:1,pageSize:18,includeFacets:true,savedSearchIds:['one','two'],filters:{}});
  assert.equal(before.page,4); assert.equal(before.filters.minPrice,0); assert.ok(before.geo);
});
test('query clear changes only query and page, including with every facet and scope active', () => {
  const before=request(); assert.deepEqual(clearQueryCriteria(before),{...before,q:'',page:1}); assert.equal(before.q,'garage');
});
test('chips contain facets and geography only, retain numeric zero and omit empty values', () => {
  const before=request(); before.filters.unset=undefined; before.filters.blank=''; before.filters.nullValue=null;
  const parts=activeFilters(before);
  assert.equal(parts.length,8);
  assert.ok(parts.some(p=>p.key==='minPrice'&&p.value===0));
  assert.ok(parts.some(p=>p.key==='bedrooms'&&p.value===0));
  assert.ok(parts.some(p=>p.action==='geo'&&p.value===0));
  assert.ok(parts.every(p=>['filter','geo','viewport'].includes(p.action)));
  assert.deepEqual(activeFilters({...before,filters:{},geo:undefined,viewport:undefined}),[]);
});
test('each array removal changes only its represented value, including string dataset zero', () => {
  const before=request();
  for (const [key,value,remaining] of [['city','Madison',['Huntsville']],['bedrooms','0',[3]]]) {
    const next=removeFacetCriteria(before,{action:'filter',key,value});
    assert.deepEqual(next,{...before,page:1,filters:{...before.filters,[key]:remaining}});
  }
  const last=removeFacetCriteria({...before,filters:{city:['Madison']}},{action:'filter',key:'city',value:'Madison'});
  assert.deepEqual(last.filters,{}); assert.deepEqual(before.filters.city,['Huntsville','Madison']);
});
test('scalar, radius and viewport removal each preserve every other criterion', () => {
  const before=request();
  const scalar=removeFacetCriteria(before,{action:'filter',key:'minPrice',value:'0'});
  const {minPrice,...filters}=before.filters; assert.deepEqual(scalar,{...before,page:1,filters});
  for (const action of ['geo','viewport']) {
    const expected={...before,page:1}; delete expected[action];
    assert.deepEqual(removeFacetCriteria(before,{action}),expected);
  }
});
test('queries and scope IDs cannot be removed through the facet action contract', () => {
  const before=request();
  for(const action of ['q','saved']) assert.deepEqual(removeFacetCriteria(before,{action,value:'one'}),{...before,page:1});
});
