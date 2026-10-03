'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { encode } = require('./training-cloud.cjs');
const { canonical, sourceHash, requirementsSatisfied } = require('./training-access-lib.cjs');
const { TARGETS, validateManifest, buildPlan, verifyPlan, writesFor, patchedTypedFields, verifyAfter, applyPlan, metaPatch } = require('./training-floor-catalog.cjs');
const manifest = JSON.parse(fs.readFileSync('content/training-access/floor-substitutions.json', 'utf8'));
const initial = JSON.parse(fs.readFileSync('content/training-access/requirements.json', 'utf8'));
const ROOT = 'projects/kickai-69dd0/databases/(default)/documents/';
const clone = v => structuredClone(v);
const typed = v => encode(v).mapValue.fields;
const document = (name, data) => ({ name: ROOT + name, fields: typed(data), createTime: '2026-09-01T00:00:00Z', updateTime: '2026-10-01T01:00:00.000001Z' });
function fixture() {
  const records = new Map(manifest.records.map(r => [r.drillId, r]));
  const before = { catalog: initial.inventory.map(i => {
    const r = records.get(i.drillId);
    const data = r ? { ...r.sourceBefore, accessRequirements: r.requirementsBefore, ...(i.rawStatus == null ? {} : { status: i.rawStatus }) } :
      { drillId: i.drillId, name: i.name, equipment: [], status: i.rawStatus };
    if (i.classification === 'whole-body-draft') Object.assign(data, { productionBatchId: 'whole-body-2026-09', trainingPolicy: { reviewStatus: 'pending' } });
    const d = document(`drillCatalog/${i.drillId}`, { ...data, dose: { setsMin: 3, repsMin: 5 }, media: { primaryDemo: { generation: 'keep', status: 'approved' } } });
    d.fields.originalTimestamp = { timestampValue: '2026-09-01T01:00:00Z' };
    return d;
  }).sort((a, b) => a.name.localeCompare(b.name)),
  authors: [document('drillCatalogAuthoring/AGL-501', { reviewStatus: 'pending' })],
  config: document('config/llm', { wholeBodyTraining: { mobileVerified: false }, unrelated: true }),
  meta: document('drillCatalogMeta/current', { catalogVersion: '1.0.92', unrelated: true }) };
  const m = clone(manifest);
  return { m, before, plan: buildPlan(m, before) };
}
function applied(plan) {
  const after = clone(plan.before);
  for (const p of plan.patches) {
    const d = after.catalog.find(d => d.name === p.name);
    d.fields = { ...patchedTypedFields(d.fields, p), updatedAt: { timestampValue: '2026-10-01T02:00:00Z' } };
    d.updateTime = '2026-10-01T02:00:00Z';
  }
  Object.assign(after.meta.fields, typed(metaPatch(plan)), { updatedAt: { timestampValue: '2026-10-01T02:00:00Z' } });
  return after;
}
test('five authored optional mat substitutions keep bench, participants and crawl distance', () => {
  assert.deepEqual(validateManifest(manifest), { targets: 5, matRequired: false, doseChanges: 0, mediaChanges: 0, reviewChanges: 0 });
  const home = { schemaVersion: 1, confirmed: true, participantCount: 1, space: {} };
  for (const r of manifest.records) {
    assert.ok(!r.sourcePatch.equipment.includes('mat'));
    assert.equal(r.requirementsAfter.sourceHash, sourceHash(r.drillId, { ...r.sourceBefore, ...r.sourcePatch,
      ...(r.sourcePatch.howTo ? { howTo: { ...r.sourceBefore.howTo, ...r.sourcePatch.howTo } } : {}) }));
    if (!['STR-008', 'STR-501'].includes(r.drillId)) assert.equal(requirementsSatisfied(r.requirementsAfter, [], home), true);
  }
  const copenhagen = manifest.records.find(r => r.drillId === 'STR-008').requirementsAfter;
  assert.deepEqual(copenhagen.equipment.allOf, ['bench']); assert.equal(copenhagen.participantMin, 2);
  assert.equal(requirementsSatisfied(copenhagen, ['bench'], home), false);
  assert.equal(requirementsSatisfied(copenhagen, ['bench'], { ...home, participantCount: 2 }), true);
  const crawl = manifest.records.find(r => r.drillId === 'STR-501').requirementsAfter;
  assert.equal(crawl.space.minLengthMeters, 1.524);
  assert.equal(requirementsSatisfied(crawl, [], home), false);
  assert.equal(requirementsSatisfied(crawl, [], { ...home, space: { lengthMeters: 1.524 } }), true);
});
test('manifest cannot grant an extra substitute, change dose, skip authored instructions or alter access constraints', () => {
  for (const change of [m => m.records[0].sourcePatch.equipment.push('kneePad'), m => m.records[0].sourcePatch.dose = {},
    m => m.records[0].requirementsAfter.participantMin = 2, m => m.records[0].sourcePatch.setup = 'Floor',
    m => m.records[0].sourcePatch.howTo.steps = ['Changed']]) {
    const m = clone(manifest); change(m); assert.throws(() => validateManifest(m));
  }
});

test('appended floor setup preserves the original sentence and requires a punctuation boundary', () => {
  const shoulder = manifest.records.find(r => r.drillId === 'STR-502');
  assert.equal(shoulder.sourcePatch.howTo.setup, `${shoulder.sourceBefore.howTo.setup.trim()}. Use a clear, non-slipping floor; a mat is optional for comfort.`);
  const sidePlank = manifest.records.find(r => r.drillId === 'STR-005');
  assert.ok(sidePlank.sourcePatch.setup.startsWith('Clear floor. Use a clear'));
  const missingBoundary = clone(manifest);
  missingBoundary.records.find(r => r.drillId === 'STR-502').sourcePatch.howTo.setup = shoulder.sourcePatch.howTo.setup.replace('usual. Use', 'usual Use');
  assert.throws(() => validateManifest(missingBoundary));
});
test('publisher uses six guarded narrow writes and preserves existing howTo steps/value types', () => {
  const { m, plan } = fixture(); verifyPlan(plan, m); const writes = writesFor(plan);
  assert.equal(writes.length, 6); assert.equal(plan.catalogVersionAfter, '1.0.93');
  for (const w of writes) {
    assert.ok(w.currentDocument.updateTime); assert.equal(w.updateTransforms[0].fieldPath, 'updatedAt');
    assert.ok(w.updateMask.fieldPaths.every(k => ['equipment', 'setup', 'howTo.setup', 'accessRequirements', 'catalogVersion', 'updatedBy', 'lastChange'].includes(k)));
    assert.ok(!w.updateMask.fieldPaths.includes('howTo')); assert.ok(!w.updateMask.fieldPaths.includes('status'));
  }
  assert.equal(verifyAfter(plan, applied(plan)).untouchedRecords, 203);
  for (const p of plan.patches.filter(p => p.fieldPaths.includes('howTo.setup'))) {
    const before = plan.before.catalog.find(d => d.name === p.name), after = applied(plan).catalog.find(d => d.name === p.name);
    assert.equal(canonical(after.fields.howTo.mapValue.fields.steps), canonical(before.fields.howTo.mapValue.fields.steps));
    assert.deepEqual(after.fields.originalTimestamp, before.fields.originalTimestamp);
  }
});
test('authored source, access map, publication, authoring/review and whole-body gate drift fail closed', () => {
  const { m, before } = fixture();
  for (const change of [b => b.catalog.find(d => d.name.endsWith('/STR-005')).fields.setup = { stringValue: 'Changed' },
    b => b.catalog.find(d => d.name.endsWith('/STR-005')).fields.accessRequirements.mapValue.fields.sourceHash = { stringValue: 'a'.repeat(64) },
    b => b.catalog.find(d => d.name.endsWith('/STR-005')).fields.status = { stringValue: 'draft' },
    b => b.authors.push(document('drillCatalogAuthoring/STR-005', { reviewStatus: 'approved' })),
    b => b.catalog.find(d => d.name.endsWith('/STR-005')).fields.reviewedBy = { stringValue: 'reviewer' },
    b => b.config.fields.wholeBodyTraining.mapValue.fields.mobileVerified = { booleanValue: true },
    b => b.catalog.find(d => d.name.endsWith('/AGL-501')).fields.status = { stringValue: 'published' }]) {
    const b = clone(before); change(b); assert.throws(() => buildPlan(m, b));
  }
});
test('tampered proposal cannot widen fields or alter update preconditions', () => {
  const { m, plan } = fixture();
  for (const change of [p => p.patches[0].fields.status = 'published', p => p.patches[0].fieldPaths.push('media'),
    p => p.patches[0].expectedUpdateTime = 'new', p => p.catalogVersionAfter = '9.0.0']) {
    const p = clone(plan); change(p); assert.throws(() => verifyPlan(p, m));
  }
});
test('independent readback rejects dose/media/review/config and untouched document mutations', () => {
  const { plan } = fixture();
  for (const change of [a => a.catalog.find(d => d.name.endsWith('/STR-005')).fields.dose.mapValue.fields.setsMin = { integerValue: '4' },
    a => a.catalog.find(d => d.name.endsWith('/STR-005')).fields.media.mapValue.fields.primaryDemo.mapValue.fields.generation = { stringValue: 'new' },
    a => a.authors[0].fields.reviewStatus = { stringValue: 'approved' }, a => a.config.fields.unrelated = { booleanValue: false },
    a => a.catalog.find(d => d.name.endsWith('/AGL-501')).fields.name = { stringValue: 'Changed' }]) {
    const after = applied(plan); change(after); assert.throws(() => verifyAfter(plan, after));
  }
});
test('concurrent review state change aborts transaction before any commit attempt', async () => {
  const { m, plan } = fixture(); const fresh = clone(plan.before);
  fresh.authors.push(document('drillCatalogAuthoring/STR-005', { reviewStatus: 'approved' }));
  const calls = [];
  const c = { api: async (url, method) => {
    calls.push(url);
    if (url.endsWith(':beginTransaction')) return { transaction: 'transaction' };
    if (url.endsWith(':rollback')) return {};
    if (url.includes(':runQuery')) {
      // snapshot issues catalog and authoring queries in invocation order.
      const queryCount = calls.filter(v => v.includes(':runQuery')).length;
      return (queryCount === 1 ? fresh.catalog : fresh.authors).map(document => ({ document }));
    }
    if (url.includes('/drillCatalogMeta/current')) return fresh.meta;
    if (url.includes('/config/llm')) return fresh.config;
    throw new Error(`Unexpected call: ${method}`);
  } };
  await assert.rejects(applyPlan(c, plan, m));
  assert.ok(calls.at(-1).endsWith(':rollback')); assert.ok(!calls.some(v => v.endsWith(':commit')));
});
