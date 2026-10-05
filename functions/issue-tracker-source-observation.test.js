"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const N = require("./issue-tracker-normalize"), O = require("./user-issue-observations"), M = require("./user-issue-model");
const AT = Date.parse("2026-10-03T02:00:00Z");
function event(patch = {}) {
  return { id: "event", eventId: "event", sessionId: "session", requestId: "request", kind: "error", source: "client", reporterUid: "staff",
    operation: "getSocialFeed", code: "unavailable", platform: "web", build: "web-v1", device: "browser", route: "/feed", occurredAtMillis: AT, receivedAtMillis: AT,
    player: { id: "target", name: "Target athlete" }, ...patch };
}
function normalized(original, summary = O.initialSummary(original)) { return N.normalize({ occurrences: [{ ...original, sourceObservationSummary: summary }] }); }
function row(original, summary) { return normalized(original, summary).changes.instances[0].values; }
test("source observations accept the same 160-character target ID contract as intake", () => {
  for (const length of [129, 160]) {
    const original = event({ player: { id: "p".repeat(length), name: "Long target" } });
    assert.equal(M.ID.test(original.player.id), true);
    const values = row(original); assert.equal(values["Target player ID"], original.player.id); assert.equal(values["Recorded actor UID"], "staff");
  }
});
test("oversized and invalid observation target IDs fail rather than bypass the shared ID validator", () => {
  for (const id of ["p".repeat(161), "target/invalid", "target with spaces", 123]) {
    const original = event(), summary = O.initialSummary(original); summary.evidence[0].player.id = id;
    assert.throws(() => normalized(original, summary), /invalid server source-observation evidence/);
  }
});
test("one unknown service source never claims an authenticated account or request", () => {
  const values = row(event({ source: "cloudLogging", platform: "backend", reporterUid: null, requestId: null, player: null, device: "server" }));
  assert.match(values["Correlation / limits"], /One retained original source observation/);
  assert.match(values["Correlation / limits"], /No authenticated account is recorded; the original operator remains unverified/);
  assert.doesNotMatch(values["Correlation / limits"], /same authenticated request/);
  assert.match(values["User who acted / reported"], /Unknown actor/);
});
test("one generic diagnostic upload keeps its operator and diagnostic subtype explicitly unknown", () => {
  const values = row(event({ source: "failureCases", operation: "system_diagnostic", kind: "interrupted", reporterUid: null, requestId: null, player: null }));
  assert.match(values["Correlation / limits"], /diagnostic uploaded; subtype unknown/);
  assert.match(values["Correlation / limits"], /original operator remains unverified/);
  assert.doesNotMatch(values["Correlation / limits"], /same authenticated request/);
  assert.match(values["User who acted / reported"], /Unknown actor/);
});
test("one recorded account is distinguished from the target without claiming source corroboration", () => {
  const values = row(event()); assert.match(values["Correlation / limits"], /One retained original source observation; no additional source corroboration is claimed/);
  assert.match(values["Correlation / limits"], /recorded account UID is available; it is separate from the target athlete/);
  assert.doesNotMatch(values["Correlation / limits"], /corroborate the same authenticated request/);
  assert.equal(values["Recorded actor UID"], "staff"); assert.equal(values["Target player ID"], "target");
});
test("two strict exact account/request observations can claim authenticated request corroboration", () => {
  const original = event(), next = { ...original, source: "cloudLogging", platform: "backend", device: "server", eventId: "server-event" };
  const values = row(original, O.appendSummary({ ...original, sourceObservationSummary: O.initialSummary(original) }, next));
  assert.match(values["Correlation / limits"], /2 retained source observations corroborate the same authenticated request/);
  for (const field of ["actorUid", "requestId"]) {
    const summary = O.appendSummary(original, next); summary.evidence[1][field] = "different";
    assert.throws(() => normalized(original, summary), /invalid server source-observation evidence/);
  }
});
test("multiple anonymous observations reference a request without implying authentication or a known operator", () => {
  const original = event({ reporterUid: null }), summary = O.appendSummary(original, { ...original, source: "cloudLogging", eventId: "second" });
  const values = row(original, summary); assert.match(values["Correlation / limits"], /associated with the recorded request reference; the original operator remains unverified/);
  assert.doesNotMatch(values["Correlation / limits"], /same authenticated request/);
  const noRequest = event({ requestId: null }), missing = row(noRequest, O.appendSummary(noRequest, { ...noRequest, eventId: "second" }));
  assert.match(missing["Correlation / limits"], /No valid exact request reference is recorded/); assert.doesNotMatch(missing["Correlation / limits"], /same authenticated request/);
});
test("corroborating conflicting targets/actions retain separate source context and canonical identity", () => {
  const original = event(), next = { ...original, source: "cloudLogging", eventId: "second", operation: "differentAction", player: { id: "other-target", name: "Other athlete" } };
  const values = row(original, O.appendSummary(original, next));
  assert.equal(values["Recorded actor UID"], original.reporterUid); assert.equal(values["Target player ID"], original.player.id);
  assert.equal(values["Attempted action"], "Recorded operation: getSocialFeed");
  assert.match(values["Correlation / limits"], /conflicting evidence: attempted_action, target_athlete/); assert.match(values["Correlation / limits"], /Other athlete \(other-target\)/);
});
