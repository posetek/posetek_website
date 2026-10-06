"use strict";
const { createIssueTrackerBridge } = require("./issue-tracker-bridge");
const { createFlowTokenProvider, createPowerAutomateTransport } = require("./issue-tracker-bridge-transport");
const { createTrackerMailIngress } = require("./issue-tracker-bridge-ingress");
const { createIssueTrackerRecovery } = require("./issue-tracker-recovery");
const { createGraphTokenProvider, createGraphReader } = require("./issue-tracker-graph-reader");
const { createMailCapture } = require("./issue-tracker-mail-capture");
const { createSourceCapture } = require("./issue-tracker-source-capture");
const { createMailReadProxyTransport, createConfiguredMailReader } = require("./issue-tracker-mail-read-proxy");
const { createMailIdentityProxyTransport } = require("./issue-tracker-mail-identity-proxy");
const { createIssueContactEnrichment } = require("./user-issue-contacts");
const GRAPH_SECRETS = ["ISSUE_TRACKER_GRAPH_TENANT_ID", "ISSUE_TRACKER_GRAPH_CLIENT_ID", "ISSUE_TRACKER_GRAPH_CLIENT_SECRET"];
const MAIL_READ_SECRETS = [...GRAPH_SECRETS, "ISSUE_TRACKER_MAIL_READ_FLOW_ENDPOINT", "ISSUE_TRACKER_FLOW_TENANT_ID", "ISSUE_TRACKER_FLOW_CLIENT_ID", "ISSUE_TRACKER_FLOW_CLIENT_SECRET"];

const SOURCE_BRANCHES = ["outlook", "backend", "mail_join_recovery", "contacts"];
const SOURCE_FAILURE_CODES = new Set([
  "tracker_source_capture_failed", "tracker_mail_alias_budget_exceeded", "tracker_mail_alias_lookups_exceeded",
  "tracker_mail_alias_candidates_exceeded", "tracker_mail_reconciliation_wake_failed",
  "tracker_mail_reconciliation_cursor_changed", "tracker_mail_reconciliation_progress_failed",
  "tracker_mail_identity_budget_exceeded", "tracker_mail_identity_unverified", "tracker_mail_identity_item_changed",
  "tracker_mail_identity_not_configured", "tracker_mail_identity_unavailable", "tracker_mail_identity_access_denied",
  "tracker_mail_identity_throttled", "tracker_mail_identity_translation_failed", "tracker_mail_identity_invalid_response",
  "tracker_graph_access_denied", "tracker_graph_message_unavailable", "tracker_graph_throttled",
  "tracker_graph_read_unavailable", "tracker_graph_auth_unavailable", "tracker_graph_auth_rejected",
  "tracker_mail_proxy_not_configured", "tracker_mail_proxy_unavailable", "tracker_mail_proxy_read_failed",
  "tracker_mail_proxy_invalid_response", "tracker_mail_not_configured", "tracker_alias_group_unverified",
  "tracker_alias_group_changed", "tracker_mail_join_changed", "tracker_capture_lease_lost",
  "tracker_capture_configuration_changed", "tracker_capture_workbook_changed", "tracker_capture_provider_changed",
  "tracker_capture_missing_checkpoint", "tracker_capture_receipt_changed", "tracker_capture_cursor_changed",
]);
function sourceFailureReason(error) {
  let code;
  try { code = error?.code; } catch (_) { /* An unreadable code is an unknown failure. */ }
  return typeof code === "string" && SOURCE_FAILURE_CODES.has(code) ? code : "tracker_source_capture_failed";
}

// Candidate factory only. Intentionally not exported from index.js before the
// connection, private rules, seed, pending local candidate and cost review pass.
function createIssueTrackerBridgeEntrypoints(functions, admin, { normalize, taskQueue, fetchImpl = fetch, mailIdentityEnabled = false } = {}) {
  if (typeof normalize !== "function") throw new Error("tracker_normalizer_required");
  if (typeof mailIdentityEnabled !== "boolean") throw new Error("tracker_identity_flag_required");
  const mailReadSecrets = mailIdentityEnabled ? [...MAIL_READ_SECRETS, "ISSUE_TRACKER_MAIL_IDENTITY_FLOW_ENDPOINT"] : MAIL_READ_SECRETS;
  const queue = taskQueue || require("firebase-admin/functions").getFunctions().taskQueue("drainUserIssueTracker");
  const getAccessToken = createFlowTokenProvider({ fetchImpl, credentials: async () => ({
    tenantId: process.env.ISSUE_TRACKER_FLOW_TENANT_ID, clientId: process.env.ISSUE_TRACKER_FLOW_CLIENT_ID, clientSecret: process.env.ISSUE_TRACKER_FLOW_CLIENT_SECRET }) });
  const bridge = createIssueTrackerBridge({ db: admin.firestore(), normalize, scheduleTask: (data, options) => queue.enqueue(data, options),
    transport: createPowerAutomateTransport({ fetchImpl, getAccessToken, endpoint: async () => process.env.ISSUE_TRACKER_FLOW_ENDPOINT }) });
  const recovery = createIssueTrackerRecovery({ db: admin.firestore(), bridge });
  const appGraph = createGraphReader({ fetchImpl, getAccessToken: createGraphTokenProvider({ fetchImpl, credentials: async () => ({
    tenantId: process.env.ISSUE_TRACKER_GRAPH_TENANT_ID, clientId: process.env.ISSUE_TRACKER_GRAPH_CLIENT_ID, clientSecret: process.env.ISSUE_TRACKER_GRAPH_CLIENT_SECRET }) }) });
  const configuration = async () => (await admin.firestore().doc("issueTrackerSettings/current").get()).data();
  const graph = createConfiguredMailReader({ configuration, graph: appGraph,
    ...(mailIdentityEnabled ? { translateIds: createMailIdentityProxyTransport({ configuration, getAccessToken, fetchImpl,
      endpoint: async () => process.env.ISSUE_TRACKER_MAIL_IDENTITY_FLOW_ENDPOINT,
      identity: async () => ({ tenantId: process.env.ISSUE_TRACKER_FLOW_TENANT_ID, clientId: process.env.ISSUE_TRACKER_FLOW_CLIENT_ID }) }) } : {}),
    proxyRequest: createMailReadProxyTransport({ configuration, getAccessToken, fetchImpl,
      endpoint: async () => process.env.ISSUE_TRACKER_MAIL_READ_FLOW_ENDPOINT,
      identity: async () => ({ tenantId: process.env.ISSUE_TRACKER_FLOW_TENANT_ID, clientId: process.env.ISSUE_TRACKER_FLOW_CLIENT_ID }) }) });
  const mailCapture = createMailCapture({ db: admin.firestore(), bridge, graph });
  const contacts = createIssueContactEnrichment({ db: admin.firestore(), auth: typeof admin.auth === "function" ? admin.auth() : null });
  const capture = createSourceCapture({ db: admin.firestore(), bridge, graph, mailCapture });
  return {
    observeUserIssueTracker: functions.runWith({ timeoutSeconds: 60, maxInstances: 5, failurePolicy: true }).firestore.document("userIssueOutbox/{id}").onWrite((_, context) => bridge.observeOutbox(context.params.id)),
    observeUserIssueTrackerOccurrence: functions.runWith({ timeoutSeconds: 60, maxInstances: 5, failurePolicy: true }).firestore.document("userIssueOccurrences/{id}").onWrite((_, context) => bridge.observeOccurrence(context.params.id)),
    drainUserIssueTracker: functions.runWith({ timeoutSeconds: 180, maxInstances: 1, secrets: ["ISSUE_TRACKER_FLOW_ENDPOINT", "ISSUE_TRACKER_FLOW_TENANT_ID", "ISSUE_TRACKER_FLOW_CLIENT_ID", "ISSUE_TRACKER_FLOW_CLIENT_SECRET"] })
      .tasks.taskQueue({ invoker: "private", rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 0.2 },
        retryConfig: { maxAttempts: 20, minBackoffSeconds: 90, maxBackoffSeconds: 3600, maxDoublings: 5 } }).onDispatch(async () => { await bridge.drain(); }),
    ingestUserIssueTrackerMail: functions.runWith({ timeoutSeconds: 90, maxInstances: 2, secrets: ["ISSUE_TRACKER_MAIL_INGRESS_SECRET", ...mailReadSecrets] }).https.onRequest(
      createTrackerMailIngress({ bridge, ingestMessage: mailCapture.ingress, secret: async () => process.env.ISSUE_TRACKER_MAIL_INGRESS_SECRET })),
    recoverUserIssueTracker: functions.runWith({ timeoutSeconds: 180, maxInstances: 1 })
      .pubsub.schedule("every 15 minutes").timeZone("Etc/UTC").onRun(() => recovery.run()),
    captureUserIssueTrackerSources: functions.runWith({ timeoutSeconds: 180, maxInstances: 1, secrets: mailReadSecrets })
      .pubsub.schedule("every 5 minutes").timeZone("Etc/UTC").onRun(async () => {
        // Independent credentials/cursors: Outlook denial must not skip backend
        // capture, and a backend page failure must not erase Outlook progress.
        const results = await Promise.allSettled([capture.run("outlook"), capture.run("backend"), mailCapture.reconcile(), contacts.reconcile()]);
        let incomplete = false;
        results.forEach((result, index) => {
          if (result.status !== "rejected") return;
          incomplete = true;
          // Only fixed branch labels and allowlisted codes reach logs. Never pass
          // an error object, message, stack, provider response or source identity.
          try {
            if (typeof functions.logger?.error === "function") functions.logger.error("tracker_source_capture_branch_failed", {
              branch: SOURCE_BRANCHES[index], reason: sourceFailureReason(result.reason),
            });
          } catch (_) { /* Diagnostics must not replace the original retry error. */ }
        });
        if (incomplete) throw new Error("tracker_source_capture_incomplete");
      }),
  };
}
module.exports = { createIssueTrackerBridgeEntrypoints };
