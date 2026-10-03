"use strict";
const { digest, fail } = require("./issue-tracker-bridge-model");
const MAILBOX = "dylank@posetek.net", TYPES = ["restId", "restImmutableEntryId"];
const id = value => typeof value === "string" && value.length > 0 && value.length <= 1024 && /^[A-Za-z0-9_+/=-]+$/.test(value);
function translationRequest(inputIds, sourceIdType) {
  if (!Array.isArray(inputIds) || inputIds.length < 1 || inputIds.length > 100 || new Set(inputIds).size !== inputIds.length || inputIds.some(value => !id(value)) || !TYPES.includes(sourceIdType)) fail("tracker_graph_invalid_translation_request");
  return { inputIds: [...inputIds], sourceIdType, targetIdType: "restImmutableEntryId" };
}
function translationResult(request, response) {
  translationRequest(request.inputIds, request.sourceIdType);
  if (request.targetIdType !== "restImmutableEntryId" || !Array.isArray(response?.value) || response.value.length !== request.inputIds.length) fail("tracker_graph_invalid_translation_response");
  const result = new Map();
  for (const item of response.value) {
    if (!item || !request.inputIds.includes(item.sourceId) || result.has(item.sourceId) || !id(item.targetId) || item.errorDetails || item.error) fail("tracker_graph_invalid_translation_response");
    result.set(item.sourceId, item.targetId);
  }
  return result;
}
function itemIdentity({ sourceId, canonicalId, sourceIdType, responseSha256, method = "graph_translate_exchange_ids" }) {
  if (!id(sourceId) || !id(canonicalId) || !TYPES.includes(sourceIdType) || !/^[a-f0-9]{64}$/.test(responseSha256 || "")) fail("tracker_mail_identity_unverified");
  if (!["graph_translate_exchange_ids", "graph_verified_immutable_get"].includes(method)) fail("tracker_mail_identity_unverified");
  return { schemaVersion: 1, method, mailbox: MAILBOX, sourceId, sourceIdType, canonicalId, targetIdType: "restImmutableEntryId", responseSha256 };
}
function validItemIdentity(proof, canonicalId) {
  if (!proof || Object.keys(proof).sort().join() !== "canonicalId,mailbox,method,responseSha256,schemaVersion,sourceId,sourceIdType,targetIdType") return false;
  try { itemIdentity(proof); } catch (_) { return false; }
  return proof.schemaVersion === 1 && ["graph_translate_exchange_ids", "graph_verified_immutable_get"].includes(proof.method) && proof.mailbox === MAILBOX && proof.targetIdType === "restImmutableEntryId" && proof.canonicalId === canonicalId;
}
function aliasGroupProof(items) {
  if (!Array.isArray(items) || items.length < 2 || items.length > 20) fail("tracker_invalid_alias_group");
  const canonicalId = items[0]?.itemIdentity?.canonicalId, ids = items.map(item => item.requestedId);
  if (!id(canonicalId) || new Set(ids).size !== ids.length || ids.some(value => !id(value)) || items.some(item => !validItemIdentity(item.itemIdentity, canonicalId) || item.itemIdentity.sourceId !== item.requestedId)) fail("tracker_alias_group_unverified");
  // Internet-Message-ID, body and time are cross-checks only. The exact fixed-
  // mailbox Exchange translation response is what proves the aliases.
  const internetId = items[0].mail.internetMessageId;
  if (items.some(item => item.mail.id !== canonicalId || item.mail.internetMessageId !== internetId)) fail("tracker_alias_group_changed");
  const body = { schemaVersion: 1, mailbox: MAILBOX, canonicalId, ids: [...ids].sort(), items };
  return { ...body, proofSha256: digest(body) };
}
function verifyAliasGroup(proof) {
  if (!proof) fail("tracker_alias_group_unverified");
  const expected = aliasGroupProof(proof.items);
  if (digest(expected) !== digest(proof)) fail("tracker_alias_group_unverified");
  return expected;
}
function validReconciliation(value, message) {
  return Boolean(value && Object.keys(value).sort().join() === "canonicalId,evidenceRef,primaryId,proofSha256,retainedIds,schemaVersion"
    && value.schemaVersion === 1 && validItemIdentity(message?.itemIdentity, value.canonicalId) && value.canonicalId === message.immutableId
    && id(value.primaryId) && Array.isArray(value.retainedIds) && value.retainedIds.length >= 2 && value.retainedIds.length <= 20
    && new Set(value.retainedIds).size === value.retainedIds.length && value.retainedIds.includes(value.primaryId)
    && value.retainedIds.every(sourceId => id(sourceId) && [message.originalId, message.immutableId, ...(message.aliases || [])].includes(sourceId))
    && /^[a-f0-9]{64}$/.test(value.proofSha256 || "") && /^[a-f0-9]{64}$/.test(value.evidenceRef || ""));
}
function emailRecordCounts(seed) {
  const groups = Object.values(seed.emailCanonicalItems || {}), members = new Set();
  let aliasRows = 0;
  for (const group of groups) {
    if (!Array.isArray(group.retainedIds) || group.retainedIds.length < 2 || group.retainedIds.length > 20 || !group.retainedIds.includes(group.primaryId)) fail("tracker_invalid_alias_counts");
    for (const item of group.retainedIds) { if (members.has(item)) fail("tracker_invalid_alias_counts"); members.add(item); }
    aliasRows += group.retainedIds.length - 1;
  }
  if (Number.isSafeInteger(seed.counts?.emails) && seed.counts.emails < aliasRows) fail("tracker_invalid_alias_counts");
  const aliasActions = Object.values(seed.rows?.actions || {}).filter(row => row.aliasOfActionId && row.aliasOfEmailId && /^[a-f0-9]{64}$/.test(row.aliasProofSha256 || "")).length;
  return { emailRecords: seed.counts?.emails ?? null, provenAliasRows: aliasRows, canonicalEmailRecords: Number.isSafeInteger(seed.counts?.emails) ? seed.counts.emails - aliasRows : null, provenAliasGroups: groups.length,
    actionRecords: seed.counts?.actions ?? null, provenAliasActions: aliasActions, canonicalActionRecords: Number.isSafeInteger(seed.counts?.actions) ? seed.counts.actions - aliasActions : null };
}
function validDeliveryReview(review) {
  return Boolean(review && Object.keys(review).sort().join() === "actionId,evidenceRef,expectedProblemSha256,googleCloudDailySafetyCap,legacyResendNeedsReview,legacyUnassignedNeedsReview,primaryId,proofSha256,reviewedAtMillis,schemaVersion,source,templateVersion"
    && review.schemaVersion === 1 && review.source === "posetek_server_issue_classifier" && review.templateVersion === "microsoft-dylan-only-v1" && review.actionId === "A01" && id(review.primaryId)
    && Number.isSafeInteger(review.reviewedAtMillis) && review.reviewedAtMillis > 0 && Number.isSafeInteger(review.legacyResendNeedsReview) && review.legacyResendNeedsReview >= 0
    && Number.isSafeInteger(review.legacyUnassignedNeedsReview) && review.legacyUnassignedNeedsReview >= 0 && review.googleCloudDailySafetyCap === 20
    && [review.expectedProblemSha256, review.evidenceRef, review.proofSha256].every(value => /^[a-f0-9]{64}$/.test(value || "")));
}
module.exports = { MAILBOX, TYPES, translationRequest, translationResult, itemIdentity, validItemIdentity, aliasGroupProof, verifyAliasGroup, validReconciliation, validDeliveryReview, emailRecordCounts };
