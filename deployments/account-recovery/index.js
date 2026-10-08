"use strict";

// Exactly the reviewed player-recovery scope. The default codebase is retained
// for the four existing account-access transports; deploy with the explicit
// endpoint filter printed by prepare.py, never the central functions entry.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { createClubs } = require("./clubs");
const { createAccountAccess } = require("./account-access");
admin.initializeApp();
const shared = { db: admin.firestore(), FieldValue: admin.firestore.FieldValue, HttpsError: functions.https.HttpsError };
const clubs = createClubs(shared);
const access = createAccountAccess({ ...shared, clubs, authDirectory: admin.auth() });

function caller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  const token = context.auth.token;
  return { uid: context.auth.uid, email: token?.email || null, emailVerified: token?.email_verified === true,
    authTime: token?.auth_time, signInProvider: token?.firebase?.sign_in_provider || null, isAnonymous: false };
}

for (const name of ["listAccountAccessLinks", "revokeAccountAccessLink"]) {
  exports[name] = functions.https.onCall(async (data, context) => {
    const current = caller(context);
    await access.rate(context.rawRequest, current, "manage", 60);
    return access[name](data || {}, current);
  });
}
for (const name of ["getAccountAccessLink", "completeAccountAccessLink"]) {
  exports[name] = functions.runWith({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
    const current = context.auth ? caller(context) : null;
    await access.rate(context.rawRequest, current, name === "getAccountAccessLink" ? "check" : "complete", name === "getAccountAccessLink" ? 60 : 10);
    return access[name](data || {}, current);
  });
}
for (const name of ["inspectPlayerRecovery", "issuePlayerRecovery", "listAccountRecoveryRequests", "updateAccountRecoveryRequest", "confirmAccountRecovery"]) {
  exports[name] = functions.runWith({ timeoutSeconds: 60, maxInstances: 5 }).https.onCall(async (data, context) => {
    const current = caller(context);
    await access.rate(context.rawRequest, current, name === "issuePlayerRecovery" ? "issue" : "recovery_manage", name === "issuePlayerRecovery" ? 30 : 60);
    return access[name](data || {}, current);
  });
}
exports.submitAccountRecoveryRequest = functions.runWith({ timeoutSeconds: 30, maxInstances: 10 }).https.onCall(async (data, context) => {
  const current = context.auth && context.auth.token?.firebase?.sign_in_provider !== "anonymous" ? caller(context) : null;
  await access.rate(context.rawRequest, current, "recovery_request", 5);
  return access.submitAccountRecoveryRequest(data || {}, current, context.rawRequest);
});
