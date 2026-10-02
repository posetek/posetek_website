"use strict";
const { createIssueTrackerBridge } = require("./issue-tracker-bridge");
const { createFlowTokenProvider, createPowerAutomateTransport } = require("./issue-tracker-bridge-transport");
const { createTrackerMailIngress } = require("./issue-tracker-bridge-ingress");
const { createIssueTrackerRecovery } = require("./issue-tracker-recovery");
const { createGraphTokenProvider, createGraphReader } = require("./issue-tracker-graph-reader");
const { createMailCapture } = require("./issue-tracker-mail-capture");
const { createSourceCapture } = require("./issue-tracker-source-capture");
const GRAPH_SECRETS = ["ISSUE_TRACKER_GRAPH_TENANT_ID", "ISSUE_TRACKER_GRAPH_CLIENT_ID", "ISSUE_TRACKER_GRAPH_CLIENT_SECRET"];

// Candidate factory only. Intentionally not exported from index.js before the
// connection, private rules, seed, pending local candidate and cost review pass.
function createIssueTrackerBridgeEntrypoints(functions, admin, { normalize, taskQueue, fetchImpl = fetch } = {}) {
  if (typeof normalize !== "function") throw new Error("tracker_normalizer_required");
  const queue = taskQueue || require("firebase-admin/functions").getFunctions().taskQueue("drainUserIssueTracker");
  const getAccessToken = createFlowTokenProvider({ fetchImpl, credentials: async () => ({
    tenantId: process.env.ISSUE_TRACKER_FLOW_TENANT_ID, clientId: process.env.ISSUE_TRACKER_FLOW_CLIENT_ID, clientSecret: process.env.ISSUE_TRACKER_FLOW_CLIENT_SECRET }) });
  const bridge = createIssueTrackerBridge({ db: admin.firestore(), normalize, scheduleTask: (data, options) => queue.enqueue(data, options),
    transport: createPowerAutomateTransport({ fetchImpl, getAccessToken, endpoint: async () => process.env.ISSUE_TRACKER_FLOW_ENDPOINT }) });
  const recovery = createIssueTrackerRecovery({ db: admin.firestore(), bridge });
  const graph = createGraphReader({ fetchImpl, getAccessToken: createGraphTokenProvider({ fetchImpl, credentials: async () => ({
    tenantId: process.env.ISSUE_TRACKER_GRAPH_TENANT_ID, clientId: process.env.ISSUE_TRACKER_GRAPH_CLIENT_ID, clientSecret: process.env.ISSUE_TRACKER_GRAPH_CLIENT_SECRET }) }) });
  const mailCapture = createMailCapture({ db: admin.firestore(), bridge, graph });
  const capture = createSourceCapture({ db: admin.firestore(), bridge, graph, mailCapture });
  return {
    observeUserIssueTracker: functions.runWith({ timeoutSeconds: 60, maxInstances: 5, failurePolicy: true }).firestore.document("userIssueOutbox/{id}").onWrite((_, context) => bridge.observeOutbox(context.params.id)),
    observeUserIssueTrackerOccurrence: functions.runWith({ timeoutSeconds: 60, maxInstances: 5, failurePolicy: true }).firestore.document("userIssueOccurrences/{id}").onWrite((_, context) => bridge.observeOccurrence(context.params.id)),
    drainUserIssueTracker: functions.runWith({ timeoutSeconds: 180, maxInstances: 1, secrets: ["ISSUE_TRACKER_FLOW_ENDPOINT", "ISSUE_TRACKER_FLOW_TENANT_ID", "ISSUE_TRACKER_FLOW_CLIENT_ID", "ISSUE_TRACKER_FLOW_CLIENT_SECRET"] })
      .tasks.taskQueue({ invoker: "private", rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 0.2 },
        retryConfig: { maxAttempts: 20, minBackoffSeconds: 90, maxBackoffSeconds: 3600, maxDoublings: 5 } }).onDispatch(async () => { await bridge.drain(); }),
    ingestUserIssueTrackerMail: functions.runWith({ timeoutSeconds: 90, maxInstances: 2, secrets: ["ISSUE_TRACKER_MAIL_INGRESS_SECRET", ...GRAPH_SECRETS] }).https.onRequest(
      createTrackerMailIngress({ bridge, ingestMessage: mailCapture.ingress, secret: async () => process.env.ISSUE_TRACKER_MAIL_INGRESS_SECRET })),
    recoverUserIssueTracker: functions.runWith({ timeoutSeconds: 180, maxInstances: 1 })
      .pubsub.schedule("every 15 minutes").timeZone("Etc/UTC").onRun(() => recovery.run()),
    captureUserIssueTrackerSources: functions.runWith({ timeoutSeconds: 180, maxInstances: 1, secrets: GRAPH_SECRETS })
      .pubsub.schedule("every 5 minutes").timeZone("Etc/UTC").onRun(async () => {
        // Independent credentials/cursors: Outlook denial must not skip backend
        // capture, and a backend page failure must not erase Outlook progress.
        const results = await Promise.allSettled([capture.run("outlook"), capture.run("backend")]);
        if (results.some(result => result.status === "rejected")) throw new Error("tracker_source_capture_incomplete");
      }),
  };
}
module.exports = { createIssueTrackerBridgeEntrypoints };
