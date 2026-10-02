const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encode } = require('./training-cloud.cjs');
const { planFor, verify } = require('./personal-assessment-policy.cjs');
const cfg = { globalEnabled: true, personalWorkoutsEnabled: true, wholeBodyTraining: { mobileVerified: false },
  capabilities: { generate_personal_workout: { enabled: true, dailyLimitPerUser: 15 }, generate_training_plan: { enabled: true, dailyLimitPerUser: 1 } } };
const doc = value => ({ updateTime: '2026-10-01T00:00:00Z', fields: encode(value).mapValue.fields });
test('assessment activation preserves existing allowances and content gate', () => {
  const plan = planFor(doc(cfg));
  assert.equal(plan.fieldPath, 'capabilities.assess_personal_workout');
  verify(plan, doc({ ...cfg, capabilities: { ...cfg.capabilities, assess_personal_workout: { enabled: true } } }));
});
test('verification rejects unrelated policy changes', () => {
  assert.throws(() => verify(planFor(doc(cfg)), doc({ ...cfg, capabilities: { assess_personal_workout: { enabled: true } } })));
});
test('preflight refuses disabled gates and unreviewed existing policy', () => {
  assert.throws(() => planFor(doc({ ...cfg, globalEnabled: false })));
  assert.throws(() => planFor(doc({ ...cfg, wholeBodyTraining: { mobileVerified: true } })));
  assert.throws(() => planFor(doc({ ...cfg, capabilities: { ...cfg.capabilities, assess_personal_workout: { enabled: false } } })));
});
