// Recovery state is available through authorized callables only, including for
// organization managers and PoseTek admins. Test canonical mobile-owned rules.
import { firestoreEmulator } from './canonicalRules.mjs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-account-recovery', firestore: firestoreEmulator() });
const roots = ['accountRecoveryRequests', 'accountRecoveryRequestRateLimits', 'accountAccessGrants', 'accountAccessTargets', 'accountAccessRateLimits', 'accountAccessAudit'];
let checks = 0;
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const root of roots) await setDoc(doc(context.firestore(), `${root}/synthetic`), { serverOnly: true, organizationId: 'org', targetUID: 'athlete' });
    await setDoc(doc(context.firestore(), 'organizations/org'), { schemaVersion: 2, name: 'Synthetic' });
    await setDoc(doc(context.firestore(), 'organizations/org/members/manager'), { userUID: 'manager', role: 'manager', status: 'active', teamIds: [] });
  });
  const actors = [env.unauthenticatedContext(), ...[
    ['athlete', { email: 'player@example.test', email_verified: true }],
    ['coach', { email: 'coach@example.test', email_verified: true }],
    ['manager', { email: 'manager@example.test', email_verified: true }],
    ['admin', { email: 'operator@posetek.net', email_verified: true }],
    ['unverified-admin', { email: 'operator@posetek.net', email_verified: false }],
    ['forged-admin', { email: 'operator@posetek.net.evil.test', email_verified: true, admin: true }],
    ['anonymous', { firebase: { sign_in_provider: 'anonymous' } }],
  ].map(([uid, claims]) => env.authenticatedContext(uid, claims))];
  for (const actor of actors) for (const root of roots) {
    const db = actor.firestore(), ref = doc(db, `${root}/synthetic`);
    await assertFails(getDoc(ref)); checks++;
    await assertFails(getDocs(collection(db, root))); checks++;
    await assertFails(setDoc(doc(db, `${root}/forged`), { organizationId: 'org', targetUID: 'athlete', identityConfirmed: true })); checks++;
    await assertFails(updateDoc(ref, { status: 'confirmed' })); checks++;
    await assertFails(deleteDoc(ref)); checks++;
  }
  console.log(`Account recovery rules: ${checks} assertions passed`);
} finally { await env.cleanup(); }
