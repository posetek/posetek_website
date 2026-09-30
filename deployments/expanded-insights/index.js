"use strict";
// Deliberately scoped bundle: only the nine Expanded Insights functions.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
function requireCaller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  return { uid: context.auth.uid, email: context.auth.token?.email || null, emailVerified: context.auth.token?.email_verified === true, isAnonymous: false };
}
Object.assign(exports, require("./insights-entrypoints").createInsightsEntrypoints(functions, admin, requireCaller));
