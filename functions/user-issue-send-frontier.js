"use strict";
const TYPES = new Set(["incident", "status", "daily"]);
function configuration(settings, at) {
  if (!Object.hasOwn(settings || {}, "sendFromMillis")) return { configured: false, valid: true, fromMillis: null };
  const fromMillis = settings.sendFromMillis;
  return { configured: true, valid: Number.isSafeInteger(fromMillis) && fromMillis > 0 && fromMillis <= at, fromMillis };
}
// This is a send-only frontier, never an intake cutoff or a backlog mutation.
// Historical claims and their receipt/trace reconciliation remain untouched.
function allows(settings, job, at) {
  const value = configuration(settings, at);
  return value.valid && (!value.configured || TYPES.has(job?.type)
    && Number.isSafeInteger(job.createdAtMillis) && job.createdAtMillis >= value.fromMillis && job.createdAtMillis <= at);
}
module.exports = { configuration, allows };
