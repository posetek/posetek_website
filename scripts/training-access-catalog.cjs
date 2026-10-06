'use strict';
// Run without --apply: read-only plan/verification. Apply requires the exact
// reviewed plan digest. This script never edits athletes, media or review state.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {cloud,DOCUMENTS,decode,encode}=require('./training-cloud.cjs');
const {canonical,sha256,validateManifest,validateCatalog,ensureReviewBoundary}=require('./training-access-lib.cjs');
const ROOT='projects/kickai-69dd0/databases/(default)/documents/';
const MANIFEST='content/training-access/requirements.json';
const EQUIPMENT_MAP='content/training-access/equipment.json';
const DEFAULT_PLAN='.netlify/training-access/catalog-plan.json';
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const unpack=d=>decode({mapValue:{fields:d.fields||{}}});
const fields=value=>encode(value).mapValue.fields;
function manifestFiles(){return {manifest:readJson(MANIFEST),equipment:readJson(EQUIPMENT_MAP)};}
function versionAfter(value){assert.match(value,/^\d+\.\d+\.\d+$/);const n=value.split('.').map(Number);n[2]++;return n.join('.');}
function nameOf(doc){assert.ok(doc.name.startsWith(ROOT));return doc.name.slice(ROOT.length);}
function summary(plan){return {status:'reviewable-plan-no-production-write',planSha256:sha256(plan),inventory:plan.before.catalog.length,requirementMaps:plan.patches.length,equipmentCorrections:plan.patches.filter(p=>p.fields.equipment).map(p=>p.id),catalogVersionBefore:unpack(plan.before.meta).catalogVersion,catalogVersionAfter:plan.catalogVersionAfter,wholeBodyDraftsUntouched:80,sourceManifestSha256:plan.manifestSha256};}
async function snapshot(c, transaction){
  const query=async collection=>(await c.api(`${DOCUMENTS}:runQuery`,'POST',{...(transaction?{transaction}:{}),structuredQuery:{from:[{collectionId:collection}]}})).filter(r=>r.document).map(r=>r.document).sort((a,b)=>a.name.localeCompare(b.name));
  const get=doc=>c.api(`${DOCUMENTS}/${doc}${transaction?'?transaction='+encodeURIComponent(transaction):''}`);
  const [catalog,authors,meta,config]=await Promise.all([query('drillCatalog'),query('drillCatalogAuthoring'),get('drillCatalogMeta/current'),get('config/llm')]);
  for(const doc of [...catalog,...authors,meta,config]){assert.ok(doc.updateTime);nameOf(doc);}
  assert.equal(nameOf(meta),'drillCatalogMeta/current');assert.equal(nameOf(config),'config/llm');
  return {catalog,authors,meta,config};
}
function buildPlan(manifest,equipment,before){
  const validation=validateManifest(manifest,equipment);
  validateCatalog(manifest,before.catalog.map(d=>({id:nameOf(d).split('/')[1],data:unpack(d)})));
  assert.equal(unpack(before.config).wholeBodyTraining?.mobileVerified,false,'The separate mobile acceptance hold must remain false.');
  const catalog=new Map(before.catalog.map(d=>[nameOf(d).split('/')[1],d]));
  const authors=new Map(before.authors.map(d=>[nameOf(d).split('/')[1],unpack(d)]));
  const nextVersion=versionAfter(unpack(before.meta).catalogVersion);
  const patches=manifest.records.map(record=>{
    const doc=catalog.get(record.drillId),raw=unpack(doc);
    ensureReviewBoundary(record,raw,authors.get(record.drillId));
    return {id:record.drillId,name:doc.name,expectedUpdateTime:doc.updateTime,
      fields:{accessRequirements:record.accessRequirements,...(record.equipmentCorrection?{equipment:record.equipmentCorrection}:{}),catalogVersion:nextVersion,updatedBy:'operator:training-access-requirements'}};
  });
  return {schemaVersion:1,kind:'training-access-requirements',project:'kickai-69dd0',createdAt:new Date().toISOString(),manifestSha256:sha256(manifest),equipmentMapSha256:sha256(equipment),validation,catalogVersionAfter:nextVersion,before,patches};
}
function verifyPlan(plan,manifest,equipment){
  assert.equal(plan.schemaVersion,1);assert.equal(plan.kind,'training-access-requirements');assert.equal(plan.project,'kickai-69dd0');
  assert.equal(plan.manifestSha256,sha256(manifest));assert.equal(plan.equipmentMapSha256,sha256(equipment));
  const expected=buildPlan(manifest,equipment,plan.before);
  assert.equal(canonical(expected.patches),canonical(plan.patches),'Plan writes differ from reviewed source-derived patch.');
  assert.equal(expected.catalogVersionAfter,plan.catalogVersionAfter);
}
function assertSameSnapshot(expected,current){
  // Includes all 208 catalog records, all private catalog authoring/reviews,
  // complete AI configuration, and catalog version. A teammate change aborts.
  assert.equal(canonical(current),canonical(expected),'Live catalog, authoring, version or configuration changed; make a new plan.');
}
function writesFor(plan){
  const writes=plan.patches.map(p=>({update:{name:p.name,fields:fields(p.fields)},updateMask:{fieldPaths:Object.keys(p.fields)},currentDocument:{updateTime:p.expectedUpdateTime},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}));
  const meta={catalogVersion:plan.catalogVersionAfter,updatedBy:'operator:training-access-requirements',lastChange:{kind:'training-access-requirements',count:54,manifestSha256:plan.manifestSha256}};
  writes.push({update:{name:plan.before.meta.name,fields:fields(meta)},updateMask:{fieldPaths:Object.keys(meta)},currentDocument:{updateTime:plan.before.meta.updateTime},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]});
  return writes;
}
function normalizeEmptyProtoContainers(value){
  if(Array.isArray(value))return value.map(normalizeEmptyProtoContainers);
  if(!value || typeof value!=='object')return value;
  const out=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalizeEmptyProtoContainers(item)]));
  // Firestore REST omits the empty repeated/map member of its typed wrappers.
  // Preserve every scalar type, timestamp, nonempty value and unrelated key.
  for(const [wrapper,member,empty] of [['arrayValue','values',[]],['mapValue','fields',{}]]){
    if(out[wrapper] && typeof out[wrapper]==='object' && !Array.isArray(out[wrapper]) && Object.keys(out[wrapper]).length===0)out[wrapper]={[member]:empty};
  }
  return out;
}
function sameTypedValues(actual,expected,message){
  assert.ok(canonical(normalizeEmptyProtoContainers(actual))===canonical(normalizeEmptyProtoContainers(expected)),message);
}
function verifyAfter(plan,after){
  const byPath=new Map(after.catalog.map(d=>[d.name,d]));
  assert.equal(after.catalog.length,208);assert.equal(byPath.size,208);
  const patches=new Map(plan.patches.map(p=>[p.name,p]));
  for(const before of plan.before.catalog){
    const actual=byPath.get(before.name);assert.ok(actual,`Missing ${nameOf(before)}`);
    const patch=patches.get(before.name);
    if(!patch){sameTypedValues(actual,before,`Untouched ${nameOf(before)} changed`);continue;}
    // Compare Firestore values directly, preserving timestamp/reference/value
    // types rather than flattening and accidentally rewriting existing fields.
    const expectedFields={...before.fields,...fields(patch.fields)};
    delete expectedFields.updatedAt;
    const {updatedAt,...actualFields}=actual.fields;
    assert.ok(updatedAt?.timestampValue,'Expected server update timestamp');
    sameTypedValues(actualFields,expectedFields,`Unexpected field change in ${nameOf(before)}`);
    assert.ok(actual.createTime===before.createTime,`Create time changed in ${nameOf(before)}`);
  }
  sameTypedValues(after.authors,plan.before.authors,'Catalog authoring or reviews changed');
  sameTypedValues(after.config,plan.before.config,'Configuration changed');
  const expectedMeta={...plan.before.meta.fields,...fields({catalogVersion:plan.catalogVersionAfter,updatedBy:'operator:training-access-requirements',lastChange:{kind:'training-access-requirements',count:54,manifestSha256:plan.manifestSha256}})};
  delete expectedMeta.updatedAt;
  const {updatedAt,...actualMeta}=after.meta.fields;
  assert.ok(updatedAt?.timestampValue);sameTypedValues(actualMeta,expectedMeta,'Catalog metadata changed outside the reviewed patch');
  return {status:'verified',catalogRecords:208,requirementMaps:54,equipmentCorrections:2,untouchedRecords:154,wholeBodyDraftsPreserved:80,mediaAndOtherCatalogFieldsPreserved:true,authoringAndReviewsPreserved:true,aiConfigurationPreserved:true,mobileVerified:false,catalogVersion:plan.catalogVersionAfter,planSha256:sha256(plan)};
}
async function applyPlan(c,plan,manifest,equipment,{onAttempt=()=>{},onCommitted=()=>{}}={}){
  verifyPlan(plan,manifest,equipment);
  const {transaction}=await c.api(`${DOCUMENTS}:beginTransaction`,'POST',{options:{readWrite:{}}});
  let committed=false;
  try{
    const fresh=await snapshot(c,transaction);assertSameSnapshot(plan.before,fresh);
    const writes=writesFor(plan);
    onAttempt({status:'commit-attempted',planSha256:sha256(plan),writesSha256:sha256(writes),attemptedAt:new Date().toISOString()});
    const result=await c.api(`${DOCUMENTS}:commit`,'POST',{transaction,writes});committed=true;
    onCommitted({status:'commit-acknowledged',planSha256:sha256(plan),result});
    return {result,verification:verifyAfter(plan,await snapshot(c))};
  }finally{if(!committed) await c.api(`${DOCUMENTS}:rollback`,'POST',{transaction}).catch(()=>{});}
}
async function main(){
  const args=process.argv.slice(2);const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
  const {manifest,equipment}=manifestFiles();validateManifest(manifest,equipment);
  if(args.includes('--lint')){console.log(JSON.stringify(validateManifest(manifest,equipment)));return;}
  const output=option('--plan')||DEFAULT_PLAN;
  assert.ok(path.resolve(output).startsWith(path.resolve('.netlify')+path.sep),'Plans must stay in ignored .netlify/.');
  const c=await cloud();
  if(args.includes('--verify')){
    const plan=readJson(output);verifyPlan(plan,manifest,equipment);
    const verification={...verifyAfter(plan,await snapshot(c)),verifiedAt:new Date().toISOString(),readOnlyVerification:true};
    fs.writeFileSync(output.replace(/\.json$/,'.verified.json'),JSON.stringify(verification,null,2)+'\n');
    const committedPath=output.replace(/\.json$/,'.committed.json');
    if(fs.existsSync(committedPath)){
      const committed=readJson(committedPath);
      assert.equal(committed.status,'commit-acknowledged');assert.equal(committed.planSha256,sha256(plan));
      fs.writeFileSync(output.replace(/\.json$/,'.applied.json'),JSON.stringify({result:committed.result,verification},null,2)+'\n');
    }
    console.log(JSON.stringify(verification));return;
  }
  if(args.includes('--apply')){
    const plan=readJson(output);assert.equal(option('--expected-plan-sha'),sha256(plan),'Apply requires the exact independently reviewed plan digest.');
    const receipt=(suffix,value)=>fs.writeFileSync(output.replace(/\.json$/,suffix+'.json'),JSON.stringify(value,null,2)+'\n');
    const result=await applyPlan(c,plan,manifest,equipment,{onAttempt:v=>receipt('.attempt',v),onCommitted:v=>receipt('.committed',v)});
    fs.writeFileSync(output.replace(/\.json$/,'.applied.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.verification));return;
  }
  const plan=buildPlan(manifest,equipment,await snapshot(c));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify(summary(plan)));
}
module.exports={buildPlan,verifyPlan,assertSameSnapshot,writesFor,verifyAfter,applyPlan,snapshot,summary,normalizeEmptyProtoContainers,sameTypedValues};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
