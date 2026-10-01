'use strict';
// Exact five-record migration. Read-only by default; publication requires the
// reviewed plan digest, unchanged source/review snapshots and update times.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { cloud, DOCUMENTS, decode, encode } = require('./training-cloud.cjs');
const { canonical, sha256, sourceHash, validateRequirements } = require('./training-access-lib.cjs');
const { snapshot, assertSameSnapshot, sameTypedValues } = require('./training-access-catalog.cjs');
const TARGETS = ['STR-005', 'STR-006', 'STR-008', 'STR-501', 'STR-502'];
const MANIFEST = 'content/training-access/floor-substitutions.json';
const DEFAULT_PLAN = '.netlify/training-floor/catalog-plan.json';
const unpack = d => decode({ mapValue: { fields: d.fields || {} } });
const fields = v => encode(v).mapValue.fields;
const idOf = d => d.name.split('/').at(-1);
const clone = v => structuredClone(v);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function patchedSource(raw, patch) {
  return { ...raw, ...patch, ...(patch.howTo ? { howTo: { ...raw.howTo, ...patch.howTo } } : {}) };
}
function floorSetup(before) {
  const setup = before.trim();
  return `${setup}${/[.!?]$/.test(setup) ? '' : '.'} Use a clear, non-slipping floor; a mat is optional for comfort.`;
}
function validateManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'floor-optional-mats');
  assert.deepEqual(manifest.records.map(r => r.drillId).sort(), [...TARGETS].sort());
  for (const r of manifest.records) {
    assert.equal(sourceHash(r.drillId, r.sourceBefore), r.sourceHashBefore);
    assert.equal(r.requirementsBefore.sourceHash, r.sourceHashBefore);
    validateRequirements(r.requirementsBefore);
    validateRequirements(r.requirementsAfter);
    assert.ok(Object.keys(r.sourcePatch).every(k => ['equipment', 'setup', 'howTo'].includes(k)));
    assert.deepEqual(r.sourcePatch.equipment, r.sourceBefore.equipment.filter(e => e !== 'mat'));
    assert.ok(r.sourceBefore.equipment.includes('mat'));
    for (const [before, after] of [[r.sourceBefore.setup, r.sourcePatch.setup], [r.sourceBefore.howTo?.setup, r.sourcePatch.howTo?.setup]]) {
      if (before == null) assert.equal(after, undefined);
      else assert.equal(after, floorSetup(before));
    }
    if (r.sourcePatch.howTo) assert.deepEqual(Object.keys(r.sourcePatch.howTo), ['setup']);
    const expectedRequirements = { ...clone(r.requirementsBefore),
      sourceHash: sourceHash(r.drillId, patchedSource(r.sourceBefore, r.sourcePatch)),
      equipment: { ...clone(r.requirementsBefore.equipment), allOf: r.requirementsBefore.equipment.allOf.filter(e => e !== 'mat') } };
    assert.equal(canonical(r.requirementsAfter), canonical(expectedRequirements), `${r.drillId}: unrelated access constraint changed`);
  }
  return { targets: TARGETS.length, matRequired: false, doseChanges: 0, mediaChanges: 0, reviewChanges: 0 };
}
function ensureReviewBoundary(raw, author, id) {
  assert.ok(!raw.trainingPolicy && raw.productionBatchId !== 'whole-body-2026-09', `${id}: restricted author/reviewer workflow required`);
  assert.equal(author, undefined, `${id}: an authoring record exists; use the established author/reviewer workflow`);
  for (const key of ['contentReview', 'contentReviewStatus', 'reviewedContentHash', 'reviewStatus', 'reviewedBy', 'reviewedAt', 'contentReviewedBy', 'contentReviewedAt']) {
    assert.ok(raw[key] == null, `${id}: content review state must not be carried across an authored setup edit`);
  }
  assert.ok(raw.status === 'published' || ((raw.schemaVersion ?? 1) === 1 && raw.status == null), `${id}: publication state changed`);
}
function buildPlan(manifest, before) {
  const validation = validateManifest(manifest);
  assert.equal(before.catalog.length, 208, 'Catalog inventory changed; re-audit before publication');
  assert.equal(new Set(before.catalog.map(d => d.name)).size, 208);
  assert.equal(unpack(before.config).wholeBodyTraining?.mobileVerified, false, 'Mobile acceptance hold must remain false');
  const held = before.catalog.map(unpack).filter(r => r.productionBatchId === 'whole-body-2026-09');
  assert.equal(held.length, 80);
  assert.ok(held.every(r => r.status === 'draft' && r.trainingPolicy?.reviewStatus === 'pending'));
  const oldVersion = unpack(before.meta).catalogVersion;
  assert.match(oldVersion, /^\d+\.\d+\.\d+$/);
  const parts = oldVersion.split('.').map(Number); parts[2]++;
  const catalogVersionAfter = parts.join('.');
  const catalog = new Map(before.catalog.map(d => [idOf(d), d]));
  const authors = new Map(before.authors.map(d => [idOf(d), unpack(d)]));
  const patches = manifest.records.map(r => {
    const doc = catalog.get(r.drillId); assert.ok(doc);
    const raw = unpack(doc); ensureReviewBoundary(raw, authors.get(r.drillId), r.drillId);
    assert.equal(sourceHash(r.drillId, raw), r.sourceHashBefore, `${r.drillId}: authored source changed`);
    assert.equal(canonical(raw.accessRequirements), canonical(r.requirementsBefore), `${r.drillId}: installed access map changed`);
    const values = { ...clone(r.sourcePatch), accessRequirements: clone(r.requirementsAfter), catalogVersion: catalogVersionAfter, updatedBy: 'operator:floor-optional-mats' };
    const fieldPaths = Object.keys(values).flatMap(k => k === 'howTo' ? ['howTo.setup'] : [k]);
    return { id: r.drillId, name: doc.name, expectedUpdateTime: doc.updateTime, fields: values, fieldPaths };
  });
  return { schemaVersion: 1, kind: 'floor-optional-mats', project: 'kickai-69dd0', createdAt: new Date().toISOString(),
    manifestSha256: sha256(manifest), validation, catalogVersionAfter, before, patches };
}
function verifyPlan(plan, manifest) {
  assert.equal(plan.schemaVersion, 1); assert.equal(plan.kind, 'floor-optional-mats'); assert.equal(plan.project, 'kickai-69dd0');
  assert.equal(plan.manifestSha256, sha256(manifest));
  const expected = buildPlan(manifest, plan.before);
  assert.equal(canonical(expected.patches), canonical(plan.patches), 'Plan differs from reviewed manifest');
  assert.equal(expected.catalogVersionAfter, plan.catalogVersionAfter);
}
const metaPatch = plan => ({ catalogVersion: plan.catalogVersionAfter, updatedBy: 'operator:floor-optional-mats',
  lastChange: { kind: 'floor-optional-mats', count: 5, manifestSha256: plan.manifestSha256 } });
function writesFor(plan) {
  const writes = plan.patches.map(p => ({ update: { name: p.name, fields: fields(p.fields) }, updateMask: { fieldPaths: p.fieldPaths },
    currentDocument: { updateTime: p.expectedUpdateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }));
  const meta = metaPatch(plan);
  writes.push({ update: { name: plan.before.meta.name, fields: fields(meta) }, updateMask: { fieldPaths: Object.keys(meta) },
    currentDocument: { updateTime: plan.before.meta.updateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] });
  return writes;
}
function patchedTypedFields(beforeFields, patch) {
  const expected = clone(beforeFields); const changes = fields(patch.fields);
  for (const key of patch.fieldPaths) {
    if (key === 'howTo.setup') {
      expected.howTo.mapValue.fields.setup = changes.howTo.mapValue.fields.setup;
    } else expected[key] = changes[key];
  }
  return expected;
}
function verifyAfter(plan, after) {
  assert.equal(after.catalog.length, 208); assert.equal(new Set(after.catalog.map(d => d.name)).size, 208);
  const current = new Map(after.catalog.map(d => [d.name, d]));
  const patches = new Map(plan.patches.map(p => [p.name, p]));
  for (const before of plan.before.catalog) {
    const actual = current.get(before.name); assert.ok(actual, `Missing ${idOf(before)}`);
    const patch = patches.get(before.name);
    if (!patch) { sameTypedValues(actual, before, `Untouched ${idOf(before)} changed`); continue; }
    const expected = patchedTypedFields(before.fields, patch); delete expected.updatedAt;
    const { updatedAt, ...actualFields } = actual.fields;
    assert.ok(updatedAt?.timestampValue, 'Expected server timestamp');
    sameTypedValues(actualFields, expected, `Unexpected field change in ${idOf(before)}`);
    assert.equal(actual.createTime, before.createTime);
  }
  sameTypedValues(after.authors, plan.before.authors, 'Authoring/review state changed');
  sameTypedValues(after.config, plan.before.config, 'AI configuration/mobile gate changed');
  const expectedMeta = { ...plan.before.meta.fields, ...fields(metaPatch(plan)) }; delete expectedMeta.updatedAt;
  const { updatedAt, ...actualMeta } = after.meta.fields; assert.ok(updatedAt?.timestampValue);
  sameTypedValues(actualMeta, expectedMeta, 'Unrelated catalog metadata changed');
  return { status: 'verified', catalogRecords: 208, changedDrills: TARGETS, untouchedRecords: 203, wholeBodyDraftsPreserved: 80,
    mobileVerified: false, doseMediaReviewAndOtherFieldsPreserved: true, catalogVersion: plan.catalogVersionAfter, planSha256: sha256(plan) };
}
async function applyPlan(c, plan, manifest, { onAttempt = () => {}, onCommitted = () => {} } = {}) {
  verifyPlan(plan, manifest);
  const { transaction } = await c.api(`${DOCUMENTS}:beginTransaction`, 'POST', { options: { readWrite: {} } });
  let committed = false;
  try {
    assertSameSnapshot(plan.before, await snapshot(c, transaction));
    const writes = writesFor(plan);
    onAttempt({ status: 'commit-attempted', planSha256: sha256(plan), writesSha256: sha256(writes), attemptedAt: new Date().toISOString() });
    const result = await c.api(`${DOCUMENTS}:commit`, 'POST', { transaction, writes }); committed = true;
    onCommitted({ status: 'commit-acknowledged', planSha256: sha256(plan), result });
    return { result, verification: verifyAfter(plan, await snapshot(c)) };
  } finally { if (!committed) await c.api(`${DOCUMENTS}:rollback`, 'POST', { transaction }).catch(() => {}); }
}
async function main() {
  const args = process.argv.slice(2); const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const manifest = readJson(MANIFEST); const validation = validateManifest(manifest);
  if (args.includes('--lint')) { console.log(JSON.stringify(validation)); return; }
  const output = option('--plan') || DEFAULT_PLAN;
  assert.ok(path.resolve(output).startsWith(path.resolve('.netlify') + path.sep), 'Private plans must stay in ignored .netlify/');
  const receipt = (suffix, value) => fs.writeFileSync(output.replace(/\.json$/, `${suffix}.json`), JSON.stringify(value, null, 2) + '\n');
  const c = await cloud();
  if (args.includes('--verify')) {
    const plan = readJson(output); verifyPlan(plan, manifest);
    const verification = { ...verifyAfter(plan, await snapshot(c)), verifiedAt: new Date().toISOString(), readOnlyVerification: true };
    receipt('.verified', verification);
    const committedPath = output.replace(/\.json$/, '.committed.json');
    if (fs.existsSync(committedPath)) {
      const committed = readJson(committedPath); assert.equal(committed.status, 'commit-acknowledged'); assert.equal(committed.planSha256, sha256(plan));
      receipt('.applied', { result: committed.result, verification });
    }
    console.log(JSON.stringify(verification)); return;
  }
  if (args.includes('--apply')) {
    const plan = readJson(output); assert.equal(option('--expected-plan-sha'), sha256(plan), 'Apply requires the exact reviewed plan digest');
    const result = await applyPlan(c, plan, manifest, { onAttempt: v => receipt('.attempt', v), onCommitted: v => receipt('.committed', v) });
    receipt('.applied', result); console.log(JSON.stringify(result.verification)); return;
  }
  const plan = buildPlan(manifest, await snapshot(c)); fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'reviewable-plan-no-production-write', planSha256: sha256(plan), changedDrills: TARGETS,
    catalogVersionBefore: unpack(plan.before.meta).catalogVersion, catalogVersionAfter: plan.catalogVersionAfter, untouchedRecords: 203, mobileVerified: false }));
}
module.exports = { TARGETS, validateManifest, ensureReviewBoundary, buildPlan, verifyPlan, writesFor, patchedTypedFields, verifyAfter, applyPlan, metaPatch };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
