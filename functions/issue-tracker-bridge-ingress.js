"use strict";
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(value).digest();
const STRINGS = ["id", "originalId", "immutableId", "internetMessageId", "receivedDateTime", "received", "subject", "summary", "bodyPreview", "category", "functionName", "operation", "affected", "webLink", "url", "detailUrl", "issueId", "from", "sender"];
const validKey = (value, max = 1024) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
function validMessage(message) {
  if (!validKey(message.originalId || message.id)) return false;
  for (const field of ["id", "originalId", "immutableId", "internetMessageId", "issueId"]) if (message[field] !== undefined && !validKey(message[field])) return false;
  for (const field of ["from", "sender"]) if (message[field] !== undefined && (typeof message[field] !== "string" || message[field].length > 320 || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(message[field]))) return false;
  if (Object.keys(message).some(key => ![...STRINGS, "aliases", "links", "body", "monitoring"].includes(key))) return false;
  for (const field of STRINGS) if (message[field] !== undefined && (typeof message[field] !== "string" || message[field].length > (/[Ii]d$/.test(field) ? 1024 : 30000))) return false;
  for (const field of ["aliases", "links"]) if (message[field] !== undefined && (!Array.isArray(message[field]) || message[field].length > 20 || message[field].some(value => field === "aliases" ? !validKey(value) : typeof value !== "string" || value.length > 2048))) return false;
  if (message.body !== undefined && !(typeof message.body === "string" && message.body.length <= 30000) &&
      !(message.body && typeof message.body === "object" && Object.keys(message.body).every(key => ["contentType", "content"].includes(key)) && typeof message.body.content === "string" && message.body.content.length <= 30000 && typeof message.body.contentType === "string" && ["text", "html"].includes(message.body.contentType.toLowerCase()))) return false;
  if (message.monitoring !== undefined && !(message.monitoring && typeof message.monitoring === "object" && Object.keys(message.monitoring).every(key => ["project", "incidentId"].includes(key)) && [message.monitoring.project, message.monitoring.incidentId].every(value => validKey(value, 256)))) return false;
  return true;
}
/** Separate mailbox-to-queue authorization. The secret grants only this bounded
 * enqueue operation, never Firestore/Excel access or arbitrary HTTP forwarding.
 */
function createTrackerMailIngress({ bridge, secret, mailbox = "dylank@posetek.net" }) {
  return async function receive(req, res) {
    if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
    const expected = await secret(), supplied = req.get?.("X-PoseTek-Tracker-Key") || req.headers?.["x-posetek-tracker-key"];
    if (typeof expected !== "string" || expected.length < 32) { res.status(503).json({ error: "not_configured" }); return; }
    if (typeof supplied !== "string" || supplied.length > 512 || !crypto.timingSafeEqual(hash(expected), hash(supplied))) { res.status(401).json({ error: "unauthorized" }); return; }
    if (req.rawBody?.length > 50000 || !/^application\/json(?:\s*;|$)/i.test(req.get?.("Content-Type") || req.headers?.["content-type"] || "")) { res.status(413).json({ error: "invalid_payload" }); return; }
    const data = req.body;
    if (!data || data.schemaVersion !== 1 || typeof data.mailbox !== "string" || data.mailbox.toLowerCase() !== mailbox.toLowerCase() || !data.message || typeof data.message !== "object" || Array.isArray(data.message) || !validMessage(data.message)) { res.status(400).json({ error: "invalid_message" }); return; }
    try {
      const result = await bridge.enqueueMessage({ ...data.message, mailbox: mailbox.toLowerCase() });
      res.status(200).json({ accepted: true, queued: result.queued });
    } catch (error) {
      if (["tracker_wrong_mailbox", "tracker_invalid_message", "tracker_message_too_large"].includes(error?.code)) { res.status(400).json({ error: "invalid_message" }); return; }
      // Returning a retryable response prevents an unqueued mail from being
      // acknowledged when the bridge is parked, unauthenticated or unavailable.
      res.status(503).json({ error: "queue_unavailable" });
    }
  };
}
module.exports = { createTrackerMailIngress, validMessage, validKey };
