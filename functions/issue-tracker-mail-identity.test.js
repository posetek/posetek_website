"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const I = require("./issue-tracker-mail-identity"), M = require("./issue-tracker-bridge-model");
const { createGraphReader } = require("./issue-tracker-graph-reader");
const { createMailCapture } = require("./issue-tracker-mail-capture");
const { normalizeIssueTracker: normalize, machineRowSha256 } = require("./issue-tracker-normalize");
const { mailIdentityBinding, createMailIdentityProxyTransport } = require("./issue-tracker-mail-identity-proxy");
const { TENANT, CLIENT, CALLER, endpointHash } = require("./issue-tracker-mail-read-proxy");
const { FakeFirestore } = require("./test-support/fake-firestore");
const AT = Date.parse("2026-10-02T00:30:00Z"), UUID = "11111111-2222-4333-8444-555555555555";
const ENDPOINT = "https://test.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/1234567890abcdef1234567890abcdef/triggers/manual/paths/invoke?api-version=1";
const proof = (sourceId, canonicalId = "canonical", sourceIdType = "restId") => I.itemIdentity({ sourceId, canonicalId, sourceIdType, responseSha256: "a".repeat(64) });
const graphMail = (id, patch = {}) => ({ id, subject: "PoseTek error", receivedDateTime: new Date(AT).toISOString(), internetMessageId: "<synthetic@example.test>", body: { contentType: "html", content: "Recorded failure" }, ...patch });
const mail = (id, patch = {}) => ({ mailbox: I.MAILBOX, originalId: id, receivedDateTime: new Date(AT).toISOString(), internetMessageId: "<synthetic@example.test>", subject: "PoseTek error", body: { contentType: "html", content: "Recorded failure" }, webLink: `https://outlook.office.com/mail/item/${id}`, ...patch });
const noChanges = result => Object.values(result.changes).every(rows => !rows.length);
function repair() { return mail("canonical", { immutableId: "canonical", itemIdentity: proof("legacy"), aliases: ["legacy", "alternate"], aliasReconciliation: { schemaVersion: 1, canonicalId: "canonical", primaryId: "legacy", retainedIds: ["legacy", "alternate"], proofSha256: "b".repeat(64), evidenceRef: "c".repeat(64) } }); }
function settings() { return { mailbox: I.MAILBOX, mailIdentityProvider: "power_automate", mailIdentityProxyVerified: true, mailIdentityProxyProof: {
  schemaVersion: 1, verified: true, authorization: "delegated_translation_route", tenantId: TENANT, clientId: CLIENT, callerObjectId: CALLER,
  connectionAccount: I.MAILBOX, flowId: UUID, connectionName: "shared-webcontents-" + UUID, graphResource: "https://graph.microsoft.com",
  targetIdType: "restImmutableEntryId", endpointSha256: endpointHash(ENDPOINT), exportSha256: "a".repeat(64) } }; }

test("translation validates every original ID; missing, duplicate, partial and errored results fail", () => {
  const request = I.translationRequest(["one", "two"], "restId");
  assert.deepEqual([...I.translationResult(request, { value: [{ sourceId: "two", targetId: "same" }, { sourceId: "one", targetId: "same" }] })], [["two", "same"], ["one", "same"]]);
  for (const value of [[], [{ sourceId: "one", targetId: "x" }], [{ sourceId: "one", targetId: "x" }, { sourceId: "one", targetId: "y" }], [{ sourceId: "one", targetId: "x" }, { sourceId: "two", errorDetails: { code: "not_found" } }], [{ sourceId: "unknown", targetId: "x" }, { sourceId: "two", targetId: "y" }]]) assert.throws(() => I.translationResult(request, { value }), { code: "tracker_graph_invalid_translation_response" });
  for (const ids of [[], ["a", "a"], ["\n"], Array.from({ length: 101 }, (_, n) => String(n))]) assert.throws(() => I.translationRequest(ids, "restId"));
  assert.throws(() => I.translationResult({ ...request, targetIdType: "restId" }, { value: [] }));
});

test("Graph collection and arrival use explicit source types and exact canonical item proofs", async () => {
  const reads = [], translations = [];
  const reader = createGraphReader({ requestJson: async (url) => { reads.push(url); return url.includes("/messages/") ? graphMail("legacy") : { value: [graphMail("legacy"), graphMail("different")] }; }, translateIds: async body => { translations.push(body); return { value: body.inputIds.map(sourceId => ({ sourceId, targetId: sourceId + "-immutable" })) }; } });
  const page = await reader.page({ since: "2026-10-02T00:00:00Z", until: "2026-10-02T01:00:00Z" });
  assert.equal(translations.length, 1); assert.deepEqual(translations[0].inputIds, ["legacy", "different"]); assert.equal(translations[0].sourceIdType, "restId");
  assert.equal(page.records[0].id, "legacy-immutable"); assert.equal(page.records[0].itemIdentity.sourceId, "legacy");
  const item = await reader.canonicalMessage("legacy"); assert.equal(item.id, "legacy-immutable"); assert.equal(item.itemIdentity.sourceId, "legacy");
  const immutable = await reader.canonicalMessage("already-immutable", { sourceIdType: "restImmutableEntryId" });
  assert.equal(translations.at(-1).sourceIdType, "restImmutableEntryId"); assert.equal(immutable.itemIdentity.sourceId, "already-immutable");
});

test("ignored Prefer GET preserves raw identity and cannot certify or trust supplied aliases", async () => {
  const graph = createGraphReader({ requestJson: async () => graphMail("legacy") });
  const original = await graph.canonicalMessage("legacy"); assert.equal(original.itemIdentity, undefined); assert.equal(original.itemIdentityPending, true);
  let queued;
  const capture = createMailCapture({ db: new FakeFirestore(), graph, bridge: { enqueueMessage: async value => { queued = value; return { ticket: "t" }; } } });
  await capture.capture(original, { aliases: ["forged-other-item"] });
  assert.equal(queued.immutableId, undefined); assert.deepEqual(queued.aliases, []); assert.equal(queued.originalId, "legacy");
  await assert.rejects(capture.verifiedAliases(["legacy"]), { code: "tracker_mail_identity_unverified" });
});

test("authoritative group proof refuses Internet-ID similarity alone and different exact translations", () => {
  const items = ["legacy", "alternate"].map(requestedId => ({ requestedId, itemIdentity: proof(requestedId), mail: graphMail("canonical") }));
  const group = I.aliasGroupProof(items); assert.deepEqual(I.verifyAliasGroup(group), group);
  assert.throws(() => I.aliasGroupProof(items.map(item => ({ ...item, itemIdentity: undefined }))), { code: "tracker_alias_group_unverified" });
  assert.throws(() => I.aliasGroupProof([items[0], { ...items[1], itemIdentity: proof("alternate", "different") }]), { code: "tracker_alias_group_unverified" });
  assert.throws(() => I.verifyAliasGroup({ ...group, ids: ["different", "legacy"] }), { code: "tracker_alias_group_unverified" });
});

test("seeded aliases stay distinct without a proof; audited repair retains every row, action, original link and ID", () => {
  const seed = normalize({ messages: [mail("legacy"), mail("alternate")] }).nextSeed, before = structuredClone(seed);
  assert.throws(() => normalize({ seed, messages: [mail("canonical", { aliases: ["legacy", "alternate"] })] }), /bridge distinct seeded messages/);
  const result = normalize({ seed, messages: [repair()] });
  for (const id of ["legacy", "alternate"]) {
    assert.equal(result.nextSeed.rows.emails[id].rowId, before.rows.emails[id].rowId);
    assert.equal(result.nextSeed.rows.emails[id].values["Outlook message ID"], id);
    assert.deepEqual(result.nextSeed.rows.emails[id].links, before.rows.emails[id].links);
  }
  assert.match(result.nextSeed.rows.emails.alternate.values["Message / linked diagnosis"], /Verified Outlook alias capture/);
  assert.equal(result.nextSeed.rows.emails.alternate.actionId, before.rows.emails.alternate.actionId);
  assert.match(result.nextSeed.rows.actions[before.rows.emails.alternate.actionId].values["Recommended next step"], /canonical action/);
  assert.equal(Object.keys(result.nextSeed.rows.emails).length, 2); assert.equal(result.nextSeed.counters.email, 2);
  assert.equal(result.nextSeed.emailAliases[M.digest([I.MAILBOX, "alternate"])], "alternate");
  assert.ok(noChanges(normalize({ seed: result.nextSeed, messages: [repair()] })));
  assert.equal(Object.hasOwn(result.changes.actions[0].values, "Status"), false);
  assert.deepEqual(I.emailRecordCounts({ ...result.nextSeed, counts: { emails: 2, actions: 2 } }), { emailRecords: 2, provenAliasRows: 1, canonicalEmailRecords: 1, provenAliasGroups: 1, actionRecords: 2, provenAliasActions: 1, canonicalActionRecords: 1 });
});

test("proven canonical replay allocates nothing; same Internet-ID distinct physical messages remain independent", () => {
  const first = normalize({ messages: [mail("legacy"), mail("alternate")] }), repaired = normalize({ seed: first.nextSeed, messages: [repair()] });
  const replay = normalize({ seed: repaired.nextSeed, messages: [mail("canonical", { immutableId: "canonical", itemIdentity: proof("canonical", "canonical", "restImmutableEntryId") })] });
  assert.equal(replay.nextSeed.counters.email, 2); assert.equal(Object.keys(replay.nextSeed.rows.emails).length, 2);
  const distinct = normalize({ seed: repaired.nextSeed, messages: [mail("separate", { immutableId: "separate", itemIdentity: proof("separate", "separate") })] });
  assert.equal(distinct.nextSeed.counters.email, 3);
});

test("repair plus both source snapshots coalesces only proven aliases and keeps initial expected machine hash", () => {
  const seed = normalize({ messages: [mail("legacy"), mail("alternate")] }).nextSeed;
  const next = normalize({ seed, messages: [mail("alternate"), repair(), mail("legacy")] });
  assert.equal(new Set(next.changes.emails.map(row => row.key)).size, next.changes.emails.length);
  for (const row of next.changes.emails) assert.equal(row.expectedMachineSha256, seed.rows.emails[row.key].hash);
  assert.equal(next.nextSeed.counters.email, 2);
  assert.throws(() => normalize({ seed: next.nextSeed, messages: [{ ...repair(), aliasReconciliation: { ...repair().aliasReconciliation, primaryId: "alternate" } }] }), /frozen group/);
});

test("translation proxy binds tenant, connection user, endpoint, exact response and settings throughout", async () => {
  const config = settings(); let calls = 0;
  const args = { configuration: async () => config, endpoint: async () => ENDPOINT, identity: async () => ({ tenantId: TENANT, clientId: CLIENT }),
    getAccessToken: async () => "synthetic-token", randomId: () => UUID, fetchImpl: async (_, options) => {
      calls++; const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body).sort(), ["inputIds", "requestId", "schemaVersion", "sourceIdType", "targetIdType"]);
      return { status: 200, json: async () => ({ schemaVersion: 1, requestId: UUID, mailbox: I.MAILBOX, mailboxUser: { id: UUID, userPrincipalName: I.MAILBOX }, graphStatus: 200,
        sourceIdType: body.sourceIdType, targetIdType: body.targetIdType, data: { value: body.inputIds.map(sourceId => ({ sourceId, targetId: "canonical" })) } }) };
    } };
  const request = I.translationRequest(["legacy"], "restId");
  assert.ok(mailIdentityBinding(config)); assert.equal((await createMailIdentityProxyTransport(args)(request)).value[0].targetId, "canonical");
  config.mailIdentityProxyProof.endpointSha256 = "b".repeat(64); await assert.rejects(createMailIdentityProxyTransport(args)(request), { code: "tracker_mail_identity_not_configured" }); assert.equal(calls, 1);
});

test("translation refuses wrong connection user, partial errors, asynchronous replies and binding changes", async () => {
  const request = I.translationRequest(["opaque/base64+id=="], "restId");
  for (const change of [value => { value.mailboxUser.userPrincipalName = "another@example.test"; }, value => { value.data.value[0].errorDetails = { code: "invalid_id" }; }, value => { value.requestId = "stale"; }, value => { value.graphStatus = 202; }, value => { value.sourceIdType = "restImmutableEntryId"; }]) {
    const config = settings();
    const transport = createMailIdentityProxyTransport({ configuration: async () => config, endpoint: async () => ENDPOINT, identity: async () => ({ tenantId: TENANT, clientId: CLIENT }), getAccessToken: async () => "synthetic-token", randomId: () => UUID,
      fetchImpl: async () => ({ status: 200, json: async () => { const value = { schemaVersion: 1, requestId: UUID, mailbox: I.MAILBOX, mailboxUser: { id: UUID, userPrincipalName: I.MAILBOX }, graphStatus: 200, sourceIdType: "restId", targetIdType: "restImmutableEntryId", data: { value: [{ sourceId: request.inputIds[0], targetId: "canonical" }] } }; change(value); return value; } }) });
    await assert.rejects(transport(request));
  }
  const config = settings();
  const transport = createMailIdentityProxyTransport({ configuration: async () => config, endpoint: async () => ENDPOINT, identity: async () => ({ tenantId: TENANT, clientId: CLIENT }), getAccessToken: async () => "synthetic-token", randomId: () => UUID,
    fetchImpl: async () => { config.mailIdentityProxyProof.exportSha256 = "b".repeat(64); return { status: 200, json: async () => ({ schemaVersion: 1, requestId: UUID, mailbox: I.MAILBOX, mailboxUser: { id: UUID, userPrincipalName: I.MAILBOX }, graphStatus: 200, sourceIdType: "restId", targetIdType: "restImmutableEntryId", data: { value: [{ sourceId: request.inputIds[0], targetId: "canonical" }] } }) }; } });
  await assert.rejects(transport(request), { code: "tracker_capture_configuration_changed" });
});

test("configured Office365 reads inject only verified translator and canonical binding is part of capture guard", async () => {
  const { createConfiguredMailReader, mailReadBinding } = require("./issue-tracker-mail-read-proxy");
  const config = { ...settings(), mailReadProvider: "power_automate", mailReadProxyVerified: true, mailReadProxyProof: { schemaVersion: 1, verified: true, authorization: "delegated_proxy_route", tenantId: TENANT, clientId: CLIENT, callerObjectId: CALLER, connectionAccount: I.MAILBOX, flowId: UUID, connectionName: "shared-office365-" + UUID, endpointSha256: endpointHash(ENDPOINT), exportSha256: "a".repeat(64) } };
  let translated = 0;
  const reader = createConfiguredMailReader({ configuration: async () => config, graph: {}, proxyRequest: async () => graphMail("legacy"), translateIds: async request => { translated++; return { value: request.inputIds.map(sourceId => ({ sourceId, targetId: "canonical" })) }; } });
  const originalBinding = mailReadBinding(config), item = await reader.canonicalMessage("legacy");
  assert.equal(item.id, "canonical"); assert.equal(translated, 1); assert.equal(item.itemIdentity.sourceIdType, "restId");
  config.mailIdentityProxyProof.exportSha256 = "b".repeat(64); assert.notEqual(mailReadBinding(config), originalBinding);
  config.mailIdentityProxyVerified = false; assert.equal(mailReadBinding(config), null); await assert.rejects(reader.canonicalMessage("legacy"), { code: "tracker_mail_not_configured" });
});

test("identity activation flag defaults off and adds its missing secret only to the two mail readers when explicit", () => {
  const functions = require("firebase-functions/v1"), { createIssueTrackerBridgeEntrypoints } = require("./issue-tracker-bridge-entrypoints");
  const options = { normalize, taskQueue: { enqueue: async () => {} } }, admin = { firestore: () => new FakeFirestore() };
  const previousProject = process.env.GCLOUD_PROJECT; process.env.GCLOUD_PROJECT = "candidate-test-only";
  try {
  const off = createIssueTrackerBridgeEntrypoints(functions, admin, options), on = createIssueTrackerBridgeEntrypoints(functions, admin, { ...options, mailIdentityEnabled: true });
  const names = Object.keys(off);
  for (const name of names) {
    const before = off[name].__endpoint.secretEnvironmentVariables || [], after = on[name].__endpoint.secretEnvironmentVariables || [];
    if (["ingestUserIssueTrackerMail", "captureUserIssueTrackerSources"].includes(name)) {
      assert.equal(before.some(value => value.key === "ISSUE_TRACKER_MAIL_IDENTITY_FLOW_ENDPOINT"), false);
      assert.deepEqual(after.map(value => value.key), [...before.map(value => value.key), "ISSUE_TRACKER_MAIL_IDENTITY_FLOW_ENDPOINT"]);
    } else assert.deepEqual(after, before);
  }
  assert.throws(() => createIssueTrackerBridgeEntrypoints(functions, admin, { ...options, mailIdentityEnabled: "true" }), /identity_flag_required/);
  } finally { if (previousProject === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = previousProject; }
});

test("existing diagnostic and corroborated source context receive append-only annotations with original actor/target/action intact", () => {
  const event = { id: "event", source: "failureCases", kind: "interrupted", operation: "system_diagnostic", code: "system_diagnostic", reporterUid: "actor", requestId: "request", receivedAtMillis: AT };
  const first = normalize({ occurrences: [event] });
  const extra = require("./user-issue-observations").appendSummary(event, { ...event, source: "web_callable", operation: "rebuildInsightsReport", player: { id: "target", name: "Separate Athlete" }, platform: "web", device: "Browser context" });
  const result = normalize({ seed: first.nextSeed, occurrences: [{ ...event, sourceObservationSummary: extra }] });
  const before = first.nextSeed.rows.instances.event.values, after = result.nextSeed.rows.instances.event.values;
  for (const key of ["Target athlete", "Attempted action", "Recorded actor UID", "Target player ID", "Error / actual evidence"]) assert.equal(after[key], before[key]);
  assert.match(after["Correlation / limits"], /diagnostic uploaded; subtype unknown/); assert.match(after["Identity basis"], /conflicting evidence: attempted_action; additional verified context: target_athlete/); assert.match(after["Identity basis"], /Separate Athlete/);
  assert.equal(result.changes.instances[0].expectedMachineSha256, first.nextSeed.rows.instances.event.hash);
  assert.ok(noChanges(normalize({ seed: result.nextSeed, occurrences: [{ ...event, sourceObservationSummary: extra }] })));
});

test("A01 delivery review is bound to an existing email/action and appends modern guidance without erasing history", () => {
  const seed = normalize({ messages: [mail("historical")] }).nextSeed;
  seed.rows.actions.A01.values.Problem = "Restore email delivery"; seed.rows.actions.A01.hash = machineRowSha256(seed.rows.actions.A01);
  const review = { schemaVersion: 1, source: "posetek_server_issue_classifier", templateVersion: "microsoft-dylan-only-v1", primaryId: "historical", actionId: "A01",
    expectedProblemSha256: require("node:crypto").createHash("sha256").update("Restore email delivery").digest("hex"), reviewedAtMillis: AT,
    evidenceRef: "c".repeat(64), proofSha256: "b".repeat(64), legacyResendNeedsReview: 489, legacyUnassignedNeedsReview: 31, googleCloudDailySafetyCap: 20 };
  const message = mail("historical", { subject: "Internal recommendation review; not replacement mail", body: { contentType: "text", content: "The complete original mail remains in its archive." }, deliveryRecommendationReview: review }), result = normalize({ seed, messages: [message] });
  const before = seed.rows.actions.A01, after = result.nextSeed.rows.actions.A01;
  assert.equal(after.values.Problem, before.values.Problem); assert.ok(after.values["Recommended next step"].startsWith(before.values["Recommended next step"]));
  assert.match(after.values["Recommended next step"], /Microsoft Power Automate/); assert.match(after.values["Recommended next step"], /489 explicit historical Resend jobs and 31 unassigned/);
  assert.deepEqual(result.nextSeed.rows.emails.historical.values, seed.rows.emails.historical.values);
  assert.deepEqual(result.nextSeed.rows.emails.historical, seed.rows.emails.historical);
  assert.equal(result.changes.emails.length, 0);
  assert.equal(result.changes.actions[0].expectedMachineSha256, before.hash); assert.ok(noChanges(normalize({ seed: result.nextSeed, messages: [message] })));
  assert.throws(() => normalize({ seed, messages: [{ ...message, deliveryRecommendationReview: { ...review, expectedProblemSha256: "0".repeat(64) } }] }), /bind the verified existing action/);
  assert.throws(() => normalize({ seed, messages: [{ ...message, originalId: "another" }] }), /bind the verified existing action/);
});

test("internal review/alias proof needs complete authoritative archive and public payload cannot forge either", async () => {
  const { createIssueTrackerBridge, PATHS } = require("./issue-tracker-bridge"), { validMessage } = require("./issue-tracker-bridge-ingress");
  const db = new FakeFirestore({ [PATHS.settings]: { enabled: true, mailbox: I.MAILBOX } });
  const bridge = createIssueTrackerBridge({ db, normalize, transport: {}, scheduleTask: async () => {} });
  const message = repair();
  await assert.rejects(bridge.enqueueMessage(message, { schedule: false }), { code: "tracker_alias_group_unverified" });
  const { mailbox, ...publicPayload } = message; assert.equal(validMessage(publicPayload), false);
  await db.doc(`issueTrackerEvidence/${message.aliasReconciliation.evidenceRef}`).set({ complete: true, source: "outlook_alias_verification", sourceId: `${I.MAILBOX}/canonical`, sha256: message.aliasReconciliation.proofSha256 });
  assert.ok((await bridge.enqueueMessage(message, { schedule: false })).ticket);
  const review = { schemaVersion: 1, source: "posetek_server_issue_classifier", templateVersion: "microsoft-dylan-only-v1", primaryId: "historical", actionId: "A01", expectedProblemSha256: "a".repeat(64), reviewedAtMillis: AT,
    evidenceRef: "d".repeat(64), proofSha256: "e".repeat(64), legacyResendNeedsReview: 489, legacyUnassignedNeedsReview: 31, googleCloudDailySafetyCap: 20 };
  const historic = mail("historical", { deliveryRecommendationReview: review });
  await assert.rejects(bridge.enqueueMessage(historic, { schedule: false }), { code: "tracker_delivery_review_unverified" });
  await db.doc(`issueTrackerEvidence/${review.evidenceRef}`).set({ complete: true, source: "delivery_recommendation_review", sourceId: `${I.MAILBOX}/historical`, sha256: review.proofSha256 });
  await bridge.enqueueMessage(historic, { schedule: false });
  await bridge.enqueueMessage(mail("historical"), { schedule: false });
  const queue = (await db.collection(PATHS.queue).get()).docs.find(doc => doc.data().message.originalId === "historical");
  assert.deepEqual(queue.data().message.deliveryRecommendationReview, review);
});

test("partial translation never completes capture and proof hash stays stable when unrelated page items change", async () => {
  let ids = ["one", "two"], omit = false;
  const reader = createGraphReader({ requestJson: async () => ({ value: ids.map(id => graphMail(id)) }), translateIds: async request => ({ value: request.inputIds.filter(id => !omit || id !== "two").map(sourceId => ({ sourceId, targetId: sourceId + "-canonical" })) }) });
  const window = { since: "2026-10-02T00:00:00Z", until: "2026-10-02T01:00:00Z" };
  const first = await reader.page(window); ids = ["one", "three"];
  assert.deepEqual((await reader.page(window)).records[0].itemIdentity, first.records[0].itemIdentity);
  assert.equal(first.records[0].sourceMessage.id, "one"); ids = ["one", "two"]; omit = true;
  await assert.rejects(reader.page(window), { code: "tracker_graph_invalid_translation_response" });
});

test("corroboration rejects a different authenticated actor and preserves explicit target conflicts", () => {
  const event = { id: "event", source: "cloud_log", kind: "error", operation: "rebuildInsightsReport", reporterUid: "actor", requestId: "request", player: { id: "target-a", name: "Original Athlete" }, receivedAtMillis: AT };
  const summary = require("./user-issue-observations").appendSummary(event, { ...event, source: "web_callable", player: { id: "target-b", name: "Different Athlete" } });
  const result = normalize({ occurrences: [{ ...event, sourceObservationSummary: summary }] });
  assert.equal(result.changes.instances[0].values["Target athlete"], "Original Athlete (target-a)"); assert.match(result.changes.instances[0].values["Correlation / limits"], /conflicting evidence: target_athlete/);
  summary.evidence[1].actorUid = "other"; assert.throws(() => normalize({ occurrences: [{ ...event, sourceObservationSummary: summary }] }), /source-observation evidence/);
});
