"use strict";
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { createAppFeedbackHttp, createAppFeedbackAdmin } = require("./app-feedback");
admin.initializeApp();
const shared = { db: admin.firestore(), Timestamp: admin.firestore.Timestamp };
exports.receiveAppFeedback = functions.runWith({ secrets: ["APP_FEEDBACK_RATE_KEY"], timeoutSeconds: 30, maxInstances: 10 }).https.onRequest(
  createAppFeedbackHttp({ ...shared, rateKey: () => process.env.APP_FEEDBACK_RATE_KEY,
    verifyIdToken: (token, checkRevoked) => admin.auth().verifyIdToken(token, checkRevoked), getUser: uid => admin.auth().getUser(uid) })
);
const review = createAppFeedbackAdmin({ ...shared, HttpsError: functions.https.HttpsError });
exports.getAppFeedback = functions.runWith({ timeoutSeconds: 30, maxInstances: 5 }).https.onCall((data, context) => {
  const token = context.auth?.token;
  return review(data || {}, context.auth ? { uid: context.auth.uid, email: token?.email,
    emailVerified: token?.email_verified === true, isAnonymous: token?.firebase?.sign_in_provider === "anonymous" } : null);
});
