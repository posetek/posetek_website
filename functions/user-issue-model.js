"use strict";
const crypto = require("node:crypto");
const { validContact, contactText, UID } = require("./user-issue-contacts");
const FROM = "PoseTek Support <support@alerts.posetek.net>";
const TO = "dylank@posetek.net";
const RECIPIENTS = Object.freeze([TO]);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value, max = 200) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "";
function redact(value, max = 2000) {
  return clean(value, max).replace(/(?:Bearer\s+\S+|\b(?:re_|whsec_)[A-Za-z0-9_+/=-]{12,})/gi, "[credential]")
    .replace(/([?&](?:token|key|code|password|secret|signature|access_token)=)[^\s&]*/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
}
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KINDS = ["crash", "error", "report", "interrupted", "diagnostic"];
const STATES = ["new", "investigating", "fixed", "verified", "dismissed"];
function setting(doc, at) {
  const pilot = doc?.testUids;
  const valid = pilot === undefined || Array.isArray(pilot) && pilot.length > 0 && pilot.length <= 50 && pilot.every(v => typeof v === "string" && ID.test(v));
  return { ...doc, enabled: doc?.enabled === true && valid && Number.isSafeInteger(doc.activatedAtMillis) && doc.activatedAtMillis > 0 && doc.activatedAtMillis <= at };
}
function screenshot(value) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 240000) throw new Error("Choose an image smaller than 175 KB.");
  const match = value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("Only PNG and JPEG screenshots are supported.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 175000 || (match[1] === "png" ? !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) throw new Error("Invalid screenshot.");
  return value;
}
function normalize(data, at, trusted = false) {
  if (!data || typeof data !== "object" || !ID.test(data.eventId || "") || !ID.test(data.sessionId || "")) throw new Error("A stable event and session reference are required.");
  const kind = trusted && KINDS.includes(data.kind) ? data.kind : data.kind === "report" ? "report" : "error";
  const operation = redact(data.operation, 100).replace(/[^a-zA-Z0-9_.:/ -]/g, "") || "application";
  const code = redact(data.code, 100).replace(/[^a-zA-Z0-9_.:/ -]/g, "") || "unknown";
  const platform = ["web", "ios", "backend"].includes(data.platform) ? data.platform : "web";
  const occurredAtMillis = Number.isSafeInteger(data.occurredAtMillis) && data.occurredAtMillis > 0 && data.occurredAtMillis <= at + 60000 ? data.occurredAtMillis : at;
  const report = kind === "report" ? redact(data.description, 4000) : "";
  if (kind === "report" && report.length < 5) throw new Error("Describe what went wrong in at least five characters.");
  return { eventId: data.eventId, sessionId: data.sessionId, kind, operation, code, platform, occurredAtMillis,
    build: redact(data.build, 80) || "unknown", device: redact(data.device, 180) || "unknown", description: report,
    message: redact(data.message), route: clean(data.route, 200).split(/[?#]/)[0],
    requestId: ID.test(data.requestId || "") ? data.requestId : null,
    screenshot: kind === "report" ? screenshot(data.screenshot) : null,
    severity: kind === "crash" ? "critical" : kind === "report" ? "reported" : kind === "diagnostic" ? "diagnostic" : "error" };
}
// Reporting periods start at 09:00 Pacific, including across DST changes.
function periodKey(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < 9 ? new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : date;
}
function previousPeriod(at) { return new Date(Date.parse(`${periodKey(at)}T12:00:00Z`) - 86400000).toISOString().slice(0, 10); }
function periodBounds(period) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || new Date(`${period}T12:00:00Z`).toISOString().slice(0, 10) !== period) throw new Error("Invalid reporting period.");
  // At 9 AM Pacific the DST transition, if any, has already happened. Derive
  // each endpoint separately so the reporting day can contain 23 or 25 hours.
  const start = date => {
    const probe = Date.parse(`${date}T17:00:00Z`);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(probe));
    return probe + (9 - hour) * 3600000;
  };
  const next = new Date(Date.parse(`${period}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { lower: start(period), upper: start(next) };
}
const dateText = at => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "long" }).format(at);
function payload(job, id) {
  const snapshot = job.type === "incident" && job.contactSnapshot?.schemaVersion === 1 ? job.contactSnapshot : null;
  const uid = UID.test(snapshot?.actorUid || "") ? snapshot.actorUid : null;
  const contact = validContact(snapshot?.currentContact, uid) ? snapshot.currentContact : null;
  const lookupFailed = snapshot?.lookup?.status === "failed";
  const account = contact?.name || (snapshot?.authenticatedSnapshot?.uid === uid ? snapshot.authenticatedSnapshot.name : null) || (uid ? "Name unavailable" : "Unknown actor");
  const identityLines = snapshot ? [`Account/reporter: ${redact(account, 200)}${uid ? ` (${uid})` : ""}${lookupFailed && contact ? "; name from the last successful lookup; current account details unconfirmed" : ""}${snapshot.reporterOnly ? "; reporter/uploader only; original operator unconfirmed" : ""}`,
    // Only the strict, exact-UID server-owned Auth email bypasses free-text
    // redaction. Description/message/display-name strings remain redacted.
    `Contact email: ${lookupFailed ? `Unavailable as a current contact; latest exact-UID lookup failed (${snapshot.lookup.code === "account_not_found" ? "account_not_found" : "lookup_unavailable"}).${contact ? ` Last successful lookup evidence: ${contactText(contact, uid)}; current currency unconfirmed` : ""}` : contactText(contact, uid)}`,
    `Target athlete: ${redact(snapshot.player?.name, 200) || "Unknown / not recorded"}${ID.test(snapshot.player?.id || "") ? ` (${snapshot.player.id})` : ""}`,
    `Attempted action: ${redact(snapshot.operation, 100) || "Unknown / not recorded"}`] : [];
  const legacyLines = snapshot ? job.lines.filter(line => !/^Affected user:/i.test(line)) : job.lines;
  const lines = [job.title, ...identityLines, ...legacyLines, "Detailed reports and screenshots require PoseTek administrator sign-in.", `Open User issues: https://posetek.net/admin/user-issues${job.issueId ? `?issue=${job.issueId}` : ""}`];
  return { from: FROM, to: [...RECIPIENTS], subject: `[PoseTek ${job.type === "daily" ? "daily summary" : "user issue"}] ${clean(job.title, 130)}`,
    text: lines.join("\n\n"), tags: [{ name: "posetek_issue_outbox", value: id }] };
}
module.exports = { FROM, TO, RECIPIENTS, ID, STATES, hash, clean, redact, setting, normalize, screenshot, periodKey, previousPeriod, periodBounds, dateText, payload };
