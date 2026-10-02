"use strict";
const { createUserIssues } = require("./user-issues");
const { createIssueSources } = require("./user-issue-sources");
const { createNotificationProvider } = require("./workout-notifications-provider");
const { SECRETS } = require("./microsoft-email-transport");
const { FROM, RECIPIENTS } = require("./user-issue-model");
function createUserIssueEntrypoints(functions, admin) {
  const db = admin.firestore();
  const service = createUserIssues({ db, HttpsError: functions.https.HttpsError, logger: functions.logger,
    provider: createNotificationProvider({ apiKey: () => process.env.RESEND_API_KEY, from: FROM, recipients: RECIPIENTS }) });
  const sources = createIssueSources(service, db);
  const caller = context => context.auth ? { uid: context.auth.uid, email: context.auth.token?.email, emailVerified: context.auth.token?.email_verified === true,
    displayName: context.auth.token?.name, isAnonymous: context.auth.token?.firebase?.sign_in_provider === "anonymous" } : null;
  const read = functions.runWith({ timeoutSeconds: 60, maxInstances: 10 });
  const observer = functions.runWith({ timeoutSeconds: 120, maxInstances: 5, failurePolicy: true });
  return {
    submitUserIssue: read.https.onCall((data, context) => service.submit(data, caller(context), context.rawRequest?.ip || "unknown")),
    getUserIssues: read.https.onCall((data, context) => service.list(data, caller(context))),
    updateUserIssue: read.https.onCall((data, context) => service.triage(data, caller(context))),
    observeIssueAi: observer.firestore.document("aiIncidents/{id}").onCreate((snap, context) => sources.document("aiIncidents", snap, context)),
    observeIssueReport: observer.firestore.document("fieldReports/{id}").onCreate((snap, context) => sources.document("fieldReports", snap, context)),
    observeIssueDiagnostic: observer.firestore.document("failureCases/{id}").onCreate((snap, context) => sources.document("failureCases", snap, context)),
    observeIssueLog: observer.pubsub.topic("posetek-user-issues").onPublish(message => sources.log(message)),
    dispatchUserIssue: functions.runWith({ secrets: ["RESEND_API_KEY", ...SECRETS], timeoutSeconds: 120, maxInstances: 5, failurePolicy: true }).firestore.document("userIssueOutbox/{id}").onWrite((_, context) => service.dispatch(context.params.id)),
    sweepUserIssues: functions.runWith({ secrets: ["RESEND_API_KEY", ...SECRETS], timeoutSeconds: 300, maxInstances: 1 }).pubsub.schedule("every 5 minutes").onRun(() => service.sweep()),
    dailyUserIssues: functions.runWith({ secrets: ["RESEND_API_KEY", ...SECRETS], timeoutSeconds: 300, maxInstances: 1 }).pubsub.schedule("0 9 * * *").timeZone("America/Los_Angeles").onRun(() => service.daily()),
  };
}
module.exports = { createUserIssueEntrypoints };
