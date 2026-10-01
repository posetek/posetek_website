'use strict';
// Guarded, additive policy activation. No model, quota, native or content gate changes.
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { cloud, DOCUMENTS, decode, encode } = require('./training-cloud.cjs');
const file = '.netlify/reliable-workout-release/assessment-policy-plan.json';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unpack = doc => decode({ mapValue: { fields: doc.fields || {} } });
function planFor(before) {
  const config = unpack(before);
  assert.equal(config.globalEnabled, true, 'Global gate must already be enabled');
  assert.equal(config.personalWorkoutsEnabled, true, 'Personal gate must already be enabled');
  assert.equal(config.wholeBodyTraining?.mobileVerified, false, 'Content acceptance hold changed');
  const previous = config.capabilities?.assess_personal_workout;
  assert.ok(previous === undefined || JSON.stringify(previous) === JSON.stringify({ enabled: true }), 'Review existing assessment policy before replacement');
  assert.ok(before.updateTime);
  return { schemaVersion: 1, kind: 'personal-workout-assessment-policy', before,
    fieldPath: 'capabilities.assess_personal_workout', value: { enabled: true } };
}
function verify(plan, current) {
  const before = unpack(plan.before), after = unpack(current);
  assert.deepEqual(after.capabilities.assess_personal_workout, { enabled: true });
  const expected = { ...before, capabilities: { ...before.capabilities, assess_personal_workout: { enabled: true } } };
  assert.deepEqual(after, expected, 'Configuration changed outside the assessment entry');
}
async function main() {
  const args = process.argv.slice(2), c = await cloud();
  if (!args.length) {
    const plan = planFor(await c.api(DOCUMENTS + '/config/llm'));
    await fs.mkdir('.netlify/reliable-workout-release', { recursive: true });
    await fs.writeFile(file, JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ status: 'reviewable-no-write', planSha256: digest(plan), fieldPath: plan.fieldPath, value: plan.value }));
    return;
  }
  const plan = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(plan, planFor(plan.before));
  if (args[0] === '--apply') {
    assert.deepEqual(args.slice(1, 2), ['--expected-plan-sha']);
    assert.equal(args.length, 3); assert.equal(args[2], digest(plan));
    const current = await c.api(DOCUMENTS + '/config/llm');
    assert.deepEqual(current, plan.before, 'Configuration drift; review a fresh plan');
    if (unpack(current).capabilities?.assess_personal_workout?.enabled !== true) {
      await c.api(DOCUMENTS + '/config/llm?updateMask.fieldPaths=' + plan.fieldPath + '&currentDocument.updateTime=' + encodeURIComponent(current.updateTime), 'PATCH',
        { fields: encode({ capabilities: { assess_personal_workout: plan.value } }).mapValue.fields });
    }
  } else assert.deepEqual(args, ['--verify']);
  verify(plan, await c.api(DOCUMENTS + '/config/llm'));
  const receipt = { status: 'verified', verifiedAt: new Date().toISOString(), planSha256: digest(plan), changedFields: [plan.fieldPath],
    otherConfigurationPreserved: true, noAllowanceOverride: true, mobileVerified: false };
  await fs.writeFile('.netlify/reliable-workout-release/assessment-policy-verified.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}
module.exports = { planFor, verify, digest };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
