"use strict";

const { createWorkoutNotifications } = require("./workout-notifications");
const { createNotificationProvider, verifyResendWebhook } = require("./workout-notifications-provider");
const { SECRETS } = require("./microsoft-email-transport");

function createWorkoutNotificationEntrypoints(functions, admin, caller) {
  const service = createWorkoutNotifications({ db: admin.firestore(), HttpsError: functions.https.HttpsError,
    provider: createNotificationProvider({ apiKey: () => process.env.RESEND_API_KEY }) });
  const observers = functions.runWith({ timeoutSeconds: 120, maxInstances: 10, failurePolicy: true });
  const sender = functions.runWith({ secrets: ["RESEND_API_KEY", ...SECRETS], timeoutSeconds: 120, maxInstances: 5, failurePolicy: true });
  const result = {
    observeWorkoutNotifications: observers.firestore.document("players/{playerId}/workoutLogs/{logId}").onWrite((change, context) => service.observe("workoutLogs", change, context)),
    observePersonalWorkoutNotifications: observers.firestore.document("players/{playerId}/personalWorkoutLogs/{logId}").onWrite((change, context) => service.observe("personalWorkoutLogs", change, context)),
    recordWorkoutActivity: functions.runWith({ timeoutSeconds: 60, maxInstances: 10 }).https.onCall((data, context) => service.recordWorkoutActivity(data, caller(context))),
    getWorkoutNotificationStatus: functions.runWith({ timeoutSeconds: 60, maxInstances: 10 }).https.onCall((data, context) => service.getWorkoutNotificationStatus(data, caller(context))),
    dispatchWorkoutNotification: sender.firestore.document("workoutNotificationOutbox/{notificationId}").onWrite((_, context) => service.dispatch(context.params.notificationId)),
    sweepWorkoutNotifications: functions.runWith({ secrets: ["RESEND_API_KEY", ...SECRETS], timeoutSeconds: 300, maxInstances: 1 }).pubsub.schedule("every 5 minutes").onRun(() => service.sweep()),
    resendWorkoutNotificationWebhook: functions.runWith({ secrets: ["RESEND_WEBHOOK_SECRET"], timeoutSeconds: 60, maxInstances: 10 }).https.onRequest(async (req, res) => {
      if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
      let verified;
      try { verified = verifyResendWebhook(req.rawBody, req.headers, process.env.RESEND_WEBHOOK_SECRET); }
      catch (_) { res.status(400).send("Invalid webhook"); return; }
      try {
        await service.webhook(verified);
        const { createUserIssues } = require("./user-issues");
        await createUserIssues({ db: admin.firestore(), HttpsError: functions.https.HttpsError, logger: functions.logger }).webhook(verified);
        res.status(200).send("OK");
      }
      catch (error) { res.status(error.code === "invalid-argument" ? 400 : 503).send("Delivery event not recorded"); }
    }),
  };
  return result;
}
module.exports = { createWorkoutNotificationEntrypoints };
