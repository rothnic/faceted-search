import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeSearchInformation } from '../../apps/web-angular/src/search/responsive-controls.js';
function fixture(activeId, checked=false) {
  const doc={activeElement:null};
  const ids=['system-summary','system-info-toggle','summary-schema-link','mobile-information','toolbar-heading','toggle-filters','filter-drawer-toggle','search-mode','provider','mobile-mode','mobile-provider'];
  const nodes=Object.fromEntries(ids.map(id=>[id,{id,focus(){doc.activeElement=this;},append(child){child.parentElement=this;doc.activeElement=null;}}]));
  nodes['filter-drawer-toggle'].checked=checked;
  nodes['system-summary'].contains=node=>['system-info-toggle','summary-schema-link'].includes(node.id);
  nodes['system-summary'].parentElement=nodes['toolbar-heading'];
  doc.querySelector=selector=>nodes[selector.replace(/^[#.]/,'')]; doc.getElementById=id=>nodes[id]; doc.activeElement=nodes[activeId];
  return {doc,nodes};
}
test('focused desktop disclosure moves focus to visible Filters when drawer is closed',()=>{
  const {doc,nodes}=fixture('summary-schema-link'); placeSearchInformation(doc,true);
  assert.equal(nodes['system-summary'].parentElement,nodes['mobile-information']); assert.equal(doc.activeElement.id,'toggle-filters');
});
test('open drawer and desktop disclosure preserve their focused link on reparenting',()=>{
  for(const mobile of [true,false]) { const {doc,nodes}=fixture('summary-schema-link',true); nodes['system-summary'].parentElement=nodes[mobile?'toolbar-heading':'mobile-information']; placeSearchInformation(doc,mobile); assert.equal(doc.activeElement.id,'summary-schema-link'); }
});
test('hidden settings controls transfer focus to their visible breakpoint equivalent',()=>{
  for(const [active,mobile,expected] of [['search-mode',true,'toggle-filters'],['provider',true,'toggle-filters'],['mobile-mode',false,'search-mode'],['mobile-provider',false,'provider']]) {
    const {doc}=fixture(active); placeSearchInformation(doc,mobile); assert.equal(doc.activeElement.id,expected);
  }
});
test('drawer rerender restores focus captured before parking the disclosure',()=>{
  const {doc}=fixture('toggle-filters',true); placeSearchInformation(doc,true,'system-info-toggle'); assert.equal(doc.activeElement.id,'system-info-toggle');
});
