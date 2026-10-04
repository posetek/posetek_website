const { test } = require('node:test');
const assert = require('node:assert/strict');
const { storageOwner, BUCKET, RECORD_COLLECTIONS, failureProjectionInput } = require('./insights-entrypoints');
test('artifact events are confined to canonical per-rep metadata paths', () => {
  assert.equal(storageOwner({ bucket: BUCKET, name: 'synthetic/jump/session1/kick2/metadata.json' }), 'synthetic');
  assert.equal(storageOwner({ bucket: BUCKET, name: 'synthetic/sprint/session1/kick2/reprocess_context.json' }), 'synthetic');
  assert.equal(storageOwner({ bucket: BUCKET, name: 'synthetic/jump/session1/metadata.json' }), 'synthetic');
  assert.equal(storageOwner({ bucket: BUCKET, name: 'synthetic/jump/session1/reprocess_context.json' }), 'synthetic');
  assert.equal(storageOwner({ bucket: BUCKET, name: 'synthetic/jump/session1/kick2/capture_' + 'a'.repeat(32) + '/metadata.json' }), 'synthetic');
  assert.equal(storageOwner({ bucket: BUCKET, name: 'synthetic/jump/session1/kick2/capture_' + 'a'.repeat(32) + '/reprocess_context.json' }), 'synthetic');
  for (const name of ['synthetic/jump/session1/capture_' + 'a'.repeat(32) + '/metadata.json', 'synthetic/jump/session1/kick2/capture_short/metadata.json', 'synthetic/jump/session1/kick2/capture_' + 'a'.repeat(32) + '/admin_revisions/r/metadata.json']) assert.equal(storageOwner({ bucket: BUCKET, name }), null);
  for (const name of ['failure_cases/sprint/session1/kick1/metadata.json', 'private/backup/p/jump/session1/kick1/metadata.json', 'p/jump/session1/kick1/admin_revisions/x/metadata.json', 'p/jump/session1/kick1/video.mp4', '../p/jump/session1/kick1/metadata.json']) assert.equal(storageOwner({ bucket: BUCKET, name }), null);
  assert.equal(storageOwner({ bucket: 'other', name: 'p/jump/session1/kick1/metadata.json' }), null);
});
test('projection writes cannot recursively trigger another rebuild', () => {
  for (const collection of ['insightSummaries', 'insightSummaryDays', 'personalizedPlanDrafts', 'trainingPlans']) assert.equal(RECORD_COLLECTIONS.has(collection), false);
  for (const collection of ['reps', 'workoutLogs', 'personalWorkoutLogs', 'trainingSessions', 'insightMetadata']) assert.equal(RECORD_COLLECTIONS.has(collection), true);
});

test('both reporting callables use the verified caller wrapper and bounded service', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const calls = [], builders = [];
  const functions = { https: { HttpsError: Error }, runWith(options) {
    builders.push(options);
    return { https: { onCall: handler => handler },
      firestore: { document: () => ({ onWrite: handler => handler }) },
      storage: { bucket: () => ({ object: () => ({ onFinalize: handler => handler, onDelete: handler => handler }) }) } };
  } };
  const admin = { firestore: () => ({}), storage: () => ({ bucket: () => ({}) }) };
  const factory = { getClubInsightsV2: (...args) => calls.push(['report', ...args]), getCoachPlayerComparison: (...args) => calls.push(['comparison', ...args]) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./insights-entrypoints'), 'utf8'), { module, require: name =>
    name === './insights-v2' ? { createInsightsV2: () => factory }
      : name === './insight-usage' ? { createInsightUsage: () => ({}) } : require(name) });
  const marker = { uid: 'verified-wrapper' };
  const entrypoints = module.exports.createInsightsEntrypoints(functions, admin, context => { assert.equal(context.auth, true); return marker; });
  const data = { scope: { kind: 'coachRoster' }, playerId: 'a' };
  await entrypoints.getClubInsightsV2(data, { auth: true });
  await entrypoints.getCoachPlayerComparison(data, { auth: true });
  assert.deepEqual(calls, [['report', data, marker], ['comparison', data, marker]]);
  assert.equal(builders.filter(options => options.timeoutSeconds === 540 && options.memory === '1GB' && options.maxInstances === 10).length, 2);
});

function triggerFixture(factory = {}) {
  const fs = require('node:fs'), vm = require('node:vm');
  const calls = [], logs = [];
  const functions = { logger: { info: (...args) => logs.push(['info', ...args]), error: (...args) => logs.push(['error', ...args]) },
    https: { HttpsError: Error }, runWith: () => ({ https: { onCall: handler => handler },
      firestore: { document: () => ({ onWrite: handler => handler }) },
      storage: { bucket: () => ({ object: () => ({ onFinalize: handler => handler, onDelete: handler => handler }) }) } }) };
  const admin = { firestore: () => ({}), storage: () => ({ bucket: () => ({}) }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./insights-entrypoints'), 'utf8'), { module, require: name =>
    name === './insights-v2' ? { createInsightsV2: () => ({
      invalidateInsightPlayer: (...args) => calls.push(['invalidate', ...args]),
      rebuildInsightPlayer: (...args) => calls.push(['rebuild', ...args]), ...factory }) }
      : name === './insight-usage' ? { createInsightUsage: () => ({}) } : require(name) });
  const entrypoints = module.exports.createInsightsEntrypoints(functions, admin, () => ({}));
  return { calls, logs, ...entrypoints, rebuildInsightPlayer: entrypoints.rebuildInsightPlayer };
}
const snapshot = data => ({ exists: data !== undefined, data: () => data });
const change = (before, after) => ({ before: snapshot(before), after: snapshot(after) });
const context = (eventId = 'same-server-event') => ({ eventId, params: { playerId: 'p', failureId: 'failure-one', collectionId: 'reps' } });

test('failure retention acknowledgement, hold, uploader and diagnostic notes do not rebuild history', async () => {
  const service = triggerFixture();
  const original = { playerDocumentID: 'p', createdAt: 100, repId: 'r', storage: { repArtifactFolder: 'p/sprint/session1/kick1' } };
  const bookkeeping = { ...original, artifactsAcknowledgedAt: 200, investigationHold: true, retentionState: 'videoExpired',
    artifactReferences: ['review'], artifactUploadState: 'complete', uploadSessionIssuedAt: 200, note: 'changed',
    storage: { ...original.storage, prefix: 'failure_cases/failure-one', diagnosticAvailable: true } };
  assert.equal(await service.projectInsightFailures(change(original, bookkeeping), context()), null);
  assert.equal(service.calls.length, 0);
  assert.deepEqual(failureProjectionInput(original), failureProjectionInput(bookkeeping));
});

test('all qualification, chronology and failure-link changes rebuild the affected current and prior owners', async () => {
  const original = { playerDocumentID: 'p', createdAt: 100, repId: 'r', sessionDocId: 's', drillType: 'sprint', repNumber: 1, sessionNumber: 1,
    storage: { repArtifactFolder: 'p/sprint/session1/kick1' } };
  for (const delta of [{ createdAt: 101 }, { repId: 'other' }, { sessionDocId: 'other' }, { drillType: 'jump' }, { repNumber: 2 },
    { sessionNumber: 2 }, { storage: { repArtifactFolder: 'p/sprint/session1/kick2' } }, { resolvedAt: 101 }, { resolvedAtMillis: 101 }, { status: 'resolved' }]) {
    const service = triggerFixture();
    await service.projectInsightFailures(change(original, { ...original, ...delta }), context());
    assert.equal(service.calls.length, 2, JSON.stringify(delta));
    assert.deepEqual(JSON.parse(JSON.stringify(service.calls[0])), ['invalidate', 'p', { sourceKind: 'failure', eventId: 'same-server-event' }]);
  }
  const moved = triggerFixture();
  await moved.projectInsightFailures(change(original, { ...original, playerDocumentID: 'q' }), context());
  assert.deepEqual(moved.calls.map(call => call[1]), ['p', 'p', 'q', 'q']);
  for (const event of [change(undefined, original), change(original, undefined)]) {
    const service = triggerFixture(); await service.projectInsightFailures(event, context()); assert.equal(service.calls.length, 2);
  }
});

test('createdAtMillis fallback still affects failure qualification chronology', async () => {
  const service = triggerFixture();
  await service.projectInsightFailures(change({ playerDocumentID: 'p', createdAtMillis: 100 }, { playerDocumentID: 'p', createdAtMillis: 101 }), context());
  assert.equal(service.calls.length, 2);
});

test('existing profile metadata and membership changes do not invalidate independent history; existence still does', async () => {
  const service = triggerFixture();
  await service.projectInsightPlayer(change({ organizationId: 'old', name: 'Old', lastSeenAt: 100 }, { organizationId: 'new', name: 'New', lastSeenAt: 200 }), context());
  assert.equal(service.calls.length, 0);
  await service.projectInsightPlayer(change(undefined, { organizationId: 'new' }), context('create'));
  await service.projectInsightPlayer(change({ organizationId: 'new' }, undefined), context('delete'));
  assert.equal(service.calls.length, 4);
  assert.ok(service.calls.every(call => call[2].sourceKind === 'player'));
});

test('retryable controls log only safe correlation facts and never return healthy success', async () => {
  const failure = Object.assign(Error('private error body'), { code: 'aborted', details: { reason: 'insights-rebuild-busy', rebuildId: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) } });
  const service = triggerFixture({ rebuildInsightPlayer: () => { throw failure; } });
  await assert.rejects(service.projectInsightFailures(change(undefined, { playerDocumentID: 'p' }), context('private-source-id')), error => error === failure);
  assert.equal(service.logs.length, 1); assert.equal(service.logs[0][0], 'info');
  const facts = service.logs[0][2]; assert.equal(facts.event, 'posetek_insight_projection_control');
  assert.equal(facts.sourceKind, 'failure'); assert.match(facts.sourceEventHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(service.logs).includes('private-source-id'));
  assert.ok(!JSON.stringify(service.logs).includes('private error body'));
  assert.ok(!Object.hasOwn(facts, 'playerId'));
});

test('genuine evidence or query errors remain failures with safe source correlation', async () => {
  const failure = Object.assign(Error('private storage URL'), { code: 503 });
  const service = triggerFixture({ rebuildInsightPlayer: () => { throw failure; } });
  await assert.rejects(service.projectInsightRecords(change({}, {}), context()), error => error === failure);
  assert.equal(service.logs[0][0], 'error');
  assert.equal(service.logs[0][2].event, 'posetek_insight_projection_failure');
  assert.equal(service.logs[0][2].reason, 'insights-rebuild-failed');
  assert.ok(!JSON.stringify(service.logs).includes(failure.message));
});

test('testing finalizer bridge forwards only its server-owned source event and revision identity', async () => {
  const service = triggerFixture();
  const source = { sourceKind: 'testing_event', eventId: 'testing-event/server-event/7' };
  await service.rebuildInsightPlayer('p', source);
  assert.deepEqual(JSON.parse(JSON.stringify(service.calls)), [['invalidate','p',source],['rebuild','p',source]]);
});
