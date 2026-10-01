"use strict";
const crypto = require("node:crypto");
const M = require("./issue-tracker-bridge-model");
const { ROWS, createSeedStore, splitSeed } = require("./issue-tracker-bridge-seed");
const { validMessage, validKey } = require("./issue-tracker-bridge-ingress");
const COALESCE_MS = 90000, LEASE_MS = 240000, MAX_BATCH = 40, MAX_DOCUMENT_BYTES = 700000, DAILY_ATTEMPT_LIMIT = 1200;
const PATHS = Object.freeze({ settings: "issueTrackerSettings/current", writer: "issueTrackerState/writer", seed: "issueTrackerState/seed", queue: "issueTrackerQueue", batches: "issueTrackerBatches" });
const SAFE_ID = /^[a-f0-9]{64}$/;
const size = value => Buffer.byteLength(M.canonical(value));

/** Independent reporting queue. No email outbox or application record is written.
 * scheduleTask must enqueue an authenticated Cloud Task; normalize is pure;
 * transport must return the Office Script's verified write receipt.
 */
function createIssueTrackerBridge({ db, scheduleTask, normalize, transport, now = Date.now, randomId = crypto.randomUUID }) {
  const writerRef = db.doc(PATHS.writer), seedRef = db.doc(PATHS.seed);
  const seedStore = createSeedStore(db);
  async function wake(at = (Math.floor(now() / COALESCE_MS) + 1) * COALESCE_MS) {
    // Fixed future slots bound task creation under log storms. A transaction-to-
    // enqueue crash is recovered by the original Firestore event's retry.
    try { await scheduleTask({ schemaVersion: 1 }, { id: M.digest(["issue-tracker", at]), scheduleTime: new Date(at), dispatchDeadlineSeconds: 180 }); }
    catch (error) { if (error?.code !== "functions/task-already-exists") throw error; }
  }

  async function observeOutbox(id) {
    if (!SAFE_ID.test(id || "")) M.fail("tracker_invalid_outbox_id");
    const ref = db.doc(`${PATHS.queue}/outbox-${id}`);
    const queued = await db.runTransaction(async tx => {
      const settings = (await tx.get(db.doc(PATHS.settings))).data();
      if (settings?.enabled !== true) return false;
      // Read the current document, not the possibly out-of-order trigger image.
      const job = (await tx.get(db.doc(`userIssueOutbox/${id}`))).data();
      const material = M.materialOutbox(job);
      if (!material) return false;
      const old = (await tx.get(ref)).data();
      const desiredHash = M.digest(material);
      if (old?.desiredHash === desiredHash) return old.pending === true;
      tx.set(ref, { source: "outbox", sourceId: id, desiredHash, version: (old?.version || 0) + 1, pending: true,
        changedAtMillis: now(), firstQueuedAtMillis: old?.firstQueuedAtMillis || now(), appliedHash: old?.appliedHash || null });
      return true;
    });
    if (queued) await wake();
    return { queued };
  }

  // Adapter boundary only: callers must authenticate and authorize the mailbox
  // before invoking this method. No public HTTP ingress is exported here.
  async function enqueueMessage(message) {
    if (!message || !validKey(message.mailbox, 320)) M.fail("tracker_invalid_message");
    const { mailbox: _mailbox, exactJoin, ...mail } = message;
    if (!validMessage(mail) || exactJoin && (!["occurrenceId", "outboxId", "providerId"].includes(exactJoin.type) || !validKey(exactJoin.value) || !validKey(exactJoin.evidence))) M.fail("tracker_invalid_message");
    if (size(message) > 48000) M.fail("tracker_message_too_large");
    // Reject deterministic input-only failures before acknowledging Outlook.
    // This pure dry run persists no IDs or seed; the worker later resolves all
    // historical aliases/joins against its authoritative sharded snapshots.
    try { await normalize({ outbox: [], occurrences: [], issues: [], messages: [message], seed: {} }); }
    catch (_) { M.fail("tracker_invalid_message"); }
    // Distinct Outlook items can share InternetMessageId (e.g. copies). Use the
    // immutable item ID when supplied; explicit aliases are resolved by adapter.
    const sourceId = M.digest([message.mailbox.toLowerCase(), message.immutableId || message.originalId || message.id]);
    const ref = db.doc(`${PATHS.queue}/mail-${sourceId}`), desiredHash = M.digest(message);
    const queued = await db.runTransaction(async tx => {
      const settings = (await tx.get(db.doc(PATHS.settings))).data();
      if (settings?.enabled !== true) M.fail("tracker_disabled");
      if (message.mailbox.toLowerCase() !== settings.mailbox?.toLowerCase()) M.fail("tracker_wrong_mailbox");
      const old = (await tx.get(ref)).data();
      if (old?.desiredHash === desiredHash) return old.pending === true;
      tx.set(ref, { source: "outlook", sourceId, message, desiredHash, version: (old?.version || 0) + 1, pending: true,
        changedAtMillis: now(), firstQueuedAtMillis: old?.firstQueuedAtMillis || now(), appliedHash: old?.appliedHash || null });
      return true;
    });
    if (queued) await wake();
    return { queued };
  }

  async function claim() {
    const leaseId = randomId();
    return db.runTransaction(async tx => {
      const settings = (await tx.get(db.doc(PATHS.settings))).data();
      if (settings?.enabled !== true || settings.seedVerified !== true || settings.connectionVerified !== true || typeof settings.workbookKey !== "string" || !settings.workbookKey) M.fail("tracker_not_configured");
      const state = (await tx.get(writerRef)).data();
      if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0) M.fail("tracker_missing_seed_revision");
      if (state.blockedReason) M.fail("tracker_writer_blocked");
      if (state.leaseUntilMillis > now()) M.fail("tracker_writer_busy");
      tx.update(writerRef, { leaseId, leaseUntilMillis: now() + LEASE_MS });
      return { ...state, leaseId, workbookKey: settings.workbookKey };
    });
  }

  async function loadBatch(claimed) {
    if (claimed.activeBatchId) {
      const existing = (await db.doc(`${PATHS.batches}/${claimed.activeBatchId}`).get()).data();
      if (!existing || existing.payload.workbookKey !== claimed.workbookKey || existing.payload.expectedRevision !== claimed.revision) M.fail("tracker_active_batch_mismatch");
      return existing;
    }
    const pending = await db.collection(PATHS.queue).where("pending", "==", true).limit(MAX_BATCH).get();
    if (pending.empty) return null;
    const seed = await seedStore.load((await seedRef.get()).data());
    if (M.GROUPS.some(group => !Number.isSafeInteger(seed.counts?.[group]) || seed.counts[group] < 0)) M.fail("tracker_missing_seed_counts");
    const outbox = [], occurrences = [], issues = [], messages = [], seenIssues = new Set(), seenJobs = new Set();
    async function hydrateJob(id, requireIncident = false) {
      if (!SAFE_ID.test(id || "")) M.fail("tracker_invalid_join");
      if (seenJobs.has(id)) {
        if (requireIncident && outbox.find(job => job.id === id)?.type !== "incident") M.fail("tracker_invalid_join");
        return;
      }
      const job = (await db.doc(`userIssueOutbox/${id}`).get()).data();
      if (!job) M.fail("tracker_source_unavailable");
      if (requireIncident && job.type !== "incident") M.fail("tracker_invalid_join");
      outbox.push({ ...job, id }); seenJobs.add(id);
      if (job.type === "incident") {
        await seedStore.hydrate(seed, "instances", id);
        const occurrence = (await db.doc(`userIssueOccurrences/${id}`).get()).data();
        if (!occurrence) M.fail("tracker_occurrence_unavailable");
        occurrences.push({ ...occurrence, id });
      } else if (job.type === "daily" || job.type === "status") await seedStore.hydrate(seed, "dailyRows", id);
      if (job.issueId && !seenIssues.has(job.issueId)) {
        const issue = (await db.doc(`userIssues/${job.issueId}`).get()).data();
        if (!issue) M.fail("tracker_issue_unavailable");
        issues.push({ ...issue, id: job.issueId }); seenIssues.add(job.issueId);
      }
    }
    for (const row of pending.docs) {
      const queued = row.data();
      if (queued.source === "outlook") { messages.push(queued.message); continue; }
      if (queued.source !== "outbox") M.fail("tracker_unknown_source");
      await hydrateJob(queued.sourceId);
    }
    for (const message of messages) {
      const originalId = message.originalId || message.id;
      const aliases = [...new Set([originalId, message.immutableId, ...(message.aliases || [])].filter(Boolean))];
      const canonicalIds = new Set([originalId, ...aliases.map(alias => seed.emailAliases?.[M.digest([message.mailbox.toLowerCase(), alias])]).filter(Boolean)]);
      for (const id of canonicalIds) {
        await seedStore.hydrate(seed, "emails", id);
        const eventRef = seed.rows?.emails?.[id]?.eventRef;
        if (eventRef) await hydrateJob(eventRef, true);
      }
      // Only internal, separately verified correlations may carry exactJoin.
      // The public mail adapter rejects this field; no subject/time inference.
      const join = message.exactJoin;
      if (join?.type === "occurrenceId") await hydrateJob(join.value, true);
      else if (join?.type === "outboxId") await hydrateJob(seed.outboxOccurrences?.[join.value] || join.value, true);
      else if (join?.type === "providerId") {
        let id = seed.providerOccurrences?.[join.value];
        if (!id) {
          const found = await db.collection("userIssueOutbox").where("providerId", "==", join.value).limit(2).get();
          if (found.size !== 1 || found.docs[0].data().type !== "incident") M.fail("tracker_ambiguous_join");
          id = found.docs[0].id;
        }
        await hydrateJob(id, true);
      }
    }
    const { changes, nextSeed } = await normalize({ outbox, occurrences, issues, messages, seed });
    if (!nextSeed) M.fail("tracker_missing_next_seed");
    const expectedCounts = Object.fromEntries(M.GROUPS.map(group => [group, seed.counts[group] + changes[group].filter(row => row.expectedMachineSha256 === null).length]));
    nextSeed.counts = expectedCounts;
    const { metadata, changedRows } = splitSeed(nextSeed, seed);
    if (size(metadata) > MAX_DOCUMENT_BYTES || changedRows.length > 150 || changedRows.some(row => size(row) > MAX_DOCUMENT_BYTES)) M.fail("tracker_seed_capacity");
    const batchId = randomId();
    const payload = M.sealBatch({ batchId, workbookKey: claimed.workbookKey, expectedRevision: claimed.revision, generatedAt: new Date(now()).toISOString(), changes });
    const batch = { payload, nextSeedMetadata: metadata, seedRowIds: changedRows.map(row => row.id), selected: pending.docs.map(row => ({ id: row.id, version: row.data().version, desiredHash: row.data().desiredHash })),
      state: "prepared", preparedAtMillis: now(), attempts: 0 };
    if (size(batch) > MAX_DOCUMENT_BYTES || size(batch) + changedRows.reduce((total, row) => total + size(row), 0) > 6000000) M.fail("tracker_batch_capacity");
    await db.runTransaction(async tx => {
      const state = (await tx.get(writerRef)).data();
      if (state?.leaseId !== claimed.leaseId || state.activeBatchId || state.revision !== claimed.revision) M.fail("tracker_lease_lost");
      tx.create(db.doc(`${PATHS.batches}/${batchId}`), batch);
      for (const row of changedRows) tx.create(db.doc(`${PATHS.batches}/${batchId}/rows/${row.id}`), row);
      tx.update(writerRef, { activeBatchId: batchId });
    });
    return batch;
  }

  async function acknowledge(claimed, batch, receipt) {
    M.verifyReceipt(batch.payload, receipt);
    if (M.canonical(receipt.counts) !== M.canonical(batch.nextSeedMetadata.counts)) M.fail("tracker_invalid_receipt_counts");
    await db.runTransaction(async tx => {
      const state = (await tx.get(writerRef)).data();
      const rows = [];
      for (const selected of batch.selected) rows.push({ selected, ref: db.doc(`${PATHS.queue}/${selected.id}`), current: (await tx.get(db.doc(`${PATHS.queue}/${selected.id}`))).data() });
      const seedRows = [];
      for (const id of batch.seedRowIds) {
        const row = (await tx.get(db.doc(`${PATHS.batches}/${batch.payload.batchId}/rows/${id}`))).data();
        if (!row || row.id !== id) M.fail("tracker_frozen_seed_missing");
        seedRows.push(row);
      }
      if (state?.leaseId !== claimed.leaseId || state.activeBatchId !== batch.payload.batchId || state.revision !== batch.payload.expectedRevision) M.fail("tracker_lease_lost");
      for (const { selected, ref, current } of rows) {
        if (current?.version === selected.version && current.desiredHash === selected.desiredHash) tx.update(ref, { pending: false, appliedHash: selected.desiredHash, appliedAtMillis: now(), batchId: batch.payload.batchId });
      }
      tx.set(seedRef, batch.nextSeedMetadata);
      for (const row of seedRows) tx.set(db.doc(`${ROWS}/${row.id}`), { group: row.group, key: row.key, value: row.value });
      tx.update(db.doc(`${PATHS.batches}/${batch.payload.batchId}`), { state: "applied", receipt, appliedAtMillis: now() });
      tx.update(writerRef, { revision: receipt.revision, activeBatchId: null, leaseId: null, leaseUntilMillis: 0, lastAppliedAtMillis: now(), lastBatchId: batch.payload.batchId });
    });
  }

  async function drain() {
    const claimed = await claim();
    let batch;
    try {
      batch = await loadBatch(claimed);
      if (!batch) return { applied: false, empty: true };
      // Frozen before any external request. Unknown outcomes always retry exactly
      // this batch/digest/revision, never a regenerated payload or row allocation.
      const allowance = await db.runTransaction(async tx => {
        const state = (await tx.get(writerRef)).data();
        if (state?.leaseId !== claimed.leaseId) M.fail("tracker_lease_lost");
        if (state.nextTransportAtMillis > now()) return { deferred: "call_spacing", at: state.nextTransportAtMillis };
        const day = new Date(now()).toISOString().slice(0, 10);
        const used = state.attemptDay === day ? state.dailyAttempts || 0 : 0;
        if (used >= DAILY_ATTEMPT_LIMIT) {
          tx.update(writerRef, { quotaDeferredAtMillis: now() });
          return { deferred: "daily_attempt_budget", at: Date.parse(`${day}T00:00:00.000Z`) + 86400000 + COALESCE_MS };
        }
        tx.update(writerRef, { attemptDay: day, dailyAttempts: used + 1, quotaDeferredAtMillis: null, nextTransportAtMillis: now() + 5000 });
        tx.update(db.doc(`${PATHS.batches}/${batch.payload.batchId}`), { attempts: (batch.attempts || 0) + 1, lastAttemptAtMillis: now() });
        return { allowed: true };
      });
      if (!allowance.allowed) {
        await wake(allowance.at); return { applied: false, deferred: allowance.deferred };
      }
      const receipt = await transport.send(batch.payload);
      await acknowledge(claimed, batch, receipt);
      if (!(await db.collection(PATHS.queue).where("pending", "==", true).limit(1).get()).empty) await wake(now() + 5000);
      return { applied: true, batchId: batch.payload.batchId, revision: receipt.revision };
    } catch (error) {
      // Never persist/log an endpoint URL, bearer token, mailbox body or raw
      // provider response. Queue and prepared batch remain durable on failure.
      if (batch) await db.doc(`${PATHS.batches}/${batch.payload.batchId}`).update({ lastError: /^tracker_[a-z_]+$/.test(error?.code || "") ? error.code : "tracker_retry_required", lastErrorAtMillis: now() });
      if (["tracker_remote_conflict", "tracker_remote_auth", "tracker_remote_rejected", "tracker_unverified_receipt", "tracker_incomplete_receipt", "tracker_invalid_receipt_counts"].includes(error?.code)) {
        await db.runTransaction(async tx => {
          const state = (await tx.get(writerRef)).data();
          if (state?.leaseId === claimed.leaseId) tx.update(writerRef, { blockedReason: error.code, blockedAtMillis: now() });
        });
      }
      throw error;
    } finally {
      await db.runTransaction(async tx => {
        const state = (await tx.get(writerRef)).data();
        if (state?.leaseId === claimed.leaseId) tx.update(writerRef, { leaseId: null, leaseUntilMillis: 0 });
      });
    }
  }
  return { observeOutbox, enqueueMessage, drain, wake };
}
module.exports = { createIssueTrackerBridge, PATHS, COALESCE_MS, LEASE_MS, MAX_BATCH, DAILY_ATTEMPT_LIMIT };
