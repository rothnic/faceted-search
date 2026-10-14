import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSearchSettings, renderSearchBar, renderResultsToolbar, renderSortControl, SORT_LABELS } from '../../apps/web-angular/src/search/controls.js';
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const request = {q:'garage',mode:'keyword',provider:'postgres_native',sort:'price_desc'};
test('shared settings render distinct desktop/drawer IDs with the same selected state', () => {
  for(const mobile of [false,true]) {
    const html=renderSearchSettings(request,[{id:'postgres_native',label:'PostgreSQL'},{id:'custom',label:'<unsafe>'}],escape,mobile);
    assert.match(html,/value="postgres_native" selected/); assert.match(html,/value="keyword" selected/);
    assert.ok(html.includes(`id="${mobile?'mobile-provider':'provider'}"`));
    assert.ok(html.includes('&lt;unsafe>')); assert.ok(!html.includes('<unsafe>'));
  }
});
test('search stays independently labeled with query-clear and escaped input', () => {
  const html=renderSearchBar({...request,q:'"<query>'},escape);
  assert.match(html,/for="search-box">Search/); assert.match(html,/aria-label="Clear query"/);
  assert.match(html,/&quot;&lt;query>/);
  assert.match(renderSearchBar({...request,q:''},escape),/aria-label="Clear query" hidden/);
});
test('Sort shows each current value rather than an icon-only field', () => {
  for(const [sort,label] of Object.entries(SORT_LABELS)) {
    const html=renderSortControl(sort);
    assert.ok(html.includes(`value="${sort}" selected>${label}</option>`));
    assert.ok(html.includes(`--sort-label-ch:${label.length}`));
    assert.match(html,/aria-label="Sort results"/);
  }
});
test('one results toolbar exposes honest N, one Sort and independent filter/view/save actions', () => {
  const html=renderResultsToolbar({request,response:{totalHits:35,mapHits:[{id:'one'}]},view:'list',facetCount:2,chips:'<div class="refinements">facet</div>'});
  for(const id of ['sort','toggle-filters','mobile-view-toggle','save-search']) assert.equal(html.split(`id="${id}"`).length-1,1);
  assert.match(html,/Matching homes">35/); assert.ok(!html.includes(' of '));
  assert.match(html,/2 active filters/); assert.match(html,/aria-label="Show map"/);
  assert.match(html,/class="refinements"/);
});
test('pending and zero states preserve usable filter/sort controls without inventing a count or map', () => {
  const pending=renderResultsToolbar({request,response:null,view:'list',facetCount:0,chips:''});
  assert.match(pending,/Matching homes">…/); assert.match(pending,/id="save-search" disabled/);
  assert.ok(!pending.includes('class="refinements"'));
  const empty=renderResultsToolbar({request,response:{totalHits:0,mapHits:[]},view:'map',facetCount:0,chips:''});
  assert.match(empty,/Matching homes">0/); assert.match(empty,/aria-label="Show map" disabled/);
  assert.ok(!empty.includes('id="save-search" disabled'));
});
