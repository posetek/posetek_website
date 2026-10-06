'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {encode}=require('./training-cloud.cjs');
const {EQUIPMENT,canonical,sourceHash,validateManifest,validateRequirements,requirementsSatisfied,ensureReviewBoundary}=require('./training-access-lib.cjs');
const {buildPlan,verifyPlan,assertSameSnapshot,writesFor,verifyAfter}=require('./training-access-catalog.cjs');
const manifest=JSON.parse(fs.readFileSync('content/training-access/requirements.json','utf8'));
const equipment=JSON.parse(fs.readFileSync('content/training-access/equipment.json','utf8'));
const clone=value=>structuredClone(value);
const ROOT='projects/kickai-69dd0/databases/(default)/documents/';
function document(path,data){return {name:ROOT+path,fields:encode(data).mapValue.fields,createTime:'2026-09-01T00:00:00.000000Z',updateTime:'2026-09-26T08:00:00.000001Z'};}
function fixture(){
  const m=clone(manifest),records=new Map(m.records.map(r=>[r.drillId,r]));
  const catalog=m.inventory.map(item=>{
    const source=records.get(item.drillId)?.provenance.source;
    const raw=source ? {...source,...(item.rawStatus==null?{}:{status:item.rawStatus})} : {drillId:item.drillId,name:item.name,schemaVersion:2,equipment:[],status:item.rawStatus};
    if(item.classification==='whole-body-draft'){raw.productionBatchId='whole-body-2026-09';raw.trainingPolicy={reviewStatus:'pending'};}
    item.sourceHash=sourceHash(item.drillId,raw);
    const doc=document('drillCatalog/'+item.drillId,{...raw,media:{primaryDemo:{status:'approved',generation:'immutable-generation'}},untouchedNested:{values:[1,'preserve',false]}});
    doc.fields.originalTimestamp={timestampValue:'2026-09-01T00:00:00Z'};return doc;
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const authors=m.inventory.filter(i=>i.classification==='whole-body-draft').map(i=>document('drillCatalogAuthoring/'+i.drillId,{revision:1,reviewStatus:'pending',reviewedContentHash:null}));
  const before={catalog,authors,meta:document('drillCatalogMeta/current',{catalogVersion:'1.0.91',unrelated:{preserve:true}}),config:document('config/llm',{wholeBodyTraining:{mobileVerified:false},personalWorkoutsEnabled:true,unrelated:42})};
  const plan=buildPlan(m,equipment,before);return {m,before,plan};
}
function applied(plan){
  const after=clone(plan.before),patches=new Map(plan.patches.map(p=>[p.name,p]));
  for(const doc of after.catalog){const p=patches.get(doc.name);if(p){Object.assign(doc.fields,encode(p.fields).mapValue.fields,{updatedAt:{timestampValue:'2026-09-26T09:00:00Z'}});doc.updateTime='2026-09-26T09:00:00Z';}}
  Object.assign(after.meta.fields,encode({catalogVersion:plan.catalogVersionAfter,updatedBy:'operator:training-access-requirements',lastChange:{kind:'training-access-requirements',count:54,manifestSha256:plan.manifestSha256}}).mapValue.fields,{updatedAt:{timestampValue:'2026-09-26T09:00:00Z'}});return after;
}
test('all208 records accounted, all54 executable maps source-bound, all28 tokens labeled',()=>{
  assert.deepEqual(validateManifest(manifest,equipment),{inventory:208,requirements:54,wholeBodyUntouched:80,equipmentTokens:28,equipmentCorrections:2,heldForClarification:['HJP-003','SPD-006','STR-004']});
  const types=fs.readFileSync('app/src/lib/contracts/types.ts','utf8').match(/export const EQUIPMENT = ([\s\S]*?) as const;/)[1];
  assert.deepEqual(JSON.parse(types.replace(/,\s*\]/,']')),[...EQUIPMENT]);
});
test('only two clear missing equipment lists change, supported by authored setup',()=>{
  for(const [id,expected] of [['BMA-501',['ball','cones']],['SHT-502',['ball','cones','goal']]]){
    const r=manifest.records.find(r=>r.drillId===id);assert.deepEqual(r.equipmentCorrection,expected);assert.deepEqual(r.accessRequirements.equipment.allOf,expected);assert.notEqual(r.sourceHashBefore,r.accessRequirements.sourceHash);
  }
});
test('bodyweight/no-equipment is usable; empty availability never means wildcard',()=>{
  const access={schemaVersion:1,confirmed:true,facility:'home',participantCount:1,space:{}};
  const bodyweight=manifest.records.find(r=>r.drillId==='STR-002').accessRequirements;
  const mat=manifest.records.find(r=>r.drillId==='STR-005').accessRequirements;
  assert.equal(requirementsSatisfied(bodyweight,[],access),true);assert.equal(requirementsSatisfied(mat,[],access),false);assert.equal(requirementsSatisfied(mat,['mat'],access),true);
  assert.equal(requirementsSatisfied(mat,[],{...access,facility:'gym'}),false);
});
test('numeric dimensions, overhead and goal-area need their exact capability; facility grants none',()=>{
  const access={schemaVersion:1,confirmed:true,facility:'pitch',participantCount:1,space:{}};
  const square=manifest.records.find(r=>r.drillId==='VJP-001').accessRequirements;
  assert.equal(requirementsSatisfied(square,['markers'],access),false);
  assert.equal(requirementsSatisfied(square,['markers'],{...access,space:{lengthMeters:2,widthMeters:2}}),true);
  const shooting=manifest.records.find(r=>r.drillId==='SHT-502').accessRequirements;
  assert.equal(requirementsSatisfied(shooting,['ball','cones','goal'],access),false);
  assert.equal(requirementsSatisfied(shooting,['ball','cones','goal'],{...access,space:{goalArea:true}}),true);
  const jump=manifest.records.find(r=>r.drillId==='VJP-002').accessRequirements;
  assert.equal(requirementsSatisfied(jump,[],access),false);assert.equal(requirementsSatisfied(jump,[],{...access,space:{overheadClear:true}}),true);
});
test('participant minimum preserves stricter normalized partner requirement',()=>{
  for(const id of ['STR-007','STR-008']){const r=manifest.records.find(r=>r.drillId===id).accessRequirements;assert.equal(r.participantMin,2);assert.equal(requirementsSatisfied(r,EQUIPMENT,{schemaVersion:1,confirmed:true,participantCount:1,space:{}}),false);}
});
test('sufficient-space assumption covers missing clearance only, with explicit restrictions authoritative',()=>{
  const access={schemaVersion:1,confirmed:true,facility:'home',participantCount:1,space:{assumedSufficient:true}};
  const square=manifest.records.find(r=>r.drillId==='VJP-001').accessRequirements;
  assert.equal(requirementsSatisfied(square,['markers'],access),true);
  assert.equal(requirementsSatisfied(square,['markers'],{...access,space:{assumedSufficient:true,lengthMeters:1}}),false);
  assert.equal(requirementsSatisfied(square,['markers'],{...access,space:{assumedSufficient:true,widthMeters:1}}),false);
  assert.equal(requirementsSatisfied(square,['markers'],{...access,space:{assumedSufficient:false}}),false);
  const jump=manifest.records.find(r=>r.drillId==='VJP-002').accessRequirements;
  assert.equal(requirementsSatisfied(jump,[],access),true);
  assert.equal(requirementsSatisfied(jump,[],{...access,space:{assumedSufficient:true,overheadClear:false}}),false);
  const shooting=manifest.records.find(r=>r.drillId==='SHT-502').accessRequirements;
  assert.equal(requirementsSatisfied(shooting,['ball','cones','goal'],access),false);
  const partner=manifest.records.find(r=>r.drillId==='STR-008').accessRequirements;
  assert.equal(requirementsSatisfied(partner,['bench','mat'],access),false);
  assert.equal(requirementsSatisfied(square,[],access),false);
});
test('only the three explicit unresolved constraints hold access-aware selection',()=>{
  for(const r of manifest.records.filter(r=>r.accessRequirements.unknowns.length))assert.equal(requirementsSatisfied(r.accessRequirements,EQUIPMENT,{schemaVersion:1,confirmed:true,facility:'pitch',participantCount:12,space:{lengthMeters:1000,widthMeters:1000,overheadClear:true,goalArea:true}}),false);
  assert.ok(manifest.records.every(r=>!r.accessRequirements.space.surfaces));
  assert.ok(manifest.records.every(r=>!r.accessRequirements.equipment.anyOf.length),'No unsupported substitute is invented');
});
test('hash binds all authored evidence, ignores media and object insertion order',()=>{
  const r=manifest.records.find(r=>r.drillId==='STR-005'),base=r.provenance.source;
  assert.equal(sourceHash(r.drillId,base),r.sourceHashBefore);
  assert.equal(sourceHash(r.drillId,{...base,media:{status:'approved'}}),r.sourceHashBefore);
  for(const patch of [{equipment:[]},{setup:'Changed setup'},{cues:['Changed cue']},{coachComments:['Changed instruction']},{playersMin:2}])assert.notEqual(sourceHash(r.drillId,{...base,...patch}),r.sourceHashBefore);
  assert.equal(sourceHash(r.drillId,Object.fromEntries(Object.entries(base).reverse())),r.sourceHashBefore);
});
test('cross-language fixtures preserve Unicode, legacy null fields and corrected equipment hashes',()=>{
  const fixtures=JSON.parse(fs.readFileSync('content/training-access/source-hash-fixtures.json','utf8'));
  assert.equal(fixtures.fixtures.length,7);
  for(const row of fixtures.fixtures)assert.equal(sourceHash(row.drillId,row.raw),row.expectedSourceHash,row.name);
});
test('malformed, duplicate and unmapped equipment requirements fail lint',()=>{
  const r=clone(manifest.records[0].accessRequirements);r.equipment.allOf.push('gym');assert.throws(()=>validateRequirements(r));
  const duplicate=clone(manifest);duplicate.records.pop();assert.throws(()=>validateManifest(duplicate,equipment));
  assert.throws(()=>validateManifest(manifest,equipment.slice(1)));
  const facilities=clone(manifest.records[0].accessRequirements);facilities.facilities=['gym'];assert.throws(()=>validateRequirements(facilities));
  const alternatives=clone(manifest.records[0].accessRequirements);alternatives.equipment.anyOf=Array.from({length:9},()=>['bench','box']);assert.throws(()=>validateRequirements(alternatives));
});
test('narrow update masks and updateTime preconditions preserve metadata/media and touch no players',()=>{
  const {m,plan}=fixture();verifyPlan(plan,m,equipment);const writes=writesFor(plan);assert.equal(writes.length,55);
  assert.equal(plan.catalogVersionAfter,'1.0.92');
  for(const w of writes){assert.ok(w.currentDocument.updateTime);assert.ok(w.update.name.startsWith(ROOT+'drillCatalog'));assert.ok(!w.updateMask.fieldPaths.includes('media'));assert.ok(!w.updateMask.fieldPaths.includes('status'));}
  assert.equal(writes.filter(w=>w.updateMask.fieldPaths.includes('equipment')).length,2);
  assert.equal(verifyAfter(plan,applied(plan)).untouchedRecords,154);
});
test('tampered plan, changed source, inventory addition and concurrent snapshot changes abort',()=>{
  const {m,plan,before}=fixture();const changed=clone(plan);changed.patches[0].fields.status='draft';assert.throws(()=>verifyPlan(changed,m,equipment));
  const stale=clone(before);stale.catalog[0].updateTime='later';assert.throws(()=>assertSameSnapshot(before,stale));
  const altered=clone(before);altered.catalog.find(d=>d.name.endsWith('/BMA-501')).fields.name={stringValue:'Changed'};assert.throws(()=>buildPlan(m,equipment,altered));
  const extra=clone(before);extra.catalog.push(document('drillCatalog/NEW-001',{}));assert.throws(()=>buildPlan(m,equipment,extra));
});
test('media/review/config/untouched-source mutations are detected after publication',()=>{
  const {plan}=fixture();
  for(const mutate of [a=>a.catalog[0].fields.media={mapValue:{fields:{}}},a=>a.authors[0].fields.reviewStatus={stringValue:'approved'},a=>a.config.fields.personalWorkoutsEnabled={booleanValue:false},a=>a.catalog.find(d=>d.name.endsWith('/BMA-501')).fields.untouchedNested={nullValue:null}]){const after=applied(plan);mutate(after);assert.throws(()=>verifyAfter(plan,after));}
});
test('Firestore REST empty typed containers verify without weakening value types or private diagnostics',()=>{
  const {plan}=fixture();
  function omitEmpty(value){
    if(Array.isArray(value))return value.map(omitEmpty);
    if(!value || typeof value!=='object')return value;
    const out=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,omitEmpty(item)]));
    if(Array.isArray(out.arrayValue?.values) && out.arrayValue.values.length===0)delete out.arrayValue.values;
    if(out.mapValue?.fields && Object.keys(out.mapValue.fields).length===0)delete out.mapValue.fields;
    return out;
  }
  const actual=omitEmpty(applied(plan));
  assert.equal(verifyAfter(plan,actual).requirementMaps,54);
  for(const mutate of [
    a=>{a.catalog.find(d=>d.name.endsWith('/BMA-501')).fields.accessRequirements.mapValue.fields.unknowns={mapValue:{}};},
    a=>{a.catalog.find(d=>d.name.endsWith('/BMA-501')).fields.accessRequirements.mapValue.fields.participantMin={doubleValue:1};},
    a=>{a.catalog.find(d=>d.name.endsWith('/BMA-501')).fields.privateUnexpected={stringValue:'NEVER_DUMP_THIS_VALUE'};}
  ]){const altered=clone(actual);mutate(altered);assert.throws(()=>verifyAfter(plan,altered),error=>error.message==='Unexpected field change in drillCatalog/BMA-501'&&!error.message.includes('NEVER_DUMP_THIS_VALUE'));}
});
test('equipment correction refuses content-review or restricted-workflow bypass',()=>{
  const r=manifest.records.find(r=>r.drillId==='BMA-501');
  assert.throws(()=>ensureReviewBoundary(r,r.provenance.source,{reviewStatus:'approved',reviewedContentHash:'old'}));
  assert.throws(()=>ensureReviewBoundary(r,{...r.provenance.source,trainingPolicy:{reviewStatus:'pending'}},null));
  assert.doesNotThrow(()=>ensureReviewBoundary(r,r.provenance.source,null));
});
