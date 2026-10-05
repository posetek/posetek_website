"use strict";

const crypto = require("node:crypto");
const { isIP } = require("node:net");
const { isClubAdmin } = require("./club-access");

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const SESSION_LIMIT = 60;
const COLLECTIONS = Object.freeze({ responses: "appFeedbackResponsesV1", sessions: "appFeedbackSessionsV1", limits: "appFeedbackRateLimitsV1" });
const SOURCES = ["workout", "results", "qr", "message", "direct"];
const EVENTS = ["opened", "started", "submitted"];
const FEATURES = [null, "results", "workouts", "aiCoach", "videosTechnique", "other", "notUsed"];
const EASE = [null, "veryHard", "hard", "inBetween", "easy", "veryEasy", "notSure"];
const OBSTRUCTIONS = [null, "none", "find", "understand", "broken", "other"];

class FeedbackError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new FeedbackError(status, code, message); };
const invalid = () => fail(400, "invalid-request", "Check your answers and try again.");
const unavailable = () => fail(503, "unavailable", "Feedback could not be saved. Please try again.");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keysWithin = (value, fields) => Object.keys(value).every(key => fields.includes(key));
const millis = value => value?.toMillis?.();

function validateFeedback(input) {
  if (!object(input) || !keysWithin(input, ["formVersion", "event", "sessionId", "entrySource", "answers", "durationSeconds"]) || input.formVersion !== 1
    || !EVENTS.includes(input.event) || !SOURCES.includes(input.entrySource)
    || typeof input.sessionId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.sessionId)) invalid();
  const result = { formVersion: 1, event: input.event, sessionId: input.sessionId.toLowerCase(), entrySource: input.entrySource };
  if (input.event !== "submitted") {
    if ("answers" in input || "durationSeconds" in input) invalid();
    return result;
  }
  const answers = input.answers;
  if (!object(answers) || Object.keys(answers).length !== 4 || !keysWithin(answers, ["feature", "ease", "obstruction", "comment"])
    || !FEATURES.includes(answers.feature) || !EASE.includes(answers.ease) || !OBSTRUCTIONS.includes(answers.obstruction)
    || typeof answers.comment !== "string" || answers.comment.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answers.comment)
    || (answers.feature === "notUsed" && (answers.ease !== null || answers.obstruction !== null))) invalid();
  result.answers = { feature: answers.feature, ease: answers.ease, obstruction: answers.obstruction, comment: answers.comment.trim() };
  if ("durationSeconds" in input) {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 0 || input.durationSeconds > 86400) invalid();
    result.durationSeconds = input.durationSeconds;
  }
  return result;
}

function allowedFeedbackOrigin(origin) {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return false;
    if (["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    if (url.protocol !== "https:" || url.port) return false;
    return ["posetek.net", "www.posetek.net", "posetek.netlify.app"].includes(url.hostname)
      || /^(?:[a-f0-9]{24}|deploy-preview-[0-9]+|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)--posetek\.netlify\.app$/.test(url.hostname);
  } catch { return false; }
}

function normalizedIp(rawRequest) {
  let ip = rawRequest?.ip;
  if (typeof ip !== "string" || ip.length > 64 || !isIP(ip)) unavailable();
  ip = ip.toLowerCase();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  // Normalize alternate IPv6 spellings to one network quota key.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
}

function createAppFeedback({ db, Timestamp, rateKey, now = () => Date.now() }) {
  return async function receive(input, rawRequest) {
    const data = validateFeedback(input);
    const time = now(), secret = typeof rateKey === "function" ? rateKey() : rateKey;
    if (!Number.isSafeInteger(time) || time < 0 || typeof secret !== "string" || secret.length < 32) unavailable();
    const ip = normalizedIp(rawRequest);
    const windowStartMillis = Math.floor(time / WINDOW_MS) * WINDOW_MS;
    const key = crypto.createHmac("sha256", secret).update(`${windowStartMillis}\n${ip}`).digest("hex");
    const limitRef = db.collection(COLLECTIONS.limits).doc(key);
    const sessionRef = db.collection(COLLECTIONS.sessions).doc(data.sessionId);
    const responseRef = db.collection(COLLECTIONS.responses).doc(data.sessionId);
    return db.runTransaction(async tx => {
      const sessionSnapshot = await tx.get(sessionRef);
      const previous = sessionSnapshot.data();
      const responseSnapshot = data.event === "submitted" ? await tx.get(responseRef) : null;
      const quotaSnapshot = !sessionSnapshot.exists ? await tx.get(limitRef) : null;
      if (sessionSnapshot.exists) {
        if (previous?.formVersion !== data.formVersion || previous?.entrySource !== data.entrySource || !Number.isSafeInteger(millis(previous.expiresAt))) unavailable();
        if (millis(previous.expiresAt) <= time) fail(410, "session-expired", "This feedback session expired. Open the form again.");
      }
      if (responseSnapshot?.exists) {
        const saved = responseSnapshot.data();
        if (!object(saved.answers) || !["feature", "ease", "obstruction", "comment"].every(field => saved.answers[field] === data.answers[field]) || saved.durationSeconds !== data.durationSeconds) {
          fail(409, "already-submitted", "This feedback was already saved. Open a new form to send another response.");
        }
        return { accepted: true, event: data.event, duplicate: true, submitted: true };
      }
      const eventField = `${data.event === "submitted" ? "submitted" : data.event === "opened" ? "opened" : "started"}At`;
      if (previous?.[eventField]) return { accepted: true, event: data.event, duplicate: true, submitted: Boolean(previous.submittedAt) };
      if (quotaSnapshot) {
        const quota = quotaSnapshot.data();
        if (quotaSnapshot.exists && (quota?.windowStartMillis !== windowStartMillis || !Number.isSafeInteger(quota?.count) || quota.count < 0 || quota.count > SESSION_LIMIT)) unavailable();
        const count = quotaSnapshot.exists ? quota.count : 0;
        if (count >= SESSION_LIMIT) fail(429, "too-many-requests", "Please wait a few minutes before opening another feedback form.");
        tx.set(limitRef, { count: count + 1, windowStartMillis, expiresAt: Timestamp.fromMillis(windowStartMillis + 2 * WINDOW_MS) });
      }
      const stamp = Timestamp.fromMillis(time);
      const expiresAt = previous?.expiresAt || Timestamp.fromMillis(time + RETENTION_MS);
      tx.set(sessionRef, { formVersion: 1, entrySource: data.entrySource, createdAt: previous?.createdAt || stamp, updatedAt: stamp, expiresAt,
        opened: previous?.opened === true || data.event === "opened", started: previous?.started === true || data.event === "started", submitted: previous?.submitted === true || data.event === "submitted", [eventField]: stamp }, { merge: true });
      if (data.event === "submitted") tx.create(responseRef, { formVersion: 1, entrySource: data.entrySource, answers: data.answers, createdAt: stamp, submittedAt: stamp, expiresAt: Timestamp.fromMillis(time + RETENTION_MS),
        ...(data.durationSeconds !== undefined ? { durationSeconds: data.durationSeconds } : {}) });
      return { accepted: true, event: data.event, duplicate: false, submitted: data.event === "submitted" || Boolean(previous?.submittedAt) };
    });
  };
}

function createAppFeedbackAdmin({ db, Timestamp, HttpsError, now = () => Date.now() }) {
  return async function list(input, auth) {
    if (!isClubAdmin(auth)) throw new HttpsError("permission-denied", "PoseTek administrator access is required.");
    if (!object(input) || !keysWithin(input, ["cursor"])) throw new HttpsError("invalid-argument", "Choose a valid feedback page.");
    const cursor = input.cursor;
    if (cursor !== undefined && (!object(cursor) || Object.keys(cursor).length !== 2 || !keysWithin(cursor, ["at", "id"])
      || !Number.isSafeInteger(cursor.at) || cursor.at < 0 || typeof cursor.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(cursor.id))) {
      throw new HttpsError("invalid-argument", "Choose a valid feedback page.");
    }
    const cutoff = Timestamp.fromMillis(Math.max(0, now() - RETENTION_MS));
    let query = db.collection(COLLECTIONS.responses).where("createdAt", ">=", cutoff).orderBy("createdAt", "desc").orderBy("__name__", "desc");
    if (cursor) query = query.startAfter(Timestamp.fromMillis(cursor.at), cursor.id);
    const sessionQuery = db.collection(COLLECTIONS.sessions).where("createdAt", ">=", cutoff);
    const [page, ...counts] = await Promise.all([query.limit(51).get(), ...["opened", "started", "submitted"].map(field => sessionQuery.where(field, "==", true).count().get())]);
    const rows = page.docs.slice(0, 50), last = rows.at(-1);
    return {
      responses: rows.map(doc => { const row = doc.data(); return { id: doc.id, formVersion: row.formVersion, entrySource: row.entrySource, answers: row.answers,
        createdAtMillis: millis(row.createdAt), ...(row.durationSeconds !== undefined ? { durationSeconds: row.durationSeconds } : {}) }; }),
      nextCursor: page.docs.length > 50 ? { at: millis(last.data().createdAt), id: last.id } : null,
      metrics: Object.fromEntries(["opened", "started", "submitted"].map((field, index) => [field, counts[index].data().count])), retentionDays: 90,
    };
  };
}

function createAppFeedbackHttp(dependencies) {
  const receive = createAppFeedback(dependencies);
  return async function handler(req, res) {
    const origin = req.get?.("origin") || req.headers?.origin || "";
    res.set("Cache-Control", "no-store");
    res.set("Vary", "Origin");
    res.set("X-Content-Type-Options", "nosniff");
    if (!allowedFeedbackOrigin(origin)) return res.status(403).json({ error: { code: "origin-not-allowed", message: "Open the feedback form on PoseTek." } });
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: { code: "method-not-allowed", message: "Use the feedback form to submit a response." } });
    const contentType = req.get?.("content-type") || req.headers?.["content-type"] || "";
    if (!/^application\/json(?:\s*;.*)?$/i.test(contentType)) return res.status(415).json({ error: { code: "content-type", message: "Use the feedback form to submit a response." } });
    if (req.rawBody?.length > 8192) return res.status(413).json({ error: { code: "request-too-large", message: "Keep your feedback short and try again." } });
    try { return res.status(200).json(await receive(req.body, req)); }
    catch (error) {
      // Never log a request, comment, address, auth context or arbitrary SDK error.
      const known = error instanceof FeedbackError;
      return res.status(known ? error.status : 503).json({ error: { code: known ? error.code : "unavailable", message: known ? error.message : "Feedback could not be saved. Please try again." } });
    }
  };
}

module.exports = { createAppFeedback, createAppFeedbackHttp, createAppFeedbackAdmin, validateFeedback, allowedFeedbackOrigin, COLLECTIONS, RETENTION_MS, WINDOW_MS, SESSION_LIMIT };
