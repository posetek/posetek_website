"use strict";

// Pure adapter: no Firestore, Outlook, clock, credentials, or workbook writes.
// The caller must persist nextSeed ONLY after the workbook confirms the batch.
// Bootstrap existing keys/hashes from the cloud workbook before enabling writes.
const crypto = require("node:crypto");
const Microsoft = require("./microsoft-email-model");
const { validContact, contactText, email, UID } = require("./user-issue-contacts");
const { ID } = require("./user-issue-model");
const MailIdentity = require("./issue-tracker-mail-identity");
const OccurrenceClassification = require("./user-issue-classification");
const { powerAutomateWarning } = require("./issue-tracker-mail-classification");

const HEADERS = Object.freeze({
  actions: ["Action ID", "Priority", "Problem", "Who / impact", "Recommended next step", "Observed evidence / limits", "Retest and safe recovery", "Code / evidence", "Provider reference"],
  instances: ["Instance", "Occurred (Pacific)", "User who acted / reported", "Target athlete", "Attempted action", "Error / actual evidence", "Action ID", "Email delivery", "Recorded operation", "Identity basis", "Recorded actor UID", "Target player ID", "Page / device", "Received (Pacific)", "Email IDs", "Correlation / limits", "Private issue", "Source record", "Build", "Request / job ID", "Occurrence ID", "Provider email ID", "Delivery error code"],
  emails: ["Email", "Received (Pacific)", "Message type", "Function / operation", "Linked instance", "Action ID", "Original affected-user label", "Message / linked diagnosis", "Outlook source", "Issue / service incident", "Monitoring incident ID", "Original subject", "Outlook message ID"],
  dailyRows: ["Reporting day", "Job created (Pacific)", "Delivery", "Provider code", "Job reference"],
});
const LINK_HEADERS = Object.freeze({ actions: ["Code / evidence", "Provider reference"], instances: ["Private issue"], emails: ["Outlook source", "Issue / service incident"], dailyRows: [] });
const KEY_HEADERS = Object.freeze({ actions: "Action ID", instances: "Occurrence ID", emails: "Outlook message ID", dailyRows: "Job reference" });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = value => value == null ? "" : String(value);
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const machineRowSha256 = row => sha256(canonicalJson({ values: row.values, links: row.links }));
const clone = value => JSON.parse(JSON.stringify(value));
const dictionary = value => Object.assign(Object.create(null), value || {});
function annotate(value, label, note) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text(value).replace(new RegExp(`\\n\\n\\[${escaped}\\]\\n[^]*?(?=\\n\\n\\[[^\\n]+\\]\\n|$)`, "g"), "") + (note ? `\n\n[${label}]\n${note}` : "");
}
function observationAnnotation(event) {
  const summary = event.sourceObservationSummary;
  if (summary == null) return "";
  if (summary.schemaVersion !== 1 || !Number.isSafeInteger(summary.count) || summary.count < 1 || !Array.isArray(summary.evidence) || summary.evidence.length < 1 || summary.evidence.length > 16 || summary.count < summary.evidence.length || summary.truncated !== (summary.count > summary.evidence.length)) fail("invalid server source-observation summary");
  const fields = ["source", "sourceReference", "eventId", "requestId", "actorUid", "kind", "operation", "code", "platform", "build", "device", "route"];
  const lines = summary.evidence.map(item => {
    if (!["historical_canonical", "source_observation"].includes(item.evidenceType) || fields.some(field => item[field] != null && (typeof item[field] !== "string" || item[field].length > 300 || /[\u0000-\u001f]/.test(item[field]))) || item.actorUid !== (event.reporterUid || null) || item.requestId !== (event.requestId || null) || !Array.isArray(item.conflictsWithCanonical) || !Array.isArray(item.additionalContext) || [...item.conflictsWithCanonical, ...item.additionalContext].some(value => !["target_athlete", "attempted_action"].includes(value)) || item.player && (typeof item.player.id !== "string" || !ID.test(item.player.id) || item.player.name != null && (typeof item.player.name !== "string" || item.player.name.length > 200))) fail("invalid server source-observation evidence");
    if (item.callableOutcome && !OccurrenceClassification.validCallableOutcome(item.callableOutcome, item)) fail("invalid server callable-outcome evidence");
    return `${item.evidenceType}: ${item.source || "unknown source"}; source reference ${item.sourceReference || "unavailable"}; event ${item.eventId || "unavailable"}; exact account UID ${item.actorUid || "unknown"}; request ${item.requestId || "unavailable"}; action ${item.operation || "unknown"}; target ${item.player ? `${item.player.name || "name unavailable"} (${item.player.id})` : "not recorded"}; device ${item.platform || "unknown"} / ${item.device || "unknown"}; build ${item.build || "unknown"}; route ${item.route || "unknown"}${item.callableOutcome ? `; verified failed callable request (${item.callableOutcome.errorCategory})` : ""}${item.conflictsWithCanonical.length ? `; conflicting evidence: ${item.conflictsWithCanonical.join(", ")}` : ""}${item.additionalContext.length ? `; additional verified context: ${item.additionalContext.join(", ")}` : ""}.`;
  });
  const knownAccount = typeof event.reporterUid === "string" && UID.test(event.reporterUid);
  const knownRequest = typeof event.requestId === "string" && ID.test(event.requestId);
  const relationship = summary.count === 1
    ? "One retained original source observation; no additional source corroboration is claimed. " + (knownAccount ? "A recorded account UID is available; it is separate from the target athlete." : "No authenticated account is recorded; the original operator remains unverified.")
    : knownAccount && knownRequest
      ? `${summary.count} retained source observations corroborate the same authenticated request.`
      : knownRequest
        ? `${summary.count} retained source observations are associated with the recorded request reference; the original operator remains unverified.`
        : `${summary.count} retained source observations. No valid exact request reference is recorded; the original operator remains unverified.`;
  return `${relationship} Original canonical actor, target, action, source IDs and history are preserved. ${summary.truncated ? "Only the first and latest observations are displayed; the complete immutable observations remain in private backend evidence. " : ""}These are source observations, not additional attempts or affected users.\n${lines.join("\n")}`;
}
function fail(message) { throw new Error(`Issue tracker normalization: ${message}`); }
function key(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\u0000-\u001f]/.test(value)) fail(`invalid ${label}`);
  return value;
}
function indexDocs(docs, label) {
  if (!Array.isArray(docs)) fail(`${label} must be an array`);
  const result = new Map();
  for (let doc of docs) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(`invalid ${label} document`);
    if (doc.data && typeof doc.data === "object" && Object.keys(doc).every(k => ["id", "data"].includes(k))) doc = { ...doc.data, id: doc.id };
    const id = key(doc.id, `${label} id`);
    if (result.has(id) && canonicalJson(result.get(id)) !== canonicalJson(doc)) fail(`conflicting ${label} documents for the same id`);
    result.set(id, doc);
  }
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b, "en")));
}
function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)) {
    const ms = Date.parse(value); if (Number.isFinite(ms)) return ms;
  }
  return null;
}
const pacific = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function pacificExcelSerial(value) {
  const ms = timestamp(value); if (ms == null) return "";
  const parts = Object.fromEntries(pacific.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return Number((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second, ((ms % 1000) + 1000) % 1000) / 86400000 + 25569).toPrecision(15));
}
function httpsUrl(value) {
  if (!value) return "";
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
function displayExcerpt(value, sourceUrl, limit = 12000) {
  const content = text(value);
  if (content.length <= limit) return content;
  if (!sourceUrl) fail("long email evidence needs an original message link before display can be shortened");
  return `${content.slice(0, limit)}\n[Display excerpt shortened; full original message remains available via Outlook source: ${sourceUrl}]`;
}
const issueUrl = id => id ? `https://posetek.net/admin/user-issues?issue=${encodeURIComponent(id)}` : "";

// Match only evidenced, specific signatures. An operation/fingerprint/HTTP code
// alone never asserts the cause or combines otherwise unidentified attempts.
function classifyOccurrence(event) {
  const evidence = [event.message, event.description].filter(Boolean).join("\n");
  const lower = evidence.toLowerCase();
  const pattern = (signature, problem, next, limits) => ({ signature, priority: "P2", problem, next, limits, verify: "Reproduce the recorded operation after the proposed change; confirm the expected result and absence of the same error. Do not close from notification silence." });
  if (/projectiondirty/i.test(evidence) && /\bpending\b/i.test(evidence) && /(?:failed_precondition|requires an index|index.*(?:missing|not ready))/i.test(`${event.code} ${evidence}`)) {
    return pattern("firestore:projectionDirty:pending:missing-index", "Projection sweep requires a Firestore index", "Verify the COLLECTION_GROUP ASCENDING index on projectionDirty.pending is READY, then retest sweepTestingEventFinalizations and confirm the pending projections finalize. Preserve the query guard and original failure evidence.", "The error identifies this collection-group index requirement. It does not establish which completed player results were blocked or prove that the index is currently ready.");
  }
  if (lower.includes("player data changed during the rebuild. retry to refresh the report.")) {
    return pattern("insights:player-data-changed-during-rebuild", "Insights rebuild concurrency guard", "Inspect source-change and rebuild execution evidence, then retry a stable snapshot. Investigate repeated guard failures before changing the guard.", "These are guard log records, not unique affected users. Logs alone do not establish why the source changed.");
  }
  if (/view function for ['"]handle_video['"] did not return a valid response/i.test(evidence)) {
    return pattern("video:handle_video:invalid-flask-return", "Video handler did not return a valid response", "Inspect the handle_video exception and return paths; ensure every path returns a valid response, then replay a safe test capture.", "The invalid-return traceback is specific. A separate HTTP 500 without that traceback must remain a different triage item.");
  }
  if (/authoritativeEvidence contains an invalid nested entity/i.test(evidence)) {
    return pattern("planner:authoritativeEvidence:invalid-nested-entity", "Planner output contains an invalid nested entity", "Inspect the authoritativeEvidence shape against the persistence schema and validate a corrected synthetic plan before retrying the affected request.", "This signature does not establish the cause of other planner validation or request failures.");
  }
  // Missing metadata is an observed missing object, not a proven reason for it.
  const missing = evidence.match(/No such object:\s*([^\r\n]+\/metadata\.json)\b/i);
  if (missing) return pattern(`storage:missing-metadata:${sha256(missing[1])}`, "Capture metadata object is missing", "Inspect the exact object's upload, retention, and processing history. Recover or regenerate only when the source capture and intended behavior are verified.", "The object is missing; these records do not establish whether upload, deletion, or a race caused it.");
  return { signature: `needs-triage:occurrence:${event.id}`, priority: "P2", problem: "Needs triage: recorded error or diagnostic", next: "Inspect this exact source record and request trace, confirm what the user attempted and the failure cause, then propose a fix supported by that evidence.", limits: "The stored occurrence does not establish a specific known cause. Shared issue IDs, operation names, nearby times, and generic HTTP failures are not proof of the same failure.", verify: "Record a confirmed cause and a safe reproduction before choosing a fix. A diagnostic or interrupted-session label alone is not proof of a crash." };
}

function prepareSeed(input) {
  const seed = clone(input || {});
  if (seed.schemaVersion != null && seed.schemaVersion !== 1) fail("unsupported seed schemaVersion");
  seed.schemaVersion = 1;
  seed.counters ||= {};
  seed.actionMappings = dictionary(seed.actionMappings);
  seed.rows = dictionary(seed.rows);
  seed.emailAliases = dictionary(seed.emailAliases);
  if (seed.emailCanonicalItems) seed.emailCanonicalItems = dictionary(seed.emailCanonicalItems);
  if (seed.emailCanonicalAliases) seed.emailCanonicalAliases = dictionary(seed.emailCanonicalAliases);
  const retained = new Set();
  for (const [groupKey, group] of Object.entries(seed.emailCanonicalItems || {})) {
    if (!seed.mailbox || groupKey !== sha256(canonicalJson([seed.mailbox, group?.canonicalId])) || !group || Object.keys(group).sort().join() !== "canonicalId,evidenceRef,primaryId,proofSha256,retainedIds" || !Array.isArray(group.retainedIds) || group.retainedIds.length < 2 || group.retainedIds.length > 20 || new Set(group.retainedIds).size !== group.retainedIds.length || !group.retainedIds.includes(group.primaryId) || !/^[a-f0-9]{64}$/.test(group.proofSha256 || "") || !/^[a-f0-9]{64}$/.test(group.evidenceRef || "")) fail("invalid verified Outlook group seed");
    key(group.canonicalId, "canonical Outlook id");
    for (const id of group.retainedIds) { key(id, "retained Outlook id"); if (retained.has(id)) fail("retained Outlook row belongs to multiple groups"); retained.add(id); }
  }
  for (const [alias, groupKey] of Object.entries(seed.emailCanonicalAliases || {})) if (!/^[a-f0-9]{64}$/.test(alias) || !own(seed.emailCanonicalItems || {}, groupKey)) fail("verified Outlook alias seed has no group");
  seed.emailLinks = dictionary(seed.emailLinks);
  seed.providerOccurrences = dictionary(seed.providerOccurrences);
  seed.outboxOccurrences = dictionary(seed.outboxOccurrences);
  for (const table of Object.keys(HEADERS)) {
    seed.rows[table] = dictionary(seed.rows[table]);
    for (const [id, row] of Object.entries(seed.rows[table])) {
      key(id, "seed row key");
      if (!row || !/^[a-f0-9]{64}$/.test(row.hash || "")) fail(`seed ${table} row requires a verified machine hash`);
      if (table === "actions" && id !== row.rowId) fail("seed action id does not match rowId");
      {
        if (!row.values || !row.links) fail(`seed ${table} row requires its full reviewed machine snapshot`);
        if (machineRowSha256(row) !== row.hash) fail("seed machine snapshot does not match its verified hash");
        if (row.values[KEY_HEADERS[table]] !== id || Object.keys(row.values).length !== HEADERS[table].length || HEADERS[table].some(h => !own(row.values, h))) fail("seed machine snapshot has invalid keys/columns");
        if (["instances", "emails"].includes(table) && row.values["Action ID"] !== row.actionId) fail("seed action mapping disagrees with the reviewed row");
        if (table === "instances" && row.values.Instance !== row.rowId || table === "emails" && row.values.Email !== row.rowId) fail("seed rowId disagrees with the reviewed row");
      }
    }
  }
  for (const [counter, table, prefix] of [["action", "actions", "A"], ["instance", "instances", "EV-"], ["email", "emails", "EM-"]]) {
    let highest = 0;
    const allocated = new Set();
    for (const row of Object.values(seed.rows[table])) {
      const match = text(row.rowId).match(new RegExp(`^${prefix}(\\d+)$`));
      if (!match || allocated.has(row.rowId)) fail(`invalid or duplicate seeded ${counter} rowId`);
      allocated.add(row.rowId); highest = Math.max(highest, +match[1]);
    }
    const value = seed.counters[counter] ?? highest;
    if (!Number.isSafeInteger(value) || value < highest || value < 0) fail(`invalid ${counter} counter`);
    seed.counters[counter] = value;
  }
  for (const id of Object.values(seed.actionMappings)) if (!own(seed.rows.actions, id)) fail("action mapping points to an unseeded action");
  for (const table of ["instances", "emails"]) for (const row of Object.values(seed.rows[table])) {
    if (!own(seed.rows.actions, row.actionId)) fail(`seed ${table} action is missing`);
  }
  return seed;
}
function identity(event, identities) {
  const uid = text(event.reporterUid);
  const exact = uid && identities && own(identities, uid) ? identities[uid] : null;
  if (exact?.uid && exact.uid !== uid) fail("identity lookup UID mismatch");
  const contact = validContact(event.currentContact, uid) ? event.currentContact : null;
  if (event.currentContact && event.currentContact.uid !== uid) fail("contact lookup UID mismatch");
  const name = text(contact?.name || event.reporterName || exact?.name);
  const isReport = /failureCases|fieldReports|system_diagnostic/i.test(`${event.source} ${event.sourceReference} ${event.code}`);
  const label = name || (uid ? `Account ${uid}` : "Unknown account");
  const actor = uid ? `${isReport ? "Reported/uploaded by" : "Recorded account"}: ${label}${isReport ? "; original operator unconfirmed" : ""}` : "Unknown actor (no authenticated reporter recorded)";
  const player = event.player && typeof event.player === "object" ? event.player : {};
  const snapshot = event.authenticatedSnapshot;
  const token = snapshot?.schemaVersion === 1 && snapshot.uid === uid && snapshot.source === "authenticated_token" && Number.isSafeInteger(snapshot.observedAtMillis) ? snapshot : null;
  const lookupFailed = event.contactLookup?.status === "failed";
  const contactEvidence = contactText(contact, uid).replace("current Auth lookup", "Auth lookup observed");
  const contactAnnotation = uid && (contact || event.contactLookup) ? `Recorded actor UID: ${uid}. ${contact?.name ? `${lookupFailed ? "Last successful" : "Recorded"} Auth account display name: ${contact.name}. ` : ""}Contact email: ${lookupFailed ? `Unavailable as a current contact.${contact ? ` Last successful lookup evidence: ${contactEvidence}.` : ""}` : contactEvidence + "."}${contact?.disabled ? " Auth account was disabled at that lookup." : ""}${lookupFailed ? ` Latest lookup failed (${text(event.contactLookup.code) || "lookup_unavailable"}); any retained contact is from the earlier lookup, currency unconfirmed.` : ""}${isReport ? " This contact belongs to the reporter/uploader; original operator remains unconfirmed." : ""}` : "";
  const snapshotBasis = token ? ` Authenticated occurrence-token snapshot: ${email(token.email) || "no email"} (email ${token.emailVerified === true ? "verified" : "unverified"}); captured ${new Date(token.observedAtMillis).toISOString()}. This is separate from the current outreach lookup.` : "";
  return { actor, target: player.name ? `${player.name}${player.id ? ` (${player.id})` : ""}` : player.id ? `Player ${player.id} (name unknown)` : "Unknown / not recorded", contactAnnotation,
    basis: (uid ? `Stored reporter Auth UID${event.reporterName ? " and stored reporter name" : exact?.name ? "; name from exact UID lookup" : "; name unknown"}. Target player is a separate recorded identity.${isReport ? " Reporter/uploader does not establish who operated the device." : ""}` : "No reporter UID recorded. No identity inferred from timing, email recipient, device, or target player.") + snapshotBasis };
}
function deliveryDescription(job) {
  if (!job) return "No exact incident outbox record supplied; delivery unknown";
  const effectivePayload = Microsoft.effectiveDeliveryPayload(job);
  const recipients = Array.isArray(effectivePayload?.to) ? [...new Set(effectivePayload.to.map(text))].sort() : [];
  const states = job.recipientDelivery || {};
  const status = text(job.status) || "unknown";
  const parts = [`Source job status: ${status}`];
  if (status === "deferred_to_summary") {
    const decision = job.notificationDecision;
    const verified = decision?.schemaVersion === 1 && decision.source === "posetek_notification_policy" && decision.action === "daily_summary"
      && ["routine_repeat", "backlog_before_cutover"].includes(decision.reason) && !Microsoft.hasSendEvidence(job);
    if (verified) {
      const reason = decision.reason === "routine_repeat" ? "Repeated occurrence retained for the daily summary" : "Historical unsent notification retained for the backlog report";
      parts.push(`${reason}; intentional no-send, not a delivery failure. This occurrence remains documented. Summary email delivery is tracked separately.`);
      parts.push(`Notification decision: ${decision.reason}; observed ${timestamp(decision.evaluatedAtMillis) != null ? new Date(timestamp(decision.evaluatedAtMillis)).toISOString() : "time unknown"}`);
    } else parts.push("Deferred status has incomplete or conflicting decision evidence; delivery requires review");
  }
  if (job.deliveryAmendment) parts.push(`Approved recipient restriction: ${job.deliveryAmendment.id}; original frozen recipients retained in source evidence: ${(job.payload?.to || []).join(", ")}`);
  if (recipients.length) {
    parts.push(`Frozen recipients: ${recipients.join(", ")}`);
    parts.push(...recipients.map(recipient => {
      const state = states[recipient];
      if (state?.evidence === "microsoft_trace") return `${recipient}: ${state.status || "unknown"} (Exchange trace${state.traceStatus ? `: ${state.traceStatus}` : ""}; observed ${timestamp(state.observedAtMillis) != null ? new Date(timestamp(state.observedAtMillis)).toISOString() : "time unknown"}${timestamp(state.exchangeReceivedAtMillis) != null ? `; Exchange received ${new Date(timestamp(state.exchangeReceivedAtMillis)).toISOString()}` : ""}; recipient inbox/read state not inspected)`;
      if (state?.evidence === "flow_action") return `${recipient}: ${state.status || "unknown"} (Microsoft send action accepted; not delivery confirmation${timestamp(state.at) != null ? `; receipt observed ${new Date(timestamp(state.at)).toISOString()}` : ""})`;
      return `${recipient}: ${state?.status || "no recipient confirmation"}${timestamp(state?.at) != null ? ` at ${new Date(timestamp(state.at)).toISOString()}` : ""}`;
    }));
    if (status === "delivered" && !recipients.every(to => states[to]?.status === "delivered")) parts.push("Aggregate delivery is recorded; individual confirmation is incomplete in the supplied record");
  } else parts.push("Frozen recipient payload unavailable; destinations and individual delivery not inferred from current settings");
  if (job.failureCode) parts.push(`Provider code: ${job.failureCode}`);
  if (job.deliveryProvider === "microsoft") {
    parts.push("Transport: Microsoft; flow run ID is not an email message ID");
    if (job.microsoft?.internetMessageId) parts.push(`Exchange Internet message ID: ${job.microsoft.internetMessageId}`);
    if (job.microsoft?.traceAmbiguous) parts.push("Trace association is ambiguous; individual status requires review");
    if (job.microsoft?.traceErrorCode) parts.push(`Trace check: ${job.microsoft.traceErrorCode}`);
  }
  if (job.attempts != null) parts.push(`Attempts: ${job.attempts}`);
  return parts.join("; ");
}
function monitoringInfo(message) {
  const explicit = message.monitoring;
  let project = text(explicit?.project), incident = text(explicit?.incidentId), url = "";
  const candidates = [message.detailUrl, ...(message.links || []), ...text(message.body?.content || message.body || message.bodyPreview).matchAll(/https:\/\/console\.cloud\.google\.com\/[^\s<>"']+/g)].map(value => Array.isArray(value) ? value[0] : value);
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" || parsed.hostname !== "console.cloud.google.com" || parsed.username || parsed.password) continue;
      const match = parsed.pathname.match(/^\/monitoring\/alerting\/alerts\/([^/]+)\/?$/);
      const foundProject = parsed.searchParams.get("project");
      if (!match || !foundProject) continue;
      const foundIncident = decodeURIComponent(match[1]);
      if (project && project !== foundProject || incident && incident !== foundIncident) fail("conflicting Monitoring incident identifiers");
      project = foundProject; incident = foundIncident; url = parsed.href;
    } catch (error) { if (error.message.startsWith("Issue tracker")) throw error; }
  }
  if (!project || !incident) return null;
  key(project, "Monitoring project"); key(incident, "Monitoring incident");
  return { project, incident, url: url || `https://console.cloud.google.com/monitoring/alerting/alerts/${encodeURIComponent(incident)}?project=${encodeURIComponent(project)}` };
}

/**
 * Documents are plain objects with id (or {id,data}). messages require id or
 * originalId, mailbox, receivedDateTime/received, and optional exactJoin:
 * {type:'occurrenceId'|'outboxId'|'providerId',value:'...',evidence:'...'}.
 * exactJoin is set by a trusted ingress adapter from a durable ID, never by
 * matching subject, time, affected-user label, or grouped issue URL.
 * Seed rows retain {rowId,actionId,hash,values,links} machine snapshots to preserve
 * reviewed diagnoses/identities during delivery updates; persist these privately
 * in shards, not one unbounded Firestore document. Joins/aliases are compact IDs.
 * No human fields or raw source payloads belong in the seed. Reviewed action
 * mappings may be seeded; Internet-Message-ID alone does NOT collapse copies.
 */
function normalizeIssueTracker({ occurrences = [], outbox = [], issues = [], identities = {}, messages = [], seed: inputSeed = {} } = {}) {
  const seed = prepareSeed(inputSeed);
  const changes = { actions: [], instances: [], emails: [], dailyRows: [] };
  const emitted = new Map();
  const events = indexDocs(occurrences, "occurrence"), jobs = indexDocs(outbox, "outbox"), issueDocs = indexDocs(issues, "issue");
  const originalActions = new Set(Object.keys(seed.rows.actions)), recurrences = new Map();
  if (!Array.isArray(messages)) fail("messages must be an array");
  function allocate(type) {
    const n = ++seed.counters[type];
    if (!Number.isSafeInteger(n)) fail("row counter overflow");
    return type === "action" ? `A${String(n).padStart(2, "0")}` : `${type === "instance" ? "EV" : "EM"}-${String(n).padStart(3, "0")}`;
  }
  function emit(table, id, values, links = {}, metadata = {}) {
    const previous = seed.rows[table][id];
    // A raw occurrence is often poorer evidence than a reviewed tracker row.
    // Delivery-only refreshes must not regress identities or diagnoses to generic
    // fallbacks. Only explicit delivery, exact links and source issue snapshots
    // are refreshed here; reviewed corrections require a separate audited path.
    if (table === "instances" && previous?.values) {
      const candidate = values;
      values = { ...previous.values };
      links = { ...previous.links };
      for (const column of ["Email delivery", "Provider email ID", "Delivery error code"]) values[column] = candidate[column];
      const knownEmails = [values["Email IDs"], candidate["Email IDs"]].flatMap(value => text(value).match(/\bEM-\d+\b/g) || []);
      if (knownEmails.length) values["Email IDs"] = [...new Set(knownEmails)].sort().join(", ");
      if (metadata.sourceIssueSummary) {
        values["Correlation / limits"] = annotate(values["Correlation / limits"], "Latest source issue", metadata.sourceIssueSummary);
      }
      if (metadata.contactAnnotation) {
        for (const column of ["User who acted / reported", "Identity basis"]) values[column] = annotate(values[column], "Current outreach contact", metadata.contactAnnotation);
      }
    }
    if (table === "instances" && !previous?.values && metadata.contactAnnotation) {
      const marker = "\n\n[Current outreach contact]\n";
      values["User who acted / reported"] += marker + metadata.contactAnnotation;
      values["Identity basis"] += marker + metadata.contactAnnotation;
    }
    if (table === "instances") {
      if (metadata.classificationAnnotation) values["Correlation / limits"] = annotate(values["Correlation / limits"], "Verified source classification", metadata.classificationAnnotation);
      if (metadata.sourceObservationAnnotation) {
        values["Correlation / limits"] = annotate(values["Correlation / limits"], "Corroborated source observations", metadata.sourceObservationAnnotation);
        values["Identity basis"] = annotate(values["Identity basis"], "Corroborated source observations", metadata.sourceObservationAnnotation);
      }
    }
    if (table === "emails" && previous?.values) {
      const candidate = values, candidateLinks = links;
      values = { ...previous.values }; links = { ...previous.links };
      if (metadata.eventRef && metadata.eventRef !== previous.eventRef) {
        values["Linked instance"] = candidate["Linked instance"]; values["Action ID"] = candidate["Action ID"];
        values["Message / linked diagnosis"] = `Earlier tracker evidence: ${previous.values["Message / linked diagnosis"]}\n\n[Verified later correlation]\nNow linked to ${candidate["Linked instance"]} by a durable exact identifier. ${candidate["Message / linked diagnosis"]}`;
      }
      // Native Excel can share one hyperlink across adjacent cells; replacing
      // it can affect a teammate's neighboring source link. Keep established
      // addresses, enrich blanks, and expose current-source differences rather
      // than freezing a known-invalid hyperlink migration or hiding a new join.
      const notes = [];
      for (const column of ["Outlook source", "Issue / service incident"]) {
        const current = candidateLinks[column];
        if (current && !links[column]) { links[column] = current; values[column] = values[column] || candidate[column]; }
        else if (current && links[column] !== current) notes.push(column === "Outlook source"
          ? "The current Outlook URL differs from the established link, which is preserved and may no longer open the current item. The changed URL is retained in private source evidence for reviewed link migration."
          : "The current issue/service evidence URL differs from the established link, which is preserved. Current correlation fields reflect the verified evidence; the changed URL remains in private source evidence and requires reviewed link migration.");
      }
      if (notes.length) {
        const marker = "\n\n[Preserved source links]\n";
        // An existing limitation belongs to the old summary, not between the
        // newly verified correlation and its evidence. Avoid growing on replay.
        values["Message / linked diagnosis"] = text(values["Message / linked diagnosis"]).replace(/\n\n\[Preserved source links\]\n[^]*?(?=\n\n\[Verified later correlation\]\n|$)/g, "") + marker + notes.join(" ");
      }
    }
    if (table === "dailyRows" && previous?.values) {
      if (!metadata.sourceHasPeriod) values["Reporting day"] = previous.values["Reporting day"];
      if (values["Job created (Pacific)"] === "") values["Job created (Pacific)"] = previous.values["Job created (Pacific)"];
    }
    if (table === "emails" && metadata.aliasAnnotation) values["Message / linked diagnosis"] = annotate(values["Message / linked diagnosis"], "Verified Outlook alias capture", metadata.aliasAnnotation);
    if (Object.keys(values).length !== HEADERS[table].length || HEADERS[table].some(h => !own(values, h))) fail(`incomplete ${table} machine values`);
    if (values[KEY_HEADERS[table]] !== id) fail(`${table} row key mismatch`);
    if (Object.keys(links).length !== LINK_HEADERS[table].length || LINK_HEADERS[table].some(h => !own(links, h))) fail(`incomplete ${table} links`);
    for (const value of Object.values(values)) if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && value.length > 30000) fail("invalid Excel cell value");
    // Excel stores numbers to 15 significant digits. Canonicalize the actual
    // machine cells before freezing their digest; do not mutate prior seed
    // snapshots or weaken the expected previous-hash conflict check.
    values = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, typeof value === "number" ? Number(value.toPrecision(15)) : value]));
    const hash = machineRowSha256({ values, links });
    const emittedKey = `${table}/${id}`, priorEmission = emitted.get(emittedKey);
    if (!previous || previous.hash !== hash) {
      const change = { key: id, expectedMachineSha256: priorEmission ? priorEmission.expectedMachineSha256 : previous?.hash || null, values, links };
      if (priorEmission) changes[table][changes[table].indexOf(priorEmission)] = change;
      else changes[table].push(change);
      emitted.set(emittedKey, change);
    }
    const { sourceIssueSummary: _sourceIssueSummary, sourceHasPeriod: _sourceHasPeriod, contactAnnotation: _contactAnnotation, aliasAnnotation: _aliasAnnotation, classificationAnnotation: _classificationAnnotation, sourceObservationAnnotation: _sourceObservationAnnotation, ...storedMetadata } = metadata;
    seed.rows[table][id] = { ...previous, ...storedMetadata, hash, values, links };
  }
  function action(definition, impact, source = "", preferred) {
    if (preferred) {
      if (!own(seed.rows.actions, preferred)) fail("instance action is not seeded");
      return preferred;
    }
    const existing = seed.actionMappings[definition.signature];
    if (existing) return existing;
    const id = allocate("action"); seed.actionMappings[definition.signature] = id;
    const link = httpsUrl(source);
    emit("actions", id, { "Action ID": id, Priority: definition.priority || "P2", Problem: definition.problem, "Who / impact": impact, "Recommended next step": definition.next, "Observed evidence / limits": definition.limits, "Retest and safe recovery": definition.verify, "Code / evidence": link ? "Open evidence" : "", "Provider reference": "" }, { "Code / evidence": link, "Provider reference": "" }, { rowId: id });
    return id;
  }
  // Exact backend relations only; different status/daily jobs are not incidents.
  for (const [id, job] of jobs) if (job.type === "incident") {
    if (!events.has(id)) fail("incident outbox requires the exact same-ID occurrence snapshot");
    if (events.has(id) || own(seed.rows.instances, id)) {
      seed.outboxOccurrences[id] = id;
      if (job.providerId) {
        const provider = key(job.providerId, "provider id");
        if (own(seed.providerOccurrences, provider) && seed.providerOccurrences[provider] !== id) fail("provider id maps to multiple occurrences");
        seed.providerOccurrences[provider] = id;
      }
    }
  }
  const eventInfo = new Map();
  for (const [id, event] of events) {
    const previous = seed.rows.instances[id];
    const who = identity(event, identities);
    const classification = classifyOccurrence(event);
    const actionId = action(classification, "See each instance for the recorded account and separate target athlete. Record counts are not unique users.", issueUrl(event.issueId), previous?.actionId);
    const review = event.recommendationReview;
    if (review && (review.schemaVersion !== 1 || review.source !== "posetek_server_issue_classifier" || review.signature !== "firestore:projectionDirty:pending:missing-index" || review.templateVersion !== "projection-index-v2" || !Number.isSafeInteger(review.reviewedAtMillis) || classification.signature !== review.signature)) fail("invalid server recommendation review");
    if (review) {
      const saved = seed.rows.actions[actionId];
      emit("actions", actionId, { ...saved.values,
        "Recommended next step": annotate(saved.values["Recommended next step"], "Latest source recommendation", classification.next),
        "Retest and safe recovery": annotate(saved.values["Retest and safe recovery"], "Latest source recommendation", classification.verify) }, saved.links, { rowId: actionId });
    }
    const rowId = previous?.rowId || allocate("instance");
    if (!previous && originalActions.has(actionId)) {
      if (!recurrences.has(actionId)) recurrences.set(actionId, []);
      recurrences.get(actionId).push({ id, receivedAtMillis: event.receivedAtMillis });
    }
    eventInfo.set(id, { rowId, actionId, who, classification });
    // Make IDs available to email matching before rows are finalized below.
    if (!previous) seed.rows.instances[id] = { rowId, actionId };
  }
  const aliasRepairs = new Map();
  function emailIdentity(message) {
    const originalId = key(message.originalId || message.id, "Outlook message id");
    const mailbox = key(message.mailbox, "mailbox").toLowerCase();
    if (seed.mailbox && seed.mailbox !== mailbox) fail("one tracker seed cannot mix mailboxes");
    seed.mailbox = mailbox;
    const aliases = [...new Set([originalId, message.immutableId, ...(message.aliases || [])].filter(Boolean).map(a => key(a, "Outlook alias")))];
    const aliasKey = alias => sha256(canonicalJson([mailbox, alias]));
    const matched = [...new Set(aliases.map(a => seed.emailAliases[aliasKey(a)]).filter(Boolean))];
    const repair = message.aliasReconciliation;
    if (repair) {
      if (!MailIdentity.validReconciliation(repair, message)) fail("Outlook alias reconciliation requires an authoritative item proof");
      const retainedIds = [...repair.retainedIds].sort();
      if (retainedIds.some(id => !own(seed.rows.emails, id)) || matched.some(id => !retainedIds.includes(id)) || !retainedIds.includes(repair.primaryId)) fail("Outlook alias reconciliation does not cover the exact seeded rows");
      // Reconciliation is an audited upsert, never permission to delete a row,
      // replace its display ID/source key or discard a team's action notes.
      const groupKey = aliasKey(repair.canonicalId);
      const old = seed.emailCanonicalItems?.[groupKey];
      const group = { canonicalId: repair.canonicalId, primaryId: repair.primaryId, retainedIds, proofSha256: repair.proofSha256, evidenceRef: repair.evidenceRef };
      if (old && canonicalJson(old) !== canonicalJson(group)) fail("Outlook alias reconciliation changed its frozen group");
      seed.emailCanonicalItems ||= dictionary(); seed.emailCanonicalAliases ||= dictionary();
      seed.emailCanonicalItems[groupKey] = group;
      for (const alias of aliases) {
        const oldGroup = seed.emailCanonicalAliases[aliasKey(alias)];
        if (oldGroup && oldGroup !== groupKey) fail("Outlook alias belongs to another verified group");
        seed.emailCanonicalAliases[aliasKey(alias)] = groupKey;
      }
      aliasRepairs.set(groupKey, group);
    }
    const registered = [...new Set(aliases.map(a => seed.emailCanonicalAliases?.[aliasKey(a)]).filter(Boolean))];
    if (registered.length > 1) fail("Outlook aliases bridge distinct verified item groups");
    if (registered.length === 1) {
      const group = seed.emailCanonicalItems?.[registered[0]];
      if (!group || !own(seed.rows.emails, group.primaryId) || matched.some(id => !group.retainedIds.includes(id))) fail("Outlook alias group does not cover the seeded messages");
      if (message.itemIdentity && !MailIdentity.validItemIdentity(message.itemIdentity, group.canonicalId)) fail("Outlook alias proof disagrees with its frozen canonical item");
      aliasRepairs.set(registered[0], group);
      for (const alias of aliases) {
        seed.emailCanonicalAliases[aliasKey(alias)] = registered[0];
        // Keep every original historical alias mapping. Newly observed aliases
        // can point at the primary stable row, but cannot erase old identities.
        if (!seed.emailAliases[aliasKey(alias)]) seed.emailAliases[aliasKey(alias)] = group.primaryId;
      }
      return group.primaryId;
    }
    if (matched.length > 1) fail("Outlook aliases bridge distinct seeded messages");
    const canonicalId = matched[0] || originalId;
    for (const alias of aliases) seed.emailAliases[aliasKey(alias)] = canonicalId;
    return canonicalId;
  }
  // Collapse only explicit Graph/immutable aliases, never body similarity or time.
  const mailDocs = new Map();
  for (const message of [...messages].sort((a, b) => Number(Boolean(b.aliasReconciliation)) - Number(Boolean(a.aliasReconciliation)) || text(a.originalId || a.id).localeCompare(text(b.originalId || b.id), "en"))) {
    const id = emailIdentity(message);
    const prior = mailDocs.get(id);
    if (prior && canonicalJson(prior) !== canonicalJson(message)) {
      const group = Object.values(seed.emailCanonicalItems || {}).find(group => group.primaryId === id);
      const canonicalId = group?.canonicalId || prior.itemIdentity?.canonicalId;
      const proven = group ? [prior, message].every(value => [value.originalId || value.id, value.immutableId, ...(value.aliases || [])].filter(Boolean).some(alias => seed.emailCanonicalAliases[sha256(canonicalJson([seed.mailbox, alias]))] === sha256(canonicalJson([seed.mailbox, canonicalId])))) : [prior, message].every(value => MailIdentity.validItemIdentity(value.itemIdentity, canonicalId));
      if (!proven || prior.internetMessageId !== message.internetMessageId || prior.exactJoin && message.exactJoin && canonicalJson(prior.exactJoin) !== canonicalJson(message.exactJoin)) fail("conflicting Outlook snapshots in one batch; supply the current full message once");
      const current = MailIdentity.validItemIdentity(message.itemIdentity, canonicalId) && !MailIdentity.validItemIdentity(prior.itemIdentity, canonicalId) ? message : prior;
      mailDocs.set(id, { ...current, aliases: [...new Set([...(prior.aliases || []), ...(message.aliases || []), prior.originalId || prior.id, message.originalId || message.id])], ...(prior.exactJoin || message.exactJoin ? { exactJoin: prior.exactJoin || message.exactJoin } : {}), ...(prior.aliasReconciliation || message.aliasReconciliation ? { aliasReconciliation: prior.aliasReconciliation || message.aliasReconciliation } : {}) });
    } else mailDocs.set(id, message);
  }
  for (const [id, message] of mailDocs) {
    const previous = seed.rows.emails[id];
    if (message.deliveryRecommendationReview) {
      const review = message.deliveryRecommendationReview, actionRow = seed.rows.actions[review.actionId];
      if (!MailIdentity.validDeliveryReview(review) || review.primaryId !== id || previous?.actionId !== review.actionId || !actionRow?.values || sha256(text(actionRow.values.Problem)) !== review.expectedProblemSha256) fail("delivery recommendation review does not bind the verified existing action");
      const note = `Current PoseTek issue/status/daily notifications use Microsoft Power Automate and are authorized for dylank@posetek.net only. Preserve original recipients, claims, payloads and receipts. At the recorded review (${new Date(review.reviewedAtMillis).toISOString()}), ${review.legacyResendNeedsReview} explicit historical Resend jobs and ${review.legacyUnassignedNeedsReview} unassigned historical jobs remain for review; do not replay them, restart Resend or purchase extra quota automatically. Google Cloud fallback notices have a separate daily safety cap of ${review.googleCloudDailySafetyCap}; inspect that route independently when its cap or delivery evidence prevents a notice. Stopping alerts does not resolve the original user issue.`;
      emit("actions", review.actionId, { ...actionRow.values,
        "Recommended next step": annotate(actionRow.values["Recommended next step"], "Latest delivery recommendation", note),
        "Retest and safe recovery": annotate(actionRow.values["Retest and safe recovery"], "Latest delivery recommendation", "Verify a genuine new Microsoft notification is addressed only to Dylan and has exact Exchange recipient delivery evidence and a matching published tracker record. Preserve historical failed/partial outcomes and investigate unassigned provider evidence manually.") }, actionRow.links, { rowId: actionRow.rowId });
      // This archived operator review changes only the existing action's
      // current guidance. Do not re-render imported historical mail from the
      // review envelope or replace any original wording, link or identity.
      continue;
    }
    if (previous?.internetMessageId && message.internetMessageId && previous.internetMessageId !== message.internetMessageId) fail("Outlook item changed Internet-Message-ID");
    const monitoring = monitoringInfo(message);
    const operationalWarning = powerAutomateWarning(message);
    const priorMonitoring = previous?.links ? monitoringInfo({ detailUrl: previous.links["Issue / service incident"] }) : null;
    if (monitoring && priorMonitoring && (monitoring.project !== priorMonitoring.project || monitoring.incident !== priorMonitoring.incident)) fail("Outlook item changed its verified Monitoring project or incident");
    if (monitoring && previous?.values?.["Monitoring incident ID"] && monitoring.incident !== previous.values["Monitoring incident ID"]) fail("Outlook item changed its verified Monitoring incident");
    let eventRef = previous?.eventRef || "", joinEvidence = "";
    if (message.exactJoin) {
      const join = message.exactJoin; key(join.value, "exact join id"); key(join.evidence, "exact join evidence");
      let found;
      if (join.type === "occurrenceId") found = own(seed.rows.instances, join.value) ? join.value : "";
      else if (join.type === "outboxId") found = seed.outboxOccurrences[join.value];
      else if (join.type === "providerId") found = seed.providerOccurrences[join.value];
      else fail("unsupported exact join type");
      if (found && eventRef && found !== eventRef) fail("Outlook message changed occurrence identity");
      if (found) { eventRef = found; joinEvidence = `Exact ${join.type}: ${join.evidence}`; }
    }
    if (monitoring && eventRef) fail("Monitoring notice cannot also claim a user occurrence");
    if (eventRef && !events.has(eventRef)) fail("matched email requires a current occurrence and outbox snapshot to refresh both linked rows");
    const eventRow = eventRef && seed.rows.instances[eventRef];
    let actionId;
    if (eventRow) actionId = eventRow.actionId;
    else if (monitoring) actionId = action({ signature: `monitoring:${monitoring.project}:${monitoring.incident}`, priority: "P2", problem: "Needs triage: Google Cloud Monitoring incident", next: "Inspect the linked service incident, its policy and matching logs. Confirm user impact before choosing a fix.", limits: "Distinct open, repeat, and recovery messages share this exact project/incident. A recovery notice does not establish that an underlying user issue is fixed.", verify: "Verify service health and any affected operation; a human decides whether to resolve the tracker action." }, "Service/project notification; no user identity inferred.", monitoring.url, previous?.actionId);
    else actionId = action({ signature: `needs-triage:email:${sha256(canonicalJson([seed.mailbox, id]))}`, problem: operationalWarning ? "Needs triage: Power Automate operational warning" : "Needs triage: unmatched email notification", next: operationalWarning ? "Inspect the original Microsoft warning and independently verify the flow/environment and failed or throttled run. Recover that exact operation without replaying unrelated alerts." : "Inspect the original message and find a durable occurrence, outbox, provider, or service-incident identifier. Retain this message if no exact match is available.", limits: operationalWarning ? "Microsoft reports a flow failure or throttling warning. Its PoseTek flow ownership, affected users and exact incident remain unconfirmed until independent run evidence is recorded." : "No exact backend occurrence join is available. Subject, receipt time, affected-user label, and grouped issue links do not identify one attempt.", verify: "Confirm a durable identifier before linking an occurrence or selecting an existing diagnosis." }, "The original email label is evidence only; it is not confirmed actor identity.", message.webLink || message.url, previous?.actionId);
    const rowId = previous?.rowId || allocate("email");
    if (eventRef) {
      seed.emailLinks[eventRef] ||= [];
      if (!seed.emailLinks[eventRef].includes(rowId)) seed.emailLinks[eventRef].push(rowId);
      seed.emailLinks[eventRef].sort();
    }
    const outlook = httpsUrl(message.webLink || message.url);
    const evidenceUrl = monitoring?.url || (eventRef ? issueUrl(events.get(eventRef)?.issueId || message.issueId) : httpsUrl(message.detailUrl));
    const description = displayExcerpt(message.summary || message.bodyPreview || message.body?.content || message.body, outlook) || "See original message; no diagnosis inferred from subject alone.";
    const senderEvidence = !previous && (message.from || message.sender) ? `\nOriginal email provenance (not the user or actor): ${[message.from ? `From: ${text(message.from)}` : "", message.sender ? `Sender: ${text(message.sender)}` : ""].filter(Boolean).join("; ")}.` : "";
    const summary = `${description}${senderEvidence}${monitoring ? `\nMonitoring project: ${monitoring.project}. Recovery/repeat status is message evidence only; manual action status is preserved.` : eventRef ? `\n${joinEvidence || "Previously verified exact occurrence join preserved."}` : "\nUnmatched: no durable exact occurrence join."}`;
    emit("emails", id, { Email: rowId, "Received (Pacific)": pacificExcelSerial(message.receivedDateTime ?? message.received), "Message type": monitoring ? "Google Cloud Monitoring" : operationalWarning?.category || text(message.category) || "Issue / error notification", "Function / operation": text(message.functionName || message.operation || operationalWarning?.operation), "Linked instance": eventRow?.rowId || (monitoring ? "Service incident; user unknown" : "Unmatched"), "Action ID": actionId, "Original affected-user label": text(message.affected), "Message / linked diagnosis": summary, "Outlook source": outlook ? "Open email" : "", "Issue / service incident": evidenceUrl ? "Open evidence" : "", "Monitoring incident ID": monitoring?.incident || "", "Original subject": text(message.subject), "Outlook message ID": id }, { "Outlook source": outlook, "Issue / service incident": evidenceUrl }, { rowId, actionId, ...(eventRef ? { eventRef } : {}), ...(message.internetMessageId ? { internetMessageId: key(message.internetMessageId, "Internet-Message-ID") } : {}) });
  }
  for (const group of aliasRepairs.values()) {
    const primary = seed.rows.emails[group.primaryId];
    for (const id of group.retainedIds.filter(id => id !== group.primaryId)) {
      const saved = seed.rows.emails[id], marker = "\n\n[Verified Outlook alias capture]\n";
      const note = `This retained row is another capture of canonical email ${primary.rowId} (action ${primary.actionId}), proven by authoritative Exchange item-ID evidence. It is not an additional email delivery, user or attempted action. Original row/source/action IDs, source links and human notes are retained. Proof SHA256: ${group.proofSha256}.`;
      emit("emails", id, saved.values, saved.links,
        { rowId: saved.rowId, actionId: saved.actionId, aliasOf: group.primaryId, aliasProofSha256: group.proofSha256, aliasAnnotation: note });
      const signature = `needs-triage:email:${sha256(canonicalJson([seed.mailbox, id]))}`;
      if (saved.actionId !== primary.actionId && seed.actionMappings[signature] === saved.actionId) {
        const actionRow = seed.rows.actions[saved.actionId];
        emit("actions", saved.actionId, { ...actionRow.values, "Recommended next step": annotate(actionRow.values["Recommended next step"], "Verified Outlook alias capture", `Retained duplicate capture of ${primary.rowId}; work on canonical action ${primary.actionId}. Preserve saved Status, Owner, Due and Fix notes; this is no additional attempted action.`), "Observed evidence / limits": annotate(actionRow.values["Observed evidence / limits"], "Verified Outlook alias capture", note) }, actionRow.links, { rowId: actionRow.rowId, aliasOfActionId: primary.actionId, aliasOfEmailId: primary.rowId, aliasProofSha256: group.proofSha256 });
      }
    }
  }
  for (const [id, event] of events) {
    const info = eventInfo.get(id), issue = issueDocs.get(event.issueId), job = jobs.get(id);
    if (job && job.type !== "incident") fail("occurrence id collides with a non-incident outbox job");
    if (own(inputSeed.rows?.instances || {}, id) && inputSeed.rows.instances[id].outboxObserved !== false && !job) fail("existing occurrence refresh requires its incident outbox snapshot; absent delivery evidence cannot erase prior delivery");
    if (job?.issueId && event.issueId && job.issueId !== event.issueId) fail("incident job and occurrence issue IDs disagree");
    const links = { "Private issue": issueUrl(event.issueId) };
    const correlation = ["One retained backend occurrence; not a unique-person count."];
    const effective = OccurrenceClassification.classifyOccurrence(event);
    const callableRequest = OccurrenceClassification.validCallableOutcome(event.callableOutcome, event);
    const classificationAnnotation = effective.effectiveKind === "diagnostic" ? `Server evidence classification: diagnostic uploaded; subtype ${effective.diagnosticSubtype}. Original kind ${text(event.kind) || "unknown"} is retained. This does not prove a crash, interrupted session or affected operator.` : callableRequest ? `Server-verified failed callable request (${event.callableOutcome.errorCategory}); ${effective.scope === "unknown_actor" ? "no accepted authenticated reporter is recorded, so actor and contact remain unknown" : "the recorded authenticated account remains separate from the target athlete"}.` : effective.scope === "automated_service" ? "Automated service occurrence; no affected app operator is identified by this service log." : "";
    const sourceObservationAnnotation = observationAnnotation(event);
    if (event.requestId) correlation.push("Request/job ID is recorded, but it alone is not used to collapse independent source records.");
    if (timestamp(event.occurredAtMillis) == null) correlation.push("Occurrence time unknown; receipt time has not been substituted.");
    const sourceIssueSummary = issue ? `Grouped source issue state: ${text(issue.state) || "unknown"}; recorded occurrences: ${Number.isSafeInteger(issue.occurrences) && issue.occurrences >= 0 ? issue.occurrences : "unknown"}. This does not change the manual action status.` : "";
    if (/system_diagnostic|interrupt/i.test(`${event.code} ${event.kind}`)) correlation.push("Diagnostic/interrupted label is not proof of a crash or its cause; inspect the original diagnostic.");
    const evidence = [event.message, event.description].filter(Boolean).join("\n") || `No error detail stored. Recorded code: ${text(event.code) || "unknown"}; kind: ${text(event.kind) || "unknown"}.`;
    emit("instances", id, { Instance: info.rowId, "Occurred (Pacific)": pacificExcelSerial(event.occurredAtMillis), "User who acted / reported": info.who.actor, "Target athlete": info.who.target, "Attempted action": event.operation ? `Recorded operation: ${event.operation}` : "Unknown; operation not recorded", "Error / actual evidence": evidence, "Action ID": info.actionId, "Email delivery": deliveryDescription(job), "Recorded operation": text(event.operation), "Identity basis": info.who.basis, "Recorded actor UID": text(event.reporterUid), "Target player ID": text(event.player?.id), "Page / device": `${event.route || "No page recorded"}; ${event.device || "Unknown device"}`, "Received (Pacific)": pacificExcelSerial(event.receivedAtMillis), "Email IDs": (seed.emailLinks[id] || []).join(", ") || "No matching email", "Correlation / limits": correlation.join(" ") + (sourceIssueSummary ? `\n\n[Latest source issue]\n${sourceIssueSummary}` : ""), "Private issue": links["Private issue"] ? "Open issue" : "", "Source record": text(event.sourceReference || event.source), Build: text(event.build), "Request / job ID": text(event.requestId), "Occurrence ID": id, "Provider email ID": text(job?.providerId), "Delivery error code": text(job?.failureCode) }, links, { rowId: info.rowId, actionId: info.actionId, sourceIssueSummary, contactAnnotation: info.who.contactAnnotation, classificationAnnotation, sourceObservationAnnotation, outboxObserved: Boolean(job) || inputSeed.rows?.instances?.[id]?.outboxObserved === true });
  }
  for (const [id, job] of jobs) if (job.type === "daily" || job.type === "status") {
    const sourceIssue = issueDocs.get(job.issueId);
    const sourceEvidence = job.type === "status" ? [`Status-change notification title: ${text(job.title) || "not supplied"}`, `Recorded change actor UID: ${text(job.actorUid) || "unknown"} (not an affected-user inference)`, `Original change evidence: ${Array.isArray(job.lines) ? job.lines.map(text).join(" | ") : "not supplied"}`, `Latest source issue state: ${text(sourceIssue?.state) || "unknown"}; source occurrences: ${Number.isSafeInteger(sourceIssue?.occurrences) && sourceIssue.occurrences >= 0 ? sourceIssue.occurrences : "unknown"}. This does not modify manual tracker status.`].join("\n") : "";
    emit("dailyRows", id, { "Reporting day": job.type === "status" ? "Status-change notification (not a user incident)" : text(job.reportingDay || job.date || job.day) || "See job reference for reporting period", "Job created (Pacific)": pacificExcelSerial(job.createdAtMillis), Delivery: deliveryDescription(job) + (sourceEvidence ? `\n\n${sourceEvidence}` : ""), "Provider code": text(job.failureCode), "Job reference": id }, {}, { rowId: id, sourceHasPeriod: job.type === "status" || Boolean(job.reportingDay || job.date || job.day) });
  }
  // Recurrence is machine evidence, never a manual status change. Keep reviewed
  // action prose intact and replace only this adapter's bounded latest marker.
  for (const [id, entries] of recurrences) {
    const saved = seed.rows.actions[id];
    if (!saved.values || !saved.links) fail("existing action recurrence requires seeded full machine values and links");
    const marker = "\n\n[Automated recurrence]\n";
    const prior = text(saved.values["Observed evidence / limits"]).split(marker)[0];
    const received = entries.map(entry => `${entry.id} (received ${timestamp(entry.receivedAtMillis) == null ? "unknown" : new Date(timestamp(entry.receivedAtMillis)).toISOString()})`).join(", ");
    const values = { ...saved.values, "Observed evidence / limits": `${prior}${marker}Recurrence recorded: ${received}. These are new source records; no automatic reopening or unique-user inference.` };
    emit("actions", id, values, saved.links, { rowId: id });
  }
  if (Object.values(changes).reduce((n, rows) => n + rows.length, 0) > 150) fail("batch exceeds Office Script's 150-row change limit; split source work before preparing a receipt");
  return { changes, nextSeed: seed };
}

module.exports = { normalizeIssueTracker, normalize: normalizeIssueTracker, classifyOccurrence, deliveryDescription, pacificExcelSerial, canonicalJson, machineRowSha256, HEADERS, LINK_HEADERS, KEY_HEADERS };
