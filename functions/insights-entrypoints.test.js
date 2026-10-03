const { test } = require('node:test');
const assert = require('node:assert/strict');
const { storageOwner, BUCKET, RECORD_COLLECTIONS } = require('./insights-entrypoints');
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
