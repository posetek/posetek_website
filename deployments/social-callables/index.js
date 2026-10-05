"use strict";
// Only these fourteen existing callables are exposed. No root event functions,
// schedules, rules, mail senders or projection writers are discovered here.
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const options = require("./runtime-options.json");
const roots = require("./implementation-roots.json");
const { observeSocialCallable } = require("./social-callable-observation");
admin.initializeApp();
function requireCaller(context) {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sign in to continue.");
  if (context.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new functions.https.HttpsError("permission-denied", "A registered account is required.");
  }
  return { uid: context.auth.uid, email: context.auth.token?.email || null, emailVerified: context.auth.token?.email_verified === true, isAnonymous: false };
}
const implementations = new Map();
for (const [endpoint, handler] of Object.entries({
  getSocialAdminDirectory: "adminDirectory", getSocialContext: "getContext", getSocialFeed: "getFeed", getSocialActivity: "getDetail",
  saveSocialPreferences: "savePreferences", setSocialVisibility: "setVisibility", getSocialPeople: "people",
  socialConnection: "connect", setSocialKudos: "kudos", getSocialComments: "comments", saveSocialComment: "comment",
  reportSocialActivity: "report", moderateSocialActivity: "moderation", getSocialMedia: "media",
})) {
  if (!options[endpoint]) throw new Error("Prepared runtime options missing: " + endpoint);
  const root = roots[endpoint];
  if (root !== "." && root !== `endpoint-deps/${endpoint}`) throw new Error("Prepared implementation root invalid: " + endpoint);
  if (!implementations.has(root)) {
    const { createSocial } = require(`./${root}/social.js`);
    implementations.set(root, createSocial({ db: admin.firestore(), bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), HttpsError: functions.https.HttpsError }));
  }
  const social = implementations.get(root);
  exports[endpoint] = functions.region("us-central1").runWith(options[endpoint]).https.onCall(observeSocialCallable({ endpoint,
    handler: (data, caller) => social[handler](data, caller), requireCaller, logger: functions.logger, HttpsError: functions.https.HttpsError }));
}
