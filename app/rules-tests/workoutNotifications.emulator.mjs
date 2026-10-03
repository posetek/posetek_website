import { firestoreEmulator } from './canonicalRules.mjs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-workout-notifications', firestore: firestoreEmulator() });
const paths = [
  'workoutNotificationSettings/current',
  'workoutNotificationActivity/execution',
  'workoutNotificationActivity/execution/sessions/session',
  'workoutNotificationOutbox/notification',
  'workoutNotificationOutbox/notification/webhookEvents/event',
];
let checks = 0;
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'players/player'), { authenticationUID: 'athlete', userUID: 'athlete', organizationId: 'club', teamId: 'team' });
    await setDoc(doc(db, 'coaches/coach'), { userUID: 'coach', members: ['player'] });
    for (const [uid, role, teamIds] of [['coach', 'coach', ['team']], ['manager', 'manager', []]]) {
      await setDoc(doc(db, `organizations/club/members/${uid}`), { userUID: uid, role, teamIds, status: 'active' });
    }
    for (const path of paths) await setDoc(doc(db, path), { serverOnly: true });
  });
  const actors = [env.unauthenticatedContext(), ...['athlete', 'coach', 'manager', 'outsider', 'admin'].map(uid =>
    env.authenticatedContext(uid, { email: `${uid}@${uid === 'admin' ? 'posetek.net' : 'example.test'}`, email_verified: true }))];
  for (const actor of actors) for (const path of paths) {
    const db = actor.firestore(), ref = doc(db, path);
    await assertFails(getDoc(ref)); checks++;
    await assertFails(setDoc(doc(db, `${path}-forged`), { forged: true })); checks++;
    await assertFails(updateDoc(ref, { serverOnly: false })); checks++;
    await assertFails(deleteDoc(ref)); checks++;
    await assertFails(getDocs(collection(db, path.split('/').slice(0, -1).join('/')))); checks++;
  }
  console.log(`Workout notification rules: ${checks} assertions passed`);
} finally { await env.cleanup(); }
