"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { normalizeIssueTracker: normalize, machineRowSha256, canonicalJson, pacificExcelSerial, classifyOccurrence, HEADERS, LINK_HEADERS } = require("./issue-tracker-normalize");

// Synthetic evidence only. No captured accounts, incident IDs, or source bodies.
const AT = Date.parse("2026-10-01T19:00:00Z");
const occurrence = (id = "occ-1", patch = {}) => ({ id, issueId: "group-1", operation: "build_report", code: "internal", platform: "backend", kind: "error", source: "cloud_log", sourceReference: "logs/synthetic", message: "Unknown service failure", occurredAtMillis: AT - 86400000, receivedAtMillis: AT, ...patch });
const job = (id = "occ-1", patch = {}) => ({ id, type: "incident", issueId: "group-1", status: "pending", createdAtMillis: AT, attempts: 0, ...patch });
const mail = (id = "mail-1", patch = {}) => ({ id, mailbox: "tracker@example.test", receivedDateTime: new Date(AT).toISOString(), subject: "Issue notification", bodyPreview: "Recorded failure", webLink: "https://outlook.office.com/mail/item/synthetic", ...patch });
const guard = id => occurrence(id, { message: "Player data changed during the rebuild. Retry to refresh the report." });
const noChanges = result => Object.values(result.changes).every(rows => rows.length === 0);
const one = (event = occurrence(), outbox = job()) => normalize({ occurrences: [event], outbox: [outbox] });

test("emits only full machine columns, exact keys and independent occurrence/receipt dates", () => {
  const result = one();
  const row = result.changes.instances[0];
  assert.equal(row.key, "occ-1"); assert.equal(row.expectedMachineSha256, null);
  assert.equal(row.values["Occurrence ID"], "occ-1");
  assert.equal(row.values["Received (Pacific)"] - row.values["Occurred (Pacific)"], 1);
  for (const [table, rows] of Object.entries(result.changes)) for (const change of rows) {
    assert.deepEqual(Object.keys(change.values).sort(), [...HEADERS[table]].sort());
    assert.deepEqual(Object.keys(change.links).sort(), [...LINK_HEADERS[table]].sort());
    for (const human of ["Status", "Owner", "Due (Pacific)", "Fix notes"]) assert.equal(Object.hasOwn(change.values, human), false);
    assert.equal(result.nextSeed.rows[table][change.key].hash, machineRowSha256(change));
  }
  assert.equal(Object.hasOwn(row.values, "Recommended next step"), false);
  assert.equal(Object.hasOwn(result.nextSeed, "checkpoints"), false);
});

test("uses America/Los_Angeles DST and leaves unknown/zone-less times unknown", () => {
  assert.equal(pacificExcelSerial("2026-01-01T20:00:00Z"), 46023.5);
  assert.equal(pacificExcelSerial("2026-07-01T19:00:00Z"), 46204.5);
  assert.equal(pacificExcelSerial("2026-10-01T12:00:00"), "");
  const result = one(occurrence("occ-1", { occurredAtMillis: null }));
  assert.equal(result.changes.instances[0].values["Occurred (Pacific)"], "");
  assert.match(result.changes.instances[0].values["Correlation / limits"], /receipt time has not been substituted/);
});

test("machine dates freeze to Excel's 15 significant digits and untouched historical seed remains exact", () => {
  const stamp = "2026-10-01T07:09:20Z", first = one(occurrence("occ-1", { occurredAtMillis: Date.parse(stamp) }));
  assert.equal(first.changes.instances[0].values["Occurred (Pacific)"], 46296.0064814815);
  const previous = first.nextSeed.rows.instances["occ-1"];
  previous.values["Occurred (Pacific)"] = 46296.00648148148; previous.hash = machineRowSha256(previous);
  const original = structuredClone(first.nextSeed), untouched = normalize({ seed: original });
  assert.equal(untouched.nextSeed.rows.instances["occ-1"].values["Occurred (Pacific)"], 46296.00648148148);
  const next = normalize({ seed: original, occurrences: [occurrence("occ-1")], outbox: [job()] });
  assert.equal(next.changes.instances[0].expectedMachineSha256, previous.hash);
  assert.equal(next.changes.instances[0].values["Occurred (Pacific)"], 46296.0064814815);
  assert.equal(canonicalJson(original), canonicalJson(first.nextSeed));
  assert.equal(normalize({ seed: next.nextSeed, occurrences: [occurrence("occ-1")], outbox: [job()] }).changes.instances.length, 0);
});

test("reads current issue state and occurrences, never obsolete field names or manual status", () => {
  const r = normalize({ occurrences: [occurrence()], outbox: [job()], issues: [{ id: "group-1", state: "verified", occurrences: 12, status: "wrong", occurrenceCount: 99 }] });
  assert.match(r.changes.instances[0].values["Correlation / limits"], /state: verified; recorded occurrences: 12/);
  assert.doesNotMatch(r.changes.instances[0].values["Correlation / limits"], /wrong|99/);
});

test("native reporter/uploader and target are separate, without guessing original operator", () => {
  const r = one(occurrence("occ-1", { source: "failureCases", reporterUid: "uid-reporter", reporterName: "Synthetic Reporter", player: { id: "player-target", name: "Synthetic Target" } }));
  const v = r.changes.instances[0].values;
  assert.match(v["User who acted / reported"], /Reported\/uploaded by: Synthetic Reporter; original operator unconfirmed/);
  assert.equal(v["Target athlete"], "Synthetic Target (player-target)");
  assert.equal(v["Recorded actor UID"], "uid-reporter");
  assert.doesNotMatch(v["User who acted / reported"], /Synthetic Target/);
});

test("identity enrichment requires exact UID and never infers actor from target", () => {
  const r = normalize({ occurrences: [occurrence("occ-1", { reporterUid: "uid-1", player: { id: "target", name: "Another Person" } })], identities: { "uid-1": { uid: "uid-1", name: "Example Staff" } }, outbox: [job()] });
  assert.match(r.changes.instances[0].values["User who acted / reported"], /Example Staff/);
  assert.throws(() => normalize({ occurrences: [occurrence("occ-1", { reporterUid: "uid-1" })], identities: { "uid-1": { uid: "uid-other", name: "Wrong Account" } } }), /UID mismatch/);
  const unknown = one(occurrence("occ-1", { player: { id: "target", name: "Another Person" } }));
  assert.match(unknown.changes.instances[0].values["User who acted / reported"], /^Unknown actor/);
});

test("same broad issue/operation and generic HTTP failures do not group unknown causes", () => {
  const r = normalize({ occurrences: [occurrence("a", { message: "HTTP 500" }), occurrence("b", { message: "HTTP 500" })], outbox: [job("a"), job("b")] });
  assert.equal(r.changes.actions.length, 2);
  assert.notEqual(r.changes.instances[0].values["Action ID"], r.changes.instances[1].values["Action ID"]);
  assert.ok(r.changes.actions.every(a => a.values.Problem.startsWith("Needs triage")));
});

test("known exact signatures group, and a Flask return traceback stays separate from HTTP 500", () => {
  const events = [guard("a"), guard("b"), occurrence("c", { message: "The view function for 'handle_video' did not return a valid response." }), occurrence("d", { message: "HTTP 500" })];
  const r = normalize({ occurrences: events, outbox: events.map(e => job(e.id)) });
  assert.equal(r.changes.actions.length, 3);
  assert.equal(r.changes.instances[0].values["Action ID"], r.changes.instances[1].values["Action ID"]);
  assert.notEqual(r.changes.instances[2].values["Action ID"], r.changes.instances[3].values["Action ID"]);
});

test("missing index and missing metadata require specific object/query evidence", () => {
  assert.equal(classifyOccurrence(occurrence("a", { code: "FAILED_PRECONDITION", message: "projectionDirty pending query requires an index" })).signature, "firestore:projectionDirty:pending:missing-index");
  assert.match(classifyOccurrence(occurrence("b", { code: "FAILED_PRECONDITION", message: "Something failed" })).signature, /^needs-triage:/);
  assert.notEqual(classifyOccurrence(occurrence("c", { message: "No such object: bucket/a/metadata.json" })).signature, classifyOccurrence(occurrence("d", { message: "No such object: bucket/b/metadata.json" })).signature);
});

test("system diagnostics remain unknown-cause evidence, not an invented crash diagnosis", () => {
  const r = one(occurrence("occ-1", { code: "system_diagnostic", kind: "interrupted", description: "Diagnostic uploaded", reporterUid: "uploader" }));
  assert.match(r.changes.actions[0].values.Problem, /Needs triage/);
  assert.match(r.changes.instances[0].values["Correlation / limits"], /not proof of a crash/);
  assert.doesNotMatch(r.changes.actions[0].values.Problem, /memory|timeout/i);
});

test("frozen historical recipients and per-recipient failures survive current configuration changes", () => {
  const r = one(occurrence(), job("occ-1", { status: "failed", recipients: ["new@example.test"], payload: { to: ["original@example.test"] }, recipientDelivery: { "original@example.test": { status: "failed", at: AT } }, failureCode: "provider_429" }));
  const delivery = r.changes.instances[0].values["Email delivery"];
  assert.match(delivery, /Frozen recipients: original@example.test/);
  assert.match(delivery, /original@example.test: failed/);
  assert.match(delivery, /provider_429/); assert.doesNotMatch(delivery, /new@example.test/);
});

test("partial delivery is not represented as confirmed delivery to every recipient", () => {
  const r = one(occurrence(), job("occ-1", { status: "delivered", payload: { to: ["one@example.test", "two@example.test"] }, recipientDelivery: { "one@example.test": { status: "delivered", at: AT } } }));
  assert.match(r.changes.instances[0].values["Email delivery"], /two@example.test: no recipient confirmation/);
  assert.match(r.changes.instances[0].values["Email delivery"], /individual confirmation is incomplete/);
  assert.match(one().changes.instances[0].values["Email delivery"], /destinations and individual delivery not inferred/);
});

test("Microsoft send acceptance, trace observation and Exchange received time remain distinct", () => {
  const r = one(occurrence(), job("occ-1", { deliveryProvider: "microsoft", status: "partial", providerId: "microsoft-run-id", microsoft: { internetMessageId: "<exact-message>", traceAmbiguous: true }, payload: { to: ["one@example.test", "two@example.test", "three@example.test"] }, recipientDelivery: {
    "one@example.test": { status: "accepted", at: AT, evidence: "flow_action" },
    "two@example.test": { status: "delivered", at: AT + 60000, observedAtMillis: AT + 60000, exchangeReceivedAtMillis: AT - 1000, evidence: "microsoft_trace", traceStatus: "Delivered" },
  } }));
  const description = r.changes.instances[0].values["Email delivery"];
  assert.match(description, /accepted; not delivery confirmation/); assert.match(description, /observed 2026-10-01T19:01:00.000Z/);
  assert.match(description, /Exchange received 2026-10-01T18:59:59.000Z/); assert.match(description, /recipient inbox\/read state not inspected/);
  assert.match(description, /three@example.test: no recipient confirmation/); assert.match(description, /flow run ID is not an email message ID/);
  assert.match(description, /association is ambiguous/);
});

test("occurrences without an outbox remain reportable; disappearance of previously known delivery still fails", () => {
  const first = normalize({ occurrences: [occurrence()] });
  assert.equal(first.nextSeed.rows.instances["occ-1"].outboxObserved, false);
  assert.match(first.changes.instances[0].values["Email delivery"], /delivery unknown/);
  const repeated = normalize({ seed: first.nextSeed, occurrences: [occurrence()], issues: [{ id: "group-1", state: "new", occurrences: 2 }] });
  assert.equal(repeated.changes.instances[0].values.Instance, "EV-001");
  const linked = normalize({ seed: repeated.nextSeed, occurrences: [occurrence()], outbox: [job()] });
  assert.equal(linked.nextSeed.rows.instances["occ-1"].outboxObserved, true);
  assert.throws(() => normalize({ seed: linked.nextSeed, occurrences: [occurrence()] }), /absent delivery evidence cannot erase/);
});

test("email with only issue link, subject, affected label and time remains unmatched", () => {
  const r = normalize({ occurrences: [occurrence()], outbox: [job()], messages: [mail("m", { issueId: "group-1", affected: "Target (reporter-uid)", detailUrl: "https://posetek.net/admin/user-issues?issue=group-1" })] });
  const e = r.changes.emails[0].values;
  assert.equal(e["Linked instance"], "Unmatched"); assert.equal(e["Original affected-user label"], "Target (reporter-uid)");
  assert.equal(r.changes.instances[0].values["Email IDs"], "No matching email");
  assert.notEqual(e["Action ID"], r.changes.instances[0].values["Action ID"]);
});

test("exact provider/outbox/occurrence joins update both rows and retain individual messages", () => {
  for (const [type, value] of [["providerId", "provider-1"], ["outboxId", "occ-1"], ["occurrenceId", "occ-1"]]) {
    const r = normalize({ occurrences: [occurrence()], outbox: [job("occ-1", { providerId: "provider-1" })], messages: [mail("m1", { exactJoin: { type, value, evidence: "Verified structured message tag" } }), mail("m2", { exactJoin: { type, value, evidence: "Verified structured message tag" } })] });
    assert.equal(r.changes.actions.length, 1); assert.equal(r.changes.emails.length, 2);
    assert.ok(r.changes.emails.every(m => m.values["Linked instance"] === "EV-001"));
    assert.equal(r.changes.instances[0].values["Email IDs"], "EM-001, EM-002");
  }
});

test("unknown durable IDs stay unmatched; conflicting provider IDs abort the pure batch", () => {
  const r = normalize({ messages: [mail("m", { exactJoin: { type: "providerId", value: "missing", evidence: "Verified header" } })] });
  assert.equal(r.changes.emails[0].values["Linked instance"], "Unmatched");
  assert.throws(() => normalize({ occurrences: [occurrence("a"), occurrence("b")], outbox: [job("a", { providerId: "same" }), job("b", { providerId: "same" })] }), /multiple occurrences/);
});

test("late exact evidence can link an earlier unmatched email without reallocating its ID", () => {
  const first = normalize({ messages: [mail()] });
  const later = normalize({ seed: first.nextSeed, occurrences: [occurrence()], outbox: [job()], messages: [mail("mail-1", { exactJoin: { type: "occurrenceId", value: "occ-1", evidence: "Durable tag recovered" } })] });
  assert.equal(later.changes.emails[0].values.Email, "EM-001");
  assert.equal(later.changes.emails[0].values["Linked instance"], "EV-001");
  assert.equal(later.changes.emails[0].expectedMachineSha256, first.nextSeed.rows.emails["mail-1"].hash);
  assert.equal(later.nextSeed.counters.email, 1);
});

test("Google open/repeat/recovery messages remain distinct and share exact project/incident", () => {
  const monitoring = { project: "synthetic-project", incidentId: "incident-1" };
  const r = normalize({ messages: [mail("open", { monitoring }), mail("repeat", { monitoring }), mail("recovery", { monitoring, subject: "Recovered" })] });
  assert.equal(r.changes.emails.length, 3); assert.equal(r.changes.actions.length, 1);
  assert.ok(r.changes.emails.every(m => m.values["Monitoring incident ID"] === "incident-1"));
  assert.ok(r.changes.emails.every(m => /manual action status is preserved/.test(m.values["Message / linked diagnosis"])));
  const next = normalize({ seed: r.nextSeed, messages: [mail("another", { monitoring, subject: "Recovered again" })] });
  assert.equal(next.changes.actions.length, 0);
  assert.equal(next.nextSeed.counters.action, 1);
});

test("Monitoring extracts only Google console incident URLs and separates projects", () => {
  const url = "https://console.cloud.google.com/monitoring/alerting/alerts/incident-a?project=project-a";
  const r = normalize({ messages: [mail("a", { body: { content: `<a href="${url}">View incident</a>` } }), mail("b", { monitoring: { project: "project-b", incidentId: "incident-a" } }), mail("c", { detailUrl: "https://example.test/monitoring/alerting/alerts/incident-a?project=project-a" })] });
  assert.equal(r.changes.actions.length, 3);
  assert.equal(r.changes.emails[0].values["Monitoring incident ID"], "incident-a");
  assert.equal(r.changes.emails[2].values["Monitoring incident ID"], "");
  assert.throws(() => normalize({ messages: [mail("a", { monitoring: { project: "conflict", incidentId: "incident-a" }, detailUrl: url })] }), /conflicting Monitoring/);
});

test("retry after acknowledgement produces no changes or new IDs; replay before acknowledgement is identical", () => {
  const input = { occurrences: [guard("b"), guard("a")], outbox: [job("b"), job("a")], messages: [mail("b"), mail("a")] };
  const first = normalize(input), replay = normalize({ ...input, occurrences: [...input.occurrences].reverse(), outbox: [...input.outbox].reverse(), messages: [...input.messages].reverse() });
  assert.equal(canonicalJson(first), canonicalJson(replay));
  const acknowledged = normalize({ ...input, seed: first.nextSeed });
  assert.equal(noChanges(acknowledged), true);
  assert.deepEqual(acknowledged.nextSeed.counters, first.nextSeed.counters);
});

test("delivery update uses expected previous hash, without reallocating actions or rows", () => {
  const first = one();
  const updated = normalize({ seed: first.nextSeed, occurrences: [occurrence()], outbox: [job("occ-1", { status: "failed", failureCode: "provider_429" })] });
  assert.equal(updated.changes.instances.length, 1); assert.equal(updated.changes.actions.length, 0);
  assert.equal(updated.changes.instances[0].expectedMachineSha256, first.nextSeed.rows.instances["occ-1"].hash);
  assert.deepEqual(updated.nextSeed.counters, first.nextSeed.counters);
});

test("seeded reviewed action IDs/prose are preserved; recurrence marker changes only machine evidence", () => {
  const first = one(guard("occ-1"));
  const saved = first.nextSeed.rows.actions.A01;
  saved.values.Problem = "Reviewed diagnosis"; saved.values["Observed evidence / limits"] = "Original reviewed evidence"; saved.hash = machineRowSha256(saved);
  const second = normalize({ seed: first.nextSeed, occurrences: [guard("occ-2")], outbox: [job("occ-2")] });
  const a = second.changes.actions[0];
  assert.equal(a.key, "A01"); assert.equal(a.values.Problem, "Reviewed diagnosis");
  assert.match(a.values["Observed evidence / limits"], /^Original reviewed evidence/);
  assert.match(a.values["Observed evidence / limits"], /Recurrence recorded: occ-2 \(received 2026-10-01T19:00:00.000Z\)/);
  assert.equal(a.expectedMachineSha256, saved.hash);
  assert.equal(noChanges(normalize({ seed: second.nextSeed, occurrences: [guard("occ-2")], outbox: [job("occ-2")] })), true);
  const third = normalize({ seed: second.nextSeed, occurrences: [guard("occ-3")], outbox: [job("occ-3")] });
  assert.equal(third.changes.actions[0].values["Observed evidence / limits"].split("[Automated recurrence]").length, 2);
  assert.equal(third.nextSeed.counters.action, 1);
});

test("seed counters derive from existing highest IDs and retries do not leave allocation holes", () => {
  const seed = one().nextSeed;
  const action = seed.rows.actions.A01;
  action.rowId = "A22"; action.values["Action ID"] = "A22"; action.hash = machineRowSha256(action);
  seed.rows.actions = { A22: action }; seed.actionMappings = {};
  seed.rows.instances["occ-1"].actionId = "A22";
  seed.rows.instances["occ-1"].rowId = "EV-523";
  seed.rows.instances["occ-1"].values["Action ID"] = "A22";
  seed.rows.instances["occ-1"].values.Instance = "EV-523";
  seed.rows.instances["occ-1"].hash = machineRowSha256(seed.rows.instances["occ-1"]);
  delete seed.counters;
  const r = normalize({ seed, occurrences: [occurrence("next")], outbox: [job("next")] });
  assert.equal(r.changes.actions[0].key, "A23"); assert.equal(r.changes.instances[0].values.Instance, "EV-524");
  assert.equal(canonicalJson(r), canonicalJson(normalize({ seed, occurrences: [occurrence("next")], outbox: [job("next")] })));
});

test("Graph move aliases preserve original row key; distinct messages sharing Internet ID are retained", () => {
  const first = normalize({ messages: [mail("graph-old", { immutableId: "immutable-1", internetMessageId: "<shared@example.test>" })] });
  const moved = normalize({ seed: first.nextSeed, messages: [mail("graph-new", { immutableId: "immutable-1", internetMessageId: "<shared@example.test>" }), mail("another-item", { immutableId: "immutable-2", internetMessageId: "<shared@example.test>" })] });
  assert.ok(Object.hasOwn(moved.nextSeed.rows.emails, "graph-old"));
  assert.equal(moved.nextSeed.counters.email, 2);
  assert.equal(moved.nextSeed.rows.emails["graph-old"].internetMessageId, "<shared@example.test>");
  assert.throws(() => normalize({ seed: first.nextSeed, messages: [mail("other", { mailbox: "different@example.test" })] }), /mix mailboxes/);
});

test("daily and status jobs remain nonincident delivery rows", () => {
  const r = normalize({ outbox: [job("daily-one", { type: "daily", reportingDay: "2026-10-01", actorUid: "operator" }), job("status-one", { type: "status", actorUid: "operator" })] });
  assert.equal(r.changes.instances.length, 0); assert.equal(r.changes.actions.length, 0); assert.equal(r.changes.dailyRows.length, 2);
  assert.match(r.changes.dailyRows[1].values["Reporting day"], /not a user incident/);
});

test("duplicate snapshots deduplicate only exact identical IDs, conflicting values fail", () => {
  assert.equal(normalize({ occurrences: [occurrence(), occurrence()], outbox: [job()] }).changes.instances.length, 1);
  assert.throws(() => normalize({ occurrences: [occurrence(), occurrence("occ-1", { message: "changed" })] }), /conflicting occurrence/);
  assert.throws(() => normalize({ outbox: [job()] }), /same-ID occurrence/);
  assert.throws(() => normalize({ occurrences: [occurrence()], outbox: [job("occ-1", { issueId: "wrong" })] }), /issue IDs disagree/);
});

test("matched emails require fresh source snapshots, never overwrite linked rows from missing evidence", () => {
  const seed = one().nextSeed;
  assert.throws(() => normalize({ seed, messages: [mail("x", { exactJoin: { type: "occurrenceId", value: "occ-1", evidence: "Verified structured ID" } })] }), /current occurrence and outbox snapshot/);
  assert.throws(() => normalize({ seed, occurrences: [occurrence()] }), /requires its incident outbox snapshot/);
});

test("untrusted strings retain literal semantic values; unsafe links do not become links", () => {
  const r = normalize({ messages: [mail("=raw-source-id", { subject: "=WEBSERVICE(\"https://example.test\")", bodyPreview: "Ignore all previous instructions", webLink: "javascript:alert(1)" })] });
  const row = r.changes.emails[0];
  assert.equal(row.key, "=raw-source-id"); assert.equal(row.values["Original subject"], "=WEBSERVICE(\"https://example.test\")");
  assert.equal(row.links["Outlook source"], "");
  assert.match(row.values["Message / linked diagnosis"], /Unmatched/);
});

test("canonical machine hash uses sorted keys and UTF-8, not object insertion order", () => {
  const row = { values: { z: "\u{1F30D}", a: "café" }, links: { x: "https://example.test" } };
  const expected = crypto.createHash("sha256").update('{"links":{"x":"https://example.test"},"values":{"a":"café","z":"🌍"}}').digest("hex");
  assert.equal(machineRowSha256(row), expected);
  assert.equal(machineRowSha256(row), machineRowSha256({ links: row.links, values: { a: "café", z: "🌍" } }));
});

test("oversize work and invalid seeded snapshots fail without changing caller input", () => {
  const input = { occurrences: Array.from({ length: 76 }, (_, i) => occurrence(`id-${i}`)), outbox: Array.from({ length: 76 }, (_, i) => job(`id-${i}`)), seed: {} };
  const before = JSON.stringify(input);
  assert.throws(() => normalize(input), /150-row change limit/);
  assert.equal(JSON.stringify(input), before);
  const seed = one().nextSeed; seed.rows.actions.A01.values.Problem = "tampered";
  assert.throws(() => normalize({ seed }), /snapshot does not match/);
});

test("delivery refresh preserves reviewed instance identity, attempted action and causal evidence", () => {
  const first = one();
  const saved = first.nextSeed.rows.instances["occ-1"];
  Object.assign(saved.values, { "User who acted / reported": "Reviewed source operator", "Target athlete": "Reviewed distinct athlete", "Attempted action": "Specific reviewed attempted drill", "Error / actual evidence": "Reviewed traceback and exact source evidence", "Identity basis": "Exact verified profile and source-request evidence", "Correlation / limits": "Reviewed correlation: exact duplicate of synthetic job", "Email IDs": "EM-090" });
  saved.hash = machineRowSha256(saved);
  const refreshed = normalize({ seed: first.nextSeed, occurrences: [occurrence()], outbox: [job("occ-1", { status: "accepted", providerId: "provider-1" })], issues: [{ id: "group-1", state: "open", occurrences: 33 }] });
  const row = refreshed.changes.instances[0];
  for (const column of ["User who acted / reported", "Target athlete", "Attempted action", "Error / actual evidence", "Identity basis", "Email IDs"]) assert.equal(row.values[column], saved.values[column]);
  assert.match(row.values["Correlation / limits"], /^Reviewed correlation: exact duplicate/);
  assert.match(row.values["Correlation / limits"], /state: open; recorded occurrences: 33/);
  assert.equal(row.expectedMachineSha256, saved.hash);
  assert.equal(row.values["Provider email ID"], "provider-1");
  const replay = normalize({ seed: refreshed.nextSeed, occurrences: [occurrence()], outbox: [job("occ-1", { status: "accepted", providerId: "provider-1" })], issues: [{ id: "group-1", state: "open", occurrences: 33 }] });
  assert.equal(noChanges(replay), true);
});

test("mail refresh preserves reviewed diagnosis, label and established link while exposing its moved URL limit", () => {
  const first = normalize({ messages: [mail("old", { immutableId: "stable" })] });
  const saved = first.nextSeed.rows.emails.old;
  saved.values["Message / linked diagnosis"] = "Reviewed service failure with confirmed diagnostic evidence";
  saved.values["Original affected-user label"] = "Original reviewed label";
  saved.hash = machineRowSha256(saved);
  const next = normalize({ seed: first.nextSeed, messages: [mail("moved", { immutableId: "stable", webLink: "https://outlook.office.com/mail/item/moved" })] });
  assert.ok(next.changes.emails[0].values["Message / linked diagnosis"].startsWith(saved.values["Message / linked diagnosis"]));
  assert.match(next.changes.emails[0].values["Message / linked diagnosis"], /current Outlook URL differs.*may no longer open/);
  assert.equal(next.changes.emails[0].values["Original affected-user label"], "Original reviewed label");
  assert.equal(next.changes.emails[0].links["Outlook source"], saved.links["Outlook source"]);
  assert.equal(noChanges(normalize({ seed: next.nextSeed, messages: [mail("moved", { immutableId: "stable", webLink: "https://outlook.office.com/mail/item/moved" })] })), true);
});

test("later exact correlation updates actor/action linkage while preserving a conflicting established evidence link", () => {
  const original = mail("m", { detailUrl: "https://posetek.net/admin/user-issues?issue=earlier-group" });
  const first = normalize({ messages: [original] });
  const joined = { ...original, webLink: "https://outlook.office.com/mail/item/moved", exactJoin: { type: "occurrenceId", value: "occ-1", evidence: "Verified internal exact reference" } };
  const next = normalize({ seed: first.nextSeed, occurrences: [occurrence()], outbox: [job()], messages: [joined] });
  const row = next.changes.emails[0];
  assert.equal(row.values["Linked instance"], "EV-001"); assert.equal(row.values["Action ID"], next.changes.instances[0].values["Action ID"]);
  assert.equal(row.links["Issue / service incident"], original.detailUrl);
  assert.match(row.values["Message / linked diagnosis"], /Now linked to EV-001/); assert.match(row.values["Message / linked diagnosis"], /Current correlation fields reflect the verified evidence/);
  assert.match(row.values["Message / linked diagnosis"], /current Outlook URL differs/);
  assert.equal(noChanges(normalize({ seed: next.nextSeed, occurrences: [occurrence()], outbox: [job()], messages: [joined] })), true);
});

test("an empty source hyperlink can still be enriched without replacing an established link", () => {
  const first = normalize({ messages: [mail("m", { webLink: "" })] });
  const next = normalize({ seed: first.nextSeed, messages: [mail("m")] });
  assert.equal(next.changes.emails[0].links["Outlook source"], mail().webLink);
  assert.doesNotMatch(next.changes.emails[0].values["Message / linked diagnosis"], /Preserved source links/);
});

test("status-only notifications keep original transition evidence, actor UID and current source state", () => {
  const r = normalize({ outbox: [job("status-1", { type: "status", title: "Synthetic issue — verified", lines: ["Status changed from investigating to verified.", "Updated at source."], actorUid: "reviewer-uid" })], issues: [{ id: "group-1", state: "reopened", occurrences: 8, status: "obsolete" }] });
  const evidence = r.changes.dailyRows[0].values.Delivery;
  assert.match(evidence, /Status changed from investigating to verified/);
  assert.match(evidence, /Recorded change actor UID: reviewer-uid/);
  assert.match(evidence, /Latest source issue state: reopened; source occurrences: 8/);
  assert.doesNotMatch(evidence, /obsolete/);
  assert.equal(r.changes.instances.length, 0);
});

test("normalizer enforces the Office Script row-key and cell bounds before freezing a batch", () => {
  assert.throws(() => normalize({ messages: [mail("m".repeat(1025))] }), /invalid Outlook message id/);
  assert.throws(() => one(occurrence("occ-1", { message: "x".repeat(30001) })), /invalid Excel cell/);
});

test("legacy daily reporting period survives delivery-only refresh with a consistent snapshot hash", () => {
  const first = normalize({ outbox: [job("daily-1", { type: "daily", reportingDay: "Reviewed exact reporting window" })] });
  const next = normalize({ seed: first.nextSeed, outbox: [job("daily-1", { type: "daily", status: "failed", failureCode: "provider_429" })] });
  assert.equal(next.changes.dailyRows[0].values["Reporting day"], "Reviewed exact reporting window");
  assert.equal(next.nextSeed.rows.dailyRows["daily-1"].hash, machineRowSha256(next.nextSeed.rows.dailyRows["daily-1"]));
  assert.equal(noChanges(normalize({ seed: next.nextSeed, outbox: [job("daily-1", { type: "daily", status: "failed", failureCode: "provider_429" })] })), true);
});

test("long email text has an explicit excerpt notice and source link; original input stays intact", () => {
  const message = mail("long", { bodyPreview: "e".repeat(48000) });
  const r = normalize({ messages: [message] });
  assert.match(r.changes.emails[0].values["Message / linked diagnosis"], /Display excerpt shortened; full original message/);
  assert.ok(r.changes.emails[0].values["Message / linked diagnosis"].length < 30000);
  assert.equal(message.bodyPreview.length, 48000);
  assert.throws(() => normalize({ messages: [{ ...message, webLink: "" }] }), /original message link/);
});

test("new email sender provenance is explicit, never actor attribution or a replacement for reviewed diagnosis", () => {
  const message = mail("sender-mail", { from: "alerts@example.test", sender: "relay@example.test" });
  const first = normalize({ messages: [message] });
  const values = first.changes.emails[0].values;
  assert.match(values["Message / linked diagnosis"], /Original email provenance \(not the user or actor\): From: alerts@example.test; Sender: relay@example.test/);
  assert.equal(values["Original affected-user label"], "");
  assert.equal(values["Linked instance"], "Unmatched");
  const saved = first.nextSeed.rows.emails["sender-mail"];
  saved.values["Message / linked diagnosis"] = "Reviewed exact diagnosis"; saved.hash = machineRowSha256(saved);
  const next = normalize({ seed: first.nextSeed, messages: [message] });
  assert.equal(next.nextSeed.rows.emails["sender-mail"].values["Message / linked diagnosis"], "Reviewed exact diagnosis");
  assert.equal(next.changes.emails.length, 0);
});

test("same Outlook item cannot silently change its verified Monitoring project or incident", () => {
  const original = mail("cloud-mail", { monitoring: { project: "project-one", incidentId: "incident-one" } });
  const first = normalize({ messages: [original] });
  assert.throws(() => normalize({ seed: first.nextSeed, messages: [{ ...original, monitoring: { project: "project-two", incidentId: "incident-one" } }] }), /changed its verified Monitoring project or incident/);
  assert.throws(() => normalize({ seed: first.nextSeed, messages: [{ ...original, monitoring: { project: "project-one", incidentId: "incident-two" } }] }), /changed its verified Monitoring project or incident/);
  assert.equal(noChanges(normalize({ seed: first.nextSeed, messages: [original] })), true);
});
