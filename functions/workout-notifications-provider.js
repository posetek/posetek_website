"use strict";

const crypto = require("node:crypto");
const RECIPIENT = "dylank@posetek.net";
const FROM = "PoseTek Workouts <workouts@alerts.posetek.net>";

// No provider response body or credential is copied into application logs/errors.
function createResendProvider({ apiKey, fetchImpl = fetch }) {
  return {
    async send(payload, idempotencyKey) {
      const key = apiKey();
      if (typeof key !== "string" || !key.trim()) throw Object.assign(new Error("Email credentials are not configured."), { code: "provider_not_configured", permanent: true });
      if (payload.from !== FROM || payload.to?.length !== 1 || payload.to[0] !== RECIPIENT) {
        throw Object.assign(new Error("Email recipient configuration is invalid."), { code: "recipient_invalid", permanent: true });
      }
      let response;
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
        });
      } catch (_) { throw Object.assign(new Error("Email request outcome is uncertain."), { code: "provider_network", permanent: false }); }
      if (!response.ok) {
        const retry = Number(response.headers?.get?.("retry-after"));
        throw Object.assign(new Error("Email service rejected the request."), {
          code: `provider_http_${response.status}`, permanent: !(response.status === 429 || response.status === 409 || response.status >= 500),
          retryAfterMs: Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 3600000) : 0,
        });
      }
      let result;
      try { result = await response.json(); } catch (_) { /* accepted but unparseable is an ambiguous outcome */ }
      if (typeof result?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) {
        throw Object.assign(new Error("Email service acceptance could not be confirmed."), { code: "provider_invalid_response", permanent: false });
      }
      return { id: result.id };
    },
  };
}

// Svix's published v1 protocol signs id.timestamp.rawBody, with a base64
// whsec_ key. Verify the original bytes and freshness before JSON parsing.
function verifyResendWebhook(rawBody, headers, secret, now = Date.now()) {
  const invalid = () => { throw new Error("Invalid webhook signature."); };
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 131072 || !rawBody.length
    || typeof secret !== "string" || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) invalid();
  const id = headers["svix-id"], timestamp = headers["svix-timestamp"], signatures = headers["svix-signature"];
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || typeof timestamp !== "string" || !/^\d{10,12}$/.test(timestamp)
    || typeof signatures !== "string" || signatures.length > 4096 || Math.abs(now - Number(timestamp) * 1000) > 300000) invalid();
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) invalid();
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  const matches = signatures.split(/\s+/).some(value => {
    const [version, signature] = value.split(",");
    if (version !== "v1" || typeof signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    const candidate = Buffer.from(signature, "base64");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  });
  if (!matches) invalid();
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); } catch (_) { invalid(); }
  return { id, event };
}

module.exports = { createResendProvider, verifyResendWebhook, RECIPIENT, FROM };
