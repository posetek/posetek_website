"use strict";
const M = require("./microsoft-email-model");
const { createMicrosoftEmail } = require("./microsoft-email");
const { createTraceReader, createTokenProvider, credentialsFromEnv } = require("./microsoft-email-transport");
function createMicrosoftEmailEntrypoints(functions, admin) {
  const traceReader = createTraceReader({ getAccessToken: createTokenProvider({ credentials: credentialsFromEnv, scope: "https://graph.microsoft.com/.default" }), beforeRequest: () => service.reserveTraceRequest() });
  const service = createMicrosoftEmail({ db: admin.firestore(), traceReader, logger: functions.logger });
  const handler = method => async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
    if (!M.authenticate(req.headers["x-posetek-email-secret"], process.env.MICROSOFT_EMAIL_CALLBACK_SECRET)) { res.status(401).send("Unauthorized"); return; }
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "") || !Buffer.isBuffer(req.rawBody) || req.rawBody.length > 4096) { res.status(400).send("Invalid request"); return; }
    try { res.status(200).json(await service[method](req.body)); }
    catch (error) {
      const known = ["email_invalid_request", "email_claim_mismatch"].includes(error?.code);
      if (!known) functions.logger.error("microsoft_email_callback_failed", { operation: method, code: "callback_unavailable" });
      res.status(known ? 400 : 503).send(known ? "Invalid email claim" : "Email receipt unavailable");
    }
  };
  const callback = functions.runWith({ secrets: ["MICROSOFT_EMAIL_CALLBACK_SECRET"], timeoutSeconds: 60, maxInstances: 10 });
  return {
    claimMicrosoftEmail: callback.https.onRequest(handler("claim")),
    receiptMicrosoftEmail: callback.https.onRequest(handler("receipt")),
    reconcileMicrosoftEmail: functions.runWith({ secrets: ["MICROSOFT_EMAIL_TENANT_ID", "MICROSOFT_EMAIL_CLIENT_ID", "MICROSOFT_EMAIL_CLIENT_SECRET"], timeoutSeconds: 300, maxInstances: 1 })
      .pubsub.schedule("every 5 minutes").onRun(() => service.reconcile()),
  };
}
module.exports = { createMicrosoftEmailEntrypoints };
