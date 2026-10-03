import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';
import { firestoreEmulator } from './canonicalRules.mjs';

setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-personal-workout-setup', firestore: firestoreEmulator() });
const databases = Object.fromEntries(['athlete', 'coach', 'stranger', 'admin'].map(uid => [uid, env.authenticatedContext(uid, {
  email: `${uid}@${uid === 'admin' ? 'posetek.net' : 'example.test'}`, email_verified: true,
}).firestore()]));
databases.anon = env.unauthenticatedContext().firestore();
const intake = { age: 14, equipment: [], setting: 'solo', painFlag: false, focusDomains: ['strength'],
  access: { schemaVersion: 1, confirmed: true, facility: 'home', participantCount: 1, space: { assumedSufficient: true } } };
const assessment = { requestId: 'assessment', scheduledDate: '2026-10-01', timezone: 'America/Los_Angeles', intake };
const generation = { ...assessment, expectedRevision: 0, expectedScheduleRevision: 0, requestText: 'A strength workout', timeAvailableMinutes: 20 };
let checks = 0;
let sequence = 0;
const allowed = async promise => { await assertSucceeds(promise); checks++; };
const denied = async promise => { await assertFails(promise); checks++; };
const seed = values => env.withSecurityRulesDisabled(async ctx => {
  for (const [path, value] of Object.entries(values)) await setDoc(doc(ctx.firestore(), path), value);
});
const submit = (actor, capability, params) => setDoc(doc(databases[actor], `llmJobs/setup-${++sequence}`), {
  schemaVersion: 1, status: 'pending', requestedByUid: actor, playerId: 'player', capability, params, createdAt: serverTimestamp(),
});
try {
  await seed({ 'players/player': { authenticationUID: 'athlete', userUID: 'athlete', coachUID: 'coach', age: 14 },
    'coaches/coach': { userUID: 'coach', members: ['player'] } });
  await allowed(submit('athlete', 'assess_personal_workout', assessment));
  await allowed(submit('athlete', 'assess_personal_workout', { ...assessment, timeAvailableMinutes: 20 }));
  for (const actor of ['coach', 'stranger', 'admin', 'anon']) await denied(submit(actor, 'assess_personal_workout', assessment));
  for (const focusDomains of [[], ['strength', 'strength'], ['speed', 'strength', 'agility'], ['unknown'], null, 'strength', [true]]) {
    for (const capability of ['assess_personal_workout', 'generate_personal_workout']) await denied(submit('athlete', capability,
      { ...(capability === 'assess_personal_workout' ? assessment : generation), intake: { ...intake, focusDomains } }));
  }
  for (const focusDomains of [['speed'], ['speed', 'agility'], ['ballMastery', 'receiving']]) {
    await allowed(submit('athlete', 'assess_personal_workout', { ...assessment, intake: { ...intake, focusDomains } }));
  }
  const { focusDomains, ...legacyIntake } = intake;
  await allowed(submit('athlete', 'generate_personal_workout', { ...generation, intake: legacyIntake }));
  await denied(submit('athlete', 'assess_personal_workout', { ...assessment, intake: legacyIntake }));
  for (const assumedSufficient of [false, 1, 'true', null, []]) await denied(submit('athlete', 'assess_personal_workout', {
    ...assessment, intake: { ...intake, access: { ...intake.access, space: { assumedSufficient } } },
  }));
  for (const space of [{}, { lengthMeters: 1, widthMeters: 1, overheadClear: false, assumedSufficient: true }, { goalArea: false, assumedSufficient: true }]) {
    await allowed(submit('athlete', 'assess_personal_workout', { ...assessment, intake: { ...intake, access: { ...intake.access, space } } }));
  }
  for (const space of [{ lengthMeters: 0, assumedSufficient: true }, { widthMeters: 1001 }, { overheadClear: 'false' }, { goalArea: 'true' }, { allEquipment: true }]) {
    await denied(submit('athlete', 'assess_personal_workout', { ...assessment, intake: { ...intake, access: { ...intake.access, space } } }));
  }
  for (const extra of [{ workoutId: 'forged' }, { conversationId: 'forged' }, { expectedRevision: 0 }, { requestText: 'forged' }, { role: 'admin' }]) {
    await denied(submit('athlete', 'assess_personal_workout', { ...assessment, ...extra }));
  }
  for (const timeAvailableMinutes of [0, 136, 2.5, '20', true]) await denied(submit('athlete', 'assess_personal_workout', { ...assessment, timeAvailableMinutes }));
  for (const equipment of [['gym'], ['mat', 'mat'], ['unknown'], [true]]) await denied(submit('athlete', 'assess_personal_workout', { ...assessment, intake: { ...intake, equipment } }));
  await denied(submit('athlete', 'assess_personal_workout', { ...assessment, intake: { ...intake, setting: 'partner' } }));
  const profile = doc(databases.athlete, 'players/player');
  await allowed(updateDoc(profile, { age: 14, ageRecordedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await allowed(updateDoc(profile, { age: 14, ageRecordedAt: serverTimestamp() }));
  for (const age of [4, 81, 14.5, '14']) await denied(updateDoc(profile, { age, ageRecordedAt: serverTimestamp() }));
  await denied(updateDoc(profile, { ageRecordedAt: new Date('2026-01-01') }));
  await denied(updateDoc(profile, { age: 15 }));
  await denied(updateDoc(doc(databases.stranger, 'players/player'), { age: 14, ageRecordedAt: serverTimestamp() }));
  await seed({ 'llmJobs/assessment-read': { requestedByUid: 'athlete', playerId: 'player', capability: 'assess_personal_workout', status: 'complete' } });
  await allowed(getDoc(doc(databases.athlete, 'llmJobs/assessment-read')));
  await seed({ 'players/player': { authenticationUID: 'replacement', userUID: 'replacement' } });
  await denied(getDoc(doc(databases.athlete, 'llmJobs/assessment-read')));
  await denied(submit('athlete', 'assess_personal_workout', assessment));
  assert.ok(checks >= 65);
  console.log(`${checks} personal workout setup rule assertions passed; legacy requests and ownership boundaries retained.`);
} finally { await env.cleanup(); }
