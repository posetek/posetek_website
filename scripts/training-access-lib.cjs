'use strict';
// Source-derived access metadata only. This module performs no cloud calls.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const SOURCE_FIELDS = ['name','equipment','requiresPartner','playersMin','playersMax','setup','execution','safetyNote','howTo','coachComments','regression','progression','cues'];
const EQUIPMENT = ['ball','cones','markers','wall','goal','hurdles','box','sledOrBand','timer','bench','mat','kneePad','tapeMeasure','cueDevice','dumbbells','barbell','weightPlates','squatRack','trapBar','kettlebell','cableMachine','resistanceBand','medicineBall','pullUpBar','legCurlMachine','legPressMachine','jumpRope','sliders'];
const SURFACES = ['indoor','grass','turf','hardcourt','track','other'];
const FACILITIES = ['home','gym','outdoor','pitch','other'];
const UNKNOWN_CODES = ['run_off_distance_unspecified','triple_jump_lane_length_unspecified','stable_support_type_unspecified'];
const CORRECTIONS = {'BMA-501':['ball','cones'],'SHT-502':['ball','cones','goal']};
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));
  return value;
}
const canonical = value => JSON.stringify(sort(value));
const sha256 = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value),'utf8').digest('hex');
function sourcePayload(id, raw) {
  return {drillId:id,schemaVersion:raw.schemaVersion ?? 1,...Object.fromEntries(SOURCE_FIELDS.map(key=>[key,raw[key] ?? null]))};
}
const sourceHash = (id, raw) => sha256(sourcePayload(id,raw));
const unique = values => Array.isArray(values) && new Set(values).size === values.length;
function validateRequirements(r) {
  assert.ok(r && typeof r === 'object' && !Array.isArray(r));
  assert.ok(Object.keys(r).every(k=>['schemaVersion','sourceHash','equipment','space','participantMin','unknowns'].includes(k)));
  assert.equal(r.schemaVersion,1); assert.match(r.sourceHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(r.equipment).sort(),['allOf','anyOf']);
  assert.ok(unique(r.equipment.allOf) && r.equipment.allOf.every(e=>EQUIPMENT.includes(e)));
  assert.ok(Array.isArray(r.equipment.anyOf) && r.equipment.anyOf.length <= 8);
  for(const group of r.equipment.anyOf) assert.ok(unique(group) && group.length >= 1 && group.every(e=>EQUIPMENT.includes(e)));
  assert.ok(r.space && typeof r.space === 'object' && !Array.isArray(r.space));
  assert.ok(Object.keys(r.space).every(k=>['minLengthMeters','minWidthMeters','surfaces','overheadClear','requiresGoalArea'].includes(k)));
  for(const field of ['minLengthMeters','minWidthMeters']) if(field in r.space) assert.ok(Number.isFinite(r.space[field]) && r.space[field]>0 && r.space[field]<=1000);
  if('surfaces' in r.space) assert.ok(unique(r.space.surfaces) && r.space.surfaces.length>0 && r.space.surfaces.every(s=>SURFACES.includes(s)));
  for(const field of ['overheadClear','requiresGoalArea']) if(field in r.space) assert.equal(r.space[field],true);
  assert.ok(Number.isInteger(r.participantMin) && r.participantMin>=1 && r.participantMin<=12);
  assert.ok(unique(r.unknowns) && r.unknowns.every(c=>UNKNOWN_CODES.includes(c)));
}
function validateManifest(manifest, equipmentMap) {
  assert.equal(manifest.schemaVersion,1); assert.equal(manifest.status,'proposed-source-derived-requirements');
  assert.equal(manifest.inventory.length,208); assert.equal(manifest.records.length,54);
  assert.equal(new Set(manifest.inventory.map(r=>r.drillId)).size,208);
  assert.equal(new Set(manifest.records.map(r=>r.drillId)).size,54);
  assert.equal(manifest.inventory.filter(r=>r.classification==='whole-body-draft').length,80);
  assert.deepEqual(manifest.records.map(r=>r.drillId).sort(),manifest.inventory.filter(r=>r.classification==='normalized-published').map(r=>r.drillId).sort());
  assert.deepEqual(equipmentMap.map(e=>e.id).sort(),[...EQUIPMENT].sort());
  assert.ok(equipmentMap.every(e=>e.label && e.group && e.grantsOnly===e.id));
  const inventory = new Map(manifest.inventory.map(r=>[r.drillId,r]));
  for(const record of manifest.records) {
    validateRequirements(record.accessRequirements);
    assert.ok(record.provenance && Array.isArray(record.provenance.citations) && record.provenance.citations.length);
    assert.equal(sourceHash(record.drillId,record.provenance.source),record.sourceHashBefore);
    const after = {...record.provenance.source,...(record.equipmentCorrection ? {equipment:record.equipmentCorrection} : {})};
    assert.equal(sourceHash(record.drillId,after),record.accessRequirements.sourceHash);
    assert.equal(inventory.get(record.drillId).sourceHash,record.sourceHashBefore);
    if(record.equipmentCorrection) {
      assert.deepEqual(record.equipmentCorrection,CORRECTIONS[record.drillId]);
      assert.deepEqual(record.provenance.source.equipment,[]);
    }
    for(const citation of record.provenance.citations) {
      const value=citation.field.split('.').reduce((v,k)=>v?.[k],record.provenance.source);
      assert.ok(typeof citation.quote==='string' && citation.quote.length>0 && (typeof value==='string' ? value : canonical(value)).includes(citation.quote),`${record.drillId}: citation must quote its source field`);
      assert.ok(Array.isArray(citation.supports) && citation.supports.length);
    }
    for(const code of record.accessRequirements.unknowns) assert.ok(record.provenance.unresolved.some(u=>u.code===code && u.blocksAccessAwareSelection===true));
  }
  assert.deepEqual(manifest.records.filter(r=>r.equipmentCorrection).map(r=>r.drillId).sort(),Object.keys(CORRECTIONS).sort());
  return {inventory:208,requirements:54,wholeBodyUntouched:80,equipmentTokens:28,equipmentCorrections:2,heldForClarification:manifest.records.filter(r=>r.accessRequirements.unknowns.length).map(r=>r.drillId)};
}
function requirementsSatisfied(r, equipment, access) {
  validateRequirements(r);
  if(!access || access.schemaVersion!==1 || access.confirmed!==true || r.unknowns.length) return false;
  const kit=new Set(equipment), space=access.space||{};
  if(!r.equipment.allOf.every(e=>kit.has(e)) || !r.equipment.anyOf.every(group=>group.some(e=>kit.has(e)))) return false;
  if(!(access.participantCount>=r.participantMin)) return false;
  for(const [required,available] of [['minLengthMeters','lengthMeters'],['minWidthMeters','widthMeters']]) {
    if(required in r.space && (available in space ? !(space[available]>=r.space[required]) : space.assumedSufficient!==true)) return false;
  }
  if(r.space.surfaces && !r.space.surfaces.includes(space.surface)) return false;
  if(r.space.overheadClear && ('overheadClear' in space ? space.overheadClear!==true : space.assumedSufficient!==true)) return false;
  if(r.space.requiresGoalArea && space.goalArea!==true) return false;
  return true;
}
function validateCatalog(manifest, rows) {
  const byId=new Map(rows.map(r=>[r.id,r.data]));
  assert.equal(rows.length,208,'Inventory changed; re-audit before publication.');
  assert.equal(byId.size,208);
  assert.deepEqual([...byId.keys()].sort(),manifest.inventory.map(r=>r.drillId).sort());
  for(const item of manifest.inventory) {
    const raw=byId.get(item.drillId);
    assert.equal(sourceHash(item.drillId,raw),item.sourceHash,`${item.drillId}: authored source changed`);
    assert.equal(raw.status ?? null,item.rawStatus,`${item.drillId}: status changed`);
    if(item.classification==='whole-body-draft') {
      assert.equal(raw.status,'draft');assert.equal(raw.productionBatchId,'whole-body-2026-09');assert.equal(raw.trainingPolicy?.reviewStatus,'pending');
    }
  }
  for(const record of manifest.records) {
    const raw=byId.get(record.drillId);
    // Some grandfathered schema-1 records have no raw status; the canonical
    // normalizer supplies their audited publication state. Never add status.
    assert.ok(raw.status==='published' || ((raw.schemaVersion ?? 1)===1 && raw.status==null));
    assert.ok(!raw.trainingPolicy && raw.productionBatchId!=='whole-body-2026-09');
    assert.ok(!raw.accessRequirements,'An existing requirement map needs a separate reviewed migration.');
  }
}
function ensureReviewBoundary(record, raw, author) {
  assert.ok(!raw.trainingPolicy && raw.productionBatchId!=='whole-body-2026-09','Use the existing restricted-content author/reviewer workflow.');
  // Never carry a content approval across a corrected equipment list. The two
  // legacy corrections are allowed only where no content-review state exists.
  if(record.equipmentCorrection) {
    assert.ok(!author || (!author.reviewedContentHash && !author.reviewedBy && !author.reviewStatus),`${record.drillId}: equipment changes require the established review-invalidation workflow`);
    for(const key of ['contentReview','contentReviewStatus','reviewedContentHash','reviewStatus']) assert.ok(raw[key]==null,`${record.drillId}: review state must not be bypassed`);
  }
}
module.exports={SOURCE_FIELDS,EQUIPMENT,SURFACES,FACILITIES,UNKNOWN_CODES,CORRECTIONS,canonical,sha256,sourcePayload,sourceHash,validateRequirements,validateManifest,validateCatalog,requirementsSatisfied,ensureReviewBoundary};
