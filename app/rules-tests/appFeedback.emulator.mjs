// Feedback is server-only. Admin review is authorized by getAppFeedback,
// not by a browser read of survey responses or abuse-counter documents.
import { createRequire } from 'node:module';
import { firestoreEmulator } from './canonicalRules.mjs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';

const { COLLECTIONS } = createRequire(import.meta.url)('../../functions/app-feedback.js');
setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-app-feedback', firestore: firestoreEmulator() });
const roots = Object.values(COLLECTIONS);
let checks = 0;
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const root of roots) await setDoc(doc(context.firestore(), `${root}/synthetic`), { serverOnly: true });
  });
  const actors = [env.unauthenticatedContext(), ...[
    ['athlete', { email: 'kid@example.test', email_verified: true }],
    ['coach', { email: 'coach@example.test', email_verified: true }],
    ['manager', { email: 'manager@example.test', email_verified: true }],
    ['admin', { email: 'dylan@posetek.net', email_verified: true }],
    ['unverified-admin', { email: 'dylan@posetek.net', email_verified: false }],
    ['forged-admin', { email: 'forged@posetek.net.evil.test', email_verified: true, admin: true }],
    ['anonymous', { firebase: { sign_in_provider: 'anonymous' } }],
  ].map(([uid, claims]) => env.authenticatedContext(uid, claims))];
  for (const actor of actors) for (const root of roots) {
    const db = actor.firestore(), ref = doc(db, `${root}/synthetic`);
    await assertFails(getDoc(ref)); checks++;
    await assertFails(getDocs(collection(db, root))); checks++;
    await assertFails(setDoc(doc(db, `${root}/forged`), { forged: true })); checks++;
    await assertFails(updateDoc(ref, { serverOnly: false })); checks++;
    await assertFails(deleteDoc(ref)); checks++;
  }
  console.log(`App feedback rules: ${checks} assertions passed`);
} finally { await env.cleanup(); }
