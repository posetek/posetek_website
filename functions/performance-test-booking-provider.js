"use strict";

const RECIPIENT = "dylank@posetek.net";
const FROM = "PoseTek Bookings <bookings@alerts.posetek.net>";
const EMAIL = /^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/;

function failure(code, permanent = false, retryAfterMs = 0) {
  return Object.assign(new Error("Booking email could not be confirmed."), { code, permanent, retryAfterMs });
}

// Separate from the workout adapter: neither its sender guard nor its jobs change.
function createBookingEmailProvider({ apiKey, fetchImpl = fetch }) {
  return {
    async send(payload, idempotencyKey) {
      const key = apiKey();
      if (typeof key !== "string" || !key.trim()) throw failure("provider_not_configured", true);
      if (!payload || payload.from !== FROM || payload.to?.length !== 1 || payload.to[0] !== RECIPIENT
        || typeof payload.reply_to !== "string" || payload.reply_to.length > 254 || !EMAIL.test(payload.reply_to)
        || /[\x00-\x1f\x7f]/.test(payload.reply_to)
        || typeof idempotencyKey !== "string" || !/^performance-test-booking\/[0-9a-f-]{36}$/.test(idempotencyKey)) {
        throw failure("provider_payload_invalid", true);
      }
      let response;
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
        });
      } catch (_) { throw failure("provider_network"); }
      if (!response.ok) {
        const seconds = Number(response.headers?.get?.("retry-after"));
        throw failure(`provider_http_${response.status}`, !(response.status === 409 || response.status === 429 || response.status >= 500),
          Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 3600000) : 0);
      }
      let result;
      try { result = await response.json(); } catch (_) { /* Accepted-but-unreadable remains uncertain. */ }
      if (typeof result?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) throw failure("provider_invalid_response");
      // Provider bodies, secrets and contact data never enter errors or logs.
      return { id: result.id };
    },
  };
}

module.exports = { createBookingEmailProvider, RECIPIENT, FROM, EMAIL };
