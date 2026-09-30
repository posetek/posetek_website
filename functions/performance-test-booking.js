"use strict";

const crypto = require("node:crypto");
const { isIP } = require("node:net");
const { RECIPIENT, FROM, EMAIL } = require("./performance-test-booking-provider");

const TIMEZONE = "America/Los_Angeles";
const REQUESTS = "performanceTestBookingRequests";
const LIMITS = "performanceTestBookingLimits";
const LEASE_MS = 60000;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const MAX_ATTEMPTS = 12;
const SAFE_DELIVERY_MESSAGE = "We couldn’t confirm delivery. Try again or email dylank@posetek.net.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_FIELDS = new Set(["requestId", "fullName", "email", "appointmentDate", "timeSlot", "timezone", "bookingType", "notes", "website"]);
const SLOTS = new Set(["flexible", ...Array.from({ length: 17 }, (_, n) => `${String(9 + Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "30" : "00"}`)]);
const ORIGINS = new Set(["https://posetek.net", "https://www.posetek.net"]);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

class BookingError extends Error {
  constructor(status, code, message, retryAfterSeconds = 0) {
    super(message); Object.assign(this, { status, code, retryAfterSeconds });
  }
}
const invalid = message => { throw new BookingError(400, "invalid_request", message); };
const unavailable = (retryAfterSeconds = 30) => new BookingError(503, "delivery_unconfirmed", SAFE_DELIVERY_MESSAGE, retryAfterSeconds);

function field(value, name, max, { optional = false, multiline = false } = {}) {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || value.length > max || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) invalid(`Check ${name} and try again.`);
  const result = value.trim();
  if (!optional && !result) invalid(`Enter ${name}.`);
  return result;
}

function validateBooking(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !ALLOWED_FIELDS.has(key))) invalid("Check your request and try again.");
  if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) invalid("Refresh the page and try again.");
  const website = field(body.website, "your request", 200, { optional: true });
  if (website) invalid("Your request could not be submitted.");
  const fullName = field(body.fullName, "your name", 120);
  const email = field(body.email, "your email", 254);
  if (!EMAIL.test(email)) invalid("Enter a valid email address.");
  const appointmentDate = field(body.appointmentDate, "a preferred date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) invalid("Choose a valid preferred date.");
  const date = new Date(appointmentDate + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== appointmentDate) invalid("Choose a valid preferred date.");
  const timeSlot = field(body.timeSlot, "a preferred time", 8);
  if (!SLOTS.has(timeSlot)) invalid("Choose a preferred time or Flexible.");
  if (body.timezone !== TIMEZONE) invalid("Use Pacific time for your request.");
  const bookingType = body.bookingType === undefined ? "individual" : body.bookingType;
  if (!["individual", "team", "other"].includes(bookingType)) invalid("Choose a request type.");
  const notes = field(body.notes, "your notes", 1500, { optional: true, multiline: true }).replace(/\r\n?/g, "\n");
  return { requestId: body.requestId.toLowerCase(), fullName, email, appointmentDate, timeSlot, timezone: TIMEZONE, bookingType, notes };
}

function checkNewDate(date, now) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  const today = `${value("year")}-${value("month")}-${value("day")}`;
  const latest = new Date(Date.parse(today + "T00:00:00Z") + 366 * 86400000).toISOString().slice(0, 10);
  if (date < today || date > latest) invalid("Choose today or a date within the next year, in Pacific time.");
}

function ipIdentity(ip) {
  if (typeof ip !== "string" || ip.length > 64 || !isIP(ip)) throw unavailable();
  ip = ip.toLowerCase();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return sha("performance-test-booking-ip:" + ip);
}

function emailFor(request) {
  return {
    from: FROM, to: [RECIPIENT], reply_to: request.email,
    subject: `Performance test request — ${request.bookingType} — ${request.appointmentDate}`,
    text: ["New PoseTek performance test request", "", "This is a request for confirmation, not a reserved appointment.", "",
      `Name: ${request.fullName}`, `Reply email: ${request.email}`, `Request type: ${request.bookingType}`,
      `Preferred date: ${request.appointmentDate}`, `Preferred time: ${request.timeSlot === "flexible" ? "Flexible" : request.timeSlot} (Pacific time; ${TIMEZONE})`,
      "", "Notes:", request.notes || "None provided.", "", `Request reference: ${request.requestId}`].join("\n"),
  };
}

function createPerformanceTestBooking({ db, provider, now = () => Date.now(), randomId = () => crypto.randomUUID() }) {
  async function submit(body, rawRequest) {
    const request = validateBooking(body), fingerprint = sha(JSON.stringify(request));
    // req.ip is supplied by the platform. Never parse client forwarding headers.
    const rateRef = db.collection(LIMITS).doc(ipIdentity(rawRequest?.ip));
    const ref = db.collection(REQUESTS).doc(request.requestId), leaseToken = randomId();
    const claim = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref), current = now();
      if (!Number.isSafeInteger(current) || current < 0) throw unavailable();
      let record = snapshot.data();
      if (snapshot.exists) {
        if (record?.schemaVersion !== 1 || record?.fingerprint !== fingerprint) throw new BookingError(409, "request_conflict", "This request reference was already used. Submit changes as a new request.");
        if (record.deliveryStatus === "accepted") return { accepted: true };
        if (!Number.isSafeInteger(record.firstAttemptAtMillis) || current < record.firstAttemptAtMillis) throw unavailable();
        // A duplicate must never replace the status of a still-running final
        // attempt, even when its retry deadline/attempt count has been reached.
        if (record.leaseUntilMillis > current) return { waitSeconds: Math.max(1, Math.ceil((record.leaseUntilMillis - current) / 1000)) };
        if (current - record.firstAttemptAtMillis >= RETRY_WINDOW_MS || record.attempts >= MAX_ATTEMPTS || record.deliveryStatus === "attention") {
          tx.update(ref, { deliveryStatus: "attention", updatedAtMillis: current });
          return { attention: true };
        }
        if (record.nextAttemptAtMillis > current) {
          return { waitSeconds: Math.max(1, Math.ceil((record.nextAttemptAtMillis - current) / 1000)) };
        }
      } else {
        checkNewDate(request.appointmentDate, current);
        const rateSnapshot = await tx.get(rateRef), previous = rateSnapshot.data();
        if (rateSnapshot.exists && (!Number.isSafeInteger(previous?.windowStartMillis) || !Number.isSafeInteger(previous?.count) || previous.count < 0 || previous.windowStartMillis > current)) throw unavailable();
        const inWindow = rateSnapshot.exists && current - previous.windowStartMillis < RATE_WINDOW_MS;
        const count = inWindow ? previous.count : 0;
        if (count >= RATE_LIMIT) throw new BookingError(429, "rate_limited", "Too many requests. Please try again in a few minutes or email dylank@posetek.net.", Math.ceil((previous.windowStartMillis + RATE_WINDOW_MS - current) / 1000));
        const windowStartMillis = inWindow ? previous.windowStartMillis : current;
        tx.set(rateRef, { count: count + 1, windowStartMillis, expiresAtMillis: windowStartMillis + RATE_WINDOW_MS });
        record = { schemaVersion: 1, requestId: request.requestId, request, fingerprint, emailPayload: emailFor(request),
          createdAtMillis: current, firstAttemptAtMillis: current, attempts: 0 };
      }
      const next = { ...record, deliveryStatus: "sending", attempts: record.attempts + 1, updatedAtMillis: current,
        leaseToken, leaseUntilMillis: current + LEASE_MS, nextAttemptAtMillis: 0 };
      tx.set(ref, next);
      return { payload: next.emailPayload };
    });
    if (claim.accepted) return { requestId: request.requestId, status: "received" };
    if (claim.attention) throw unavailable(0);
    if (claim.waitSeconds) throw unavailable(claim.waitSeconds);
    let accepted;
    try {
      accepted = await provider.send(claim.payload, "performance-test-booking/" + request.requestId);
      if (typeof accepted?.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accepted.id)) throw new Error("Unconfirmed provider response");
    } catch (error) {
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref), record = snapshot.data();
        if (record?.leaseToken !== leaseToken || record.deliveryStatus !== "sending") return;
        const delay = Math.max(30000, Math.min(Number(error?.retryAfterMs) || 0, 3600000));
        const code = typeof error?.code === "string" && /^provider_[a-z0-9_]{1,50}$/.test(error.code) ? error.code : "provider_uncertain";
        tx.update(ref, { deliveryStatus: error?.permanent ? "attention" : "pending", lastFailureCode: code,
          updatedAtMillis: now(), leaseUntilMillis: 0, nextAttemptAtMillis: now() + delay });
      });
      throw unavailable(Math.max(30, Math.min(Math.ceil((Number(error?.retryAfterMs) || 0) / 1000), 3600)));
    }
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref), record = snapshot.data();
      if (record?.leaseToken !== leaseToken || record.deliveryStatus !== "sending") throw unavailable();
      tx.update(ref, { deliveryStatus: "accepted", providerMessageId: accepted.id, acceptedAtMillis: now(), updatedAtMillis: now(), leaseUntilMillis: 0, nextAttemptAtMillis: 0 });
    });
    return { requestId: request.requestId, status: "received" };
  }

  async function handler(req, res) {
    res.set("Cache-Control", "no-store"); res.set("Vary", "Origin");
    const origin = req.headers?.origin;
    if (typeof origin !== "string" || !ORIGINS.has(origin)) {
      res.status(403).json({ error: { code: "origin_not_allowed", message: "Submit your request from posetek.net." } }); return;
    }
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS"); res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.set("Allow", "POST, OPTIONS"); res.status(405).json({ error: { code: "method_not_allowed", message: "Use the booking request form." } }); return; }
    let requestId;
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.["content-type"] || "")) throw new BookingError(415, "invalid_content_type", "Use the booking request form.");
      if ((req.rawBody && req.rawBody.length > 8192) || Buffer.byteLength(JSON.stringify(req.body) || "") > 8192) throw new BookingError(413, "request_too_large", "Shorten your request and try again.");
      requestId = typeof req.body?.requestId === "string" && UUID.test(req.body.requestId) ? req.body.requestId.toLowerCase() : undefined;
      const result = await submit(req.body, req);
      res.status(200).json(result);
    } catch (error) {
      const safe = error instanceof BookingError ? error : unavailable();
      if (safe.retryAfterSeconds) res.set("Retry-After", String(safe.retryAfterSeconds));
      res.status(safe.status).json({ error: { code: safe.code, message: safe.message }, ...(requestId ? { requestId } : {}),
        ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) });
    }
  }
  return { submit, handler };
}

module.exports = { createPerformanceTestBooking, validateBooking, emailFor, BookingError, TIMEZONE, REQUESTS, LIMITS, LEASE_MS, RETRY_WINDOW_MS, RATE_WINDOW_MS, RATE_LIMIT, MAX_ATTEMPTS };
