"use strict";

// Pure adapter: no Firestore, Outlook, clock, credentials, or workbook writes.
// The caller must persist nextSeed ONLY after the workbook confirms the batch.
// Bootstrap existing keys/hashes from the cloud workbook before enabling writes.
const crypto = require("node:crypto");

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
    return pattern("firestore:projectionDirty:pending:missing-index", "Projection sweep requires a Firestore index", "Inspect the exact failing query and index definition, confirm the required index is ready, then retry the sweep.", "The error identifies an index requirement. It does not establish which completed player results were blocked.");
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
  const name = text(event.reporterName || exact?.name);
  const isReport = /failureCases|fieldReports|system_diagnostic/i.test(`${event.source} ${event.sourceReference} ${event.code}`);
  const label = name || (uid ? `Account ${uid}` : "Unknown account");
  const actor = uid ? `${isReport ? "Reported/uploaded by" : "Recorded account"}: ${label}${isReport ? "; original operator unconfirmed" : ""}` : "Unknown actor (no authenticated reporter recorded)";
  const player = event.player && typeof event.player === "object" ? event.player : {};
  return { actor, target: player.name ? `${player.name}${player.id ? ` (${player.id})` : ""}` : player.id ? `Player ${player.id} (name unknown)` : "Unknown / not recorded", basis: uid ? `Stored reporter Auth UID${event.reporterName ? " and stored reporter name" : exact?.name ? "; name from exact UID lookup" : "; name unknown"}. Target player is a separate recorded identity.${isReport ? " Reporter/uploader does not establish who operated the device." : ""}` : "No reporter UID recorded. No identity inferred from timing, email recipient, device, or target player." };
}
function deliveryDescription(job) {
  if (!job) return "No exact incident outbox record supplied; delivery unknown";
  const recipients = Array.isArray(job.payload?.to) ? [...new Set(job.payload.to.map(text))].sort() : [];
  const states = job.recipientDelivery || {};
  const status = text(job.status) || "unknown";
  const parts = [`Source job status: ${status}`];
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
        const marker = "\n\n[Latest source issue]\n";
        values["Correlation / limits"] = text(previous.values["Correlation / limits"]).split(marker)[0] + marker + metadata.sourceIssueSummary;
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
    if (Object.keys(values).length !== HEADERS[table].length || HEADERS[table].some(h => !own(values, h))) fail(`incomplete ${table} machine values`);
    if (values[KEY_HEADERS[table]] !== id) fail(`${table} row key mismatch`);
    if (Object.keys(links).length !== LINK_HEADERS[table].length || LINK_HEADERS[table].some(h => !own(links, h))) fail(`incomplete ${table} links`);
    for (const value of Object.values(values)) if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && value.length > 30000) fail("invalid Excel cell value");
    // Excel stores numbers to 15 significant digits. Canonicalize the actual
    // machine cells before freezing their digest; do not mutate prior seed
    // snapshots or weaken the expected previous-hash conflict check.
    values = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, typeof value === "number" ? Number(value.toPrecision(15)) : value]));
    const hash = machineRowSha256({ values, links });
    if (!previous || previous.hash !== hash) changes[table].push({ key: id, expectedMachineSha256: previous?.hash || null, values, links });
    const { sourceIssueSummary: _sourceIssueSummary, sourceHasPeriod: _sourceHasPeriod, ...storedMetadata } = metadata;
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
    const rowId = previous?.rowId || allocate("instance");
    if (!previous && originalActions.has(actionId)) {
      if (!recurrences.has(actionId)) recurrences.set(actionId, []);
      recurrences.get(actionId).push({ id, receivedAtMillis: event.receivedAtMillis });
    }
    eventInfo.set(id, { rowId, actionId, who, classification });
    // Make IDs available to email matching before rows are finalized below.
    if (!previous) seed.rows.instances[id] = { rowId, actionId };
  }
  function emailIdentity(message) {
    const originalId = key(message.originalId || message.id, "Outlook message id");
    const mailbox = key(message.mailbox, "mailbox").toLowerCase();
    if (seed.mailbox && seed.mailbox !== mailbox) fail("one tracker seed cannot mix mailboxes");
    seed.mailbox = mailbox;
    const aliases = [...new Set([originalId, message.immutableId, ...(message.aliases || [])].filter(Boolean).map(a => key(a, "Outlook alias")))];
    const aliasKey = alias => sha256(canonicalJson([mailbox, alias]));
    const matched = [...new Set(aliases.map(a => seed.emailAliases[aliasKey(a)]).filter(Boolean))];
    if (matched.length > 1) fail("Outlook aliases bridge distinct seeded messages");
    const canonicalId = matched[0] || originalId;
    for (const alias of aliases) seed.emailAliases[aliasKey(alias)] = canonicalId;
    return canonicalId;
  }
  // Collapse only explicit Graph/immutable aliases, never body similarity or time.
  const mailDocs = new Map();
  for (const message of [...messages].sort((a, b) => text(a.originalId || a.id).localeCompare(text(b.originalId || b.id), "en"))) {
    const id = emailIdentity(message);
    if (mailDocs.has(id) && canonicalJson(mailDocs.get(id)) !== canonicalJson(message)) fail("conflicting Outlook snapshots in one batch; supply the current full message once");
    mailDocs.set(id, message);
  }
  for (const [id, message] of mailDocs) {
    const previous = seed.rows.emails[id];
    if (previous?.internetMessageId && message.internetMessageId && previous.internetMessageId !== message.internetMessageId) fail("Outlook item changed Internet-Message-ID");
    const monitoring = monitoringInfo(message);
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
    else actionId = action({ signature: `needs-triage:email:${sha256(canonicalJson([seed.mailbox, id]))}`, problem: "Needs triage: unmatched email notification", next: "Inspect the original message and find a durable occurrence, outbox, provider, or service-incident identifier. Retain this message if no exact match is available.", limits: "No exact backend occurrence join is available. Subject, receipt time, affected-user label, and grouped issue links do not identify one attempt.", verify: "Confirm a durable identifier before linking an occurrence or selecting an existing diagnosis." }, "The original email label is evidence only; it is not confirmed actor identity.", message.webLink || message.url, previous?.actionId);
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
    emit("emails", id, { Email: rowId, "Received (Pacific)": pacificExcelSerial(message.receivedDateTime ?? message.received), "Message type": monitoring ? "Google Cloud Monitoring" : text(message.category) || "Issue / error notification", "Function / operation": text(message.functionName || message.operation), "Linked instance": eventRow?.rowId || (monitoring ? "Service incident; user unknown" : "Unmatched"), "Action ID": actionId, "Original affected-user label": text(message.affected), "Message / linked diagnosis": summary, "Outlook source": outlook ? "Open email" : "", "Issue / service incident": evidenceUrl ? "Open evidence" : "", "Monitoring incident ID": monitoring?.incident || "", "Original subject": text(message.subject), "Outlook message ID": id }, { "Outlook source": outlook, "Issue / service incident": evidenceUrl }, { rowId, actionId, ...(eventRef ? { eventRef } : {}), ...(message.internetMessageId ? { internetMessageId: key(message.internetMessageId, "Internet-Message-ID") } : {}) });
  }
  for (const [id, event] of events) {
    const info = eventInfo.get(id), issue = issueDocs.get(event.issueId), job = jobs.get(id);
    if (job && job.type !== "incident") fail("occurrence id collides with a non-incident outbox job");
    if (own(inputSeed.rows?.instances || {}, id) && inputSeed.rows.instances[id].outboxObserved !== false && !job) fail("existing occurrence refresh requires its incident outbox snapshot; absent delivery evidence cannot erase prior delivery");
    if (job?.issueId && event.issueId && job.issueId !== event.issueId) fail("incident job and occurrence issue IDs disagree");
    const links = { "Private issue": issueUrl(event.issueId) };
    const correlation = ["One retained backend occurrence; not a unique-person count."];
    if (event.requestId) correlation.push("Request/job ID is recorded, but it alone is not used to collapse independent source records.");
    if (timestamp(event.occurredAtMillis) == null) correlation.push("Occurrence time unknown; receipt time has not been substituted.");
    const sourceIssueSummary = issue ? `Grouped source issue state: ${text(issue.state) || "unknown"}; recorded occurrences: ${Number.isSafeInteger(issue.occurrences) && issue.occurrences >= 0 ? issue.occurrences : "unknown"}. This does not change the manual action status.` : "";
    if (/system_diagnostic|interrupt/i.test(`${event.code} ${event.kind}`)) correlation.push("Diagnostic/interrupted label is not proof of a crash or its cause; inspect the original diagnostic.");
    const evidence = [event.message, event.description].filter(Boolean).join("\n") || `No error detail stored. Recorded code: ${text(event.code) || "unknown"}; kind: ${text(event.kind) || "unknown"}.`;
    emit("instances", id, { Instance: info.rowId, "Occurred (Pacific)": pacificExcelSerial(event.occurredAtMillis), "User who acted / reported": info.who.actor, "Target athlete": info.who.target, "Attempted action": event.operation ? `Recorded operation: ${event.operation}` : "Unknown; operation not recorded", "Error / actual evidence": evidence, "Action ID": info.actionId, "Email delivery": deliveryDescription(job), "Recorded operation": text(event.operation), "Identity basis": info.who.basis, "Recorded actor UID": text(event.reporterUid), "Target player ID": text(event.player?.id), "Page / device": `${event.route || "No page recorded"}; ${event.device || "Unknown device"}`, "Received (Pacific)": pacificExcelSerial(event.receivedAtMillis), "Email IDs": (seed.emailLinks[id] || []).join(", ") || "No matching email", "Correlation / limits": correlation.join(" ") + (sourceIssueSummary ? `\n\n[Latest source issue]\n${sourceIssueSummary}` : ""), "Private issue": links["Private issue"] ? "Open issue" : "", "Source record": text(event.sourceReference || event.source), Build: text(event.build), "Request / job ID": text(event.requestId), "Occurrence ID": id, "Provider email ID": text(job?.providerId), "Delivery error code": text(job?.failureCode) }, links, { rowId: info.rowId, actionId: info.actionId, sourceIssueSummary, outboxObserved: Boolean(job) || inputSeed.rows?.instances?.[id]?.outboxObserved === true });
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
