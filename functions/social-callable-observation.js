"use strict";
const { randomUUID } = require("node:crypto");
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const CODES = new Set(["ok", "cancelled", "unknown", "invalid-argument", "deadline-exceeded", "not-found", "already-exists", "permission-denied", "resource-exhausted", "failed-precondition", "aborted", "out-of-range", "unimplemented", "internal", "unavailable", "data-loss", "unauthenticated"]);
const GRPC = ["ok", "cancelled", "unknown", "invalid-argument", "deadline-exceeded", "not-found", "already-exists", "permission-denied", "resource-exhausted", "failed-precondition", "aborted", "out-of-range", "unimplemented", "internal", "unavailable", "data-loss", "unauthenticated"];
function failureCode(error) {
  const code = typeof error?.code === "number" ? GRPC[error.code] : String(error?.code || "").replace(/^functions\//, "");
  return CODES.has(code) && code !== "ok" ? code : "internal";
}
function observeSocialCallable({ endpoint, handler, requireCaller, logger, HttpsError, now = Date.now, newId = randomUUID }) {
  return async (data, context) => {
    const supplied = data?.requestId || data?.jobId;
    const requestId = typeof supplied === "string" && ID.test(supplied) ? supplied : newId();
    const started = now(); let caller;
    const category = (code, explicit) => explicit && ["invalid-argument", "failed-precondition", "out-of-range", "already-exists"].includes(code) ? "action_validation" : "request_failure";
    const record = (outcome, code, explicit) => ({ event: "posetek_callable_outcome", operation: endpoint, requestId,
      // This comes only from the authenticated server context. Neither an input
      // UID nor the target athlete can identify the account making this request.
      reporterUid: caller?.uid || null, outcome, code, durationMillis: Math.max(0, now() - started),
      errorCategory: outcome === "failed" ? category(code, explicit) : null,
      message: outcome === "succeeded" ? "Callable request succeeded." : `Callable request ${outcome} (${code}${outcome === "failed" ? `; ${category(code, explicit)}` : ""}).` });
    const log = (level, outcome, code, explicit = false) => { try { logger[level](record(outcome, code, explicit)); } catch { /* Observation must not change the user's operation. */ } };
    try {
      caller = requireCaller(context);
      const result = await handler(data || {}, caller);
      log("info", "succeeded", "ok");
      return result;
    } catch (error) {
      const code = failureCode(error);
      const explicit = error instanceof HttpsError;
      if (explicit && code === "cancelled") log("info", "cancelled", code, explicit);
      else log("error", "failed", code, explicit);
      // Known callable errors retain their public contract. A raw internal error
      // would already become INTERNAL at the callable boundary; convert it here
      // after the correlated log so runtime logging cannot emit a second,
      // uncorrelated copy containing raw exception text.
      if (explicit) throw error;
      // Match firebase-functions' non-HttpsError response exactly. gRPC codes
      // remain diagnostic evidence, never a replacement public error contract.
      throw new HttpsError("internal", "INTERNAL");
    }
  };
}
module.exports = { failureCode, observeSocialCallable };
