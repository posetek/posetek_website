"use strict";
const crypto = require("node:crypto");
const { fail, materialOutbox } = require("./issue-tracker-bridge-model");
const STATE_PATH = "issueTrackerState/outboxRecovery";
const PAGE_SIZE = 100, MAX_PAGES = 2, LEASE_MS = 240000;
const ID = /^[a-f0-9]{64}$/;
const ready = settings => settings?.enabled === true && settings.seedVerified === true && settings.connectionVerified === true &&
  typeof settings.workbookKey === "string" && Boolean(settings.workbookKey);

/** Bounded repair of missed outbox events and exhausted task deliveries. This
 * is NOT a point-in-time incident/mailbox coverage reader: document-ID pages
 * can see concurrent writes. A finished enumeration never advances source
 * complete-through checkpoints or claims that the workbook was published.
 */
function createIssueTrackerRecovery({ db, bridge, now = Date.now, randomId = crypto.randomUUID }) {
  const ref = db.doc(STATE_PATH), settingsRef = db.doc("issueTrackerSettings/current");
  async function run() {
    const leaseId = randomId();
    const claimed = await db.runTransaction(async tx => {
      const settings = (await tx.get(settingsRef)).data();
      if (!ready(settings)) return { skipped: "not_configured" };
      const state = (await tx.get(ref)).data() || {};
      if (state.leaseUntilMillis > now()) return { skipped: "recovery_busy" };
      if (state.workbookKey && state.workbookKey !== settings.workbookKey) fail("tracker_recovery_workbook_changed");
      const scan = state.activeScan || { id: randomId(), startedAtMillis: now(), createdBeforeMillis: now(), cursor: null,
        documentsExamined: 0, eligibleDocuments: 0, queuedDocuments: 0, skippedNewerDocuments: 0, unknownTimeDocuments: 0 };
      if (typeof scan.id !== "string" || !Number.isFinite(scan.createdBeforeMillis) || scan.cursor !== null && !ID.test(scan.cursor || "") ||
          ["documentsExamined", "eligibleDocuments", "queuedDocuments", "skippedNewerDocuments", "unknownTimeDocuments"].some(key => !Number.isSafeInteger(scan[key]) || scan[key] < 0)) fail("tracker_recovery_invalid_cursor");
      tx.set(ref, { ...state, schemaVersion: 1, workbookKey: settings.workbookKey, activeScan: scan, leaseId,
        leaseUntilMillis: now() + LEASE_MS, lastStartedAtMillis: now(), lastErrorCode: null });
      return { scan, workbookKey: settings.workbookKey };
    });
    if (claimed.skipped) return claimed;
    let scan = claimed.scan, scanComplete = false, examined = 0;
    try {
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
        let query = db.collection("userIssueOutbox").orderBy("__name__").limit(PAGE_SIZE);
        if (scan.cursor) query = query.startAfter(scan.cursor);
        const page = await query.get();
        const next = { ...scan };
        for (const doc of page.docs) {
          if (!ID.test(doc.id)) fail("tracker_recovery_invalid_source_id");
          const job = doc.data(); next.documentsExamined++; examined++;
          if (!materialOutbox(job)) continue;
          // Bound creation intake to the scan's original time. Refreshing an old
          // job still reads its CURRENT delivery state through observeOutbox.
          if (Number.isFinite(job.createdAtMillis) && job.createdAtMillis >= scan.createdBeforeMillis) { next.skippedNewerDocuments++; continue; }
          if (!Number.isFinite(job.createdAtMillis)) next.unknownTimeDocuments++;
          next.eligibleDocuments++;
          if ((await bridge.observeOutbox(doc.id, { schedule: false })).queued) next.queuedDocuments++;
        }
        next.cursor = page.docs.at(-1)?.id || scan.cursor;
        scanComplete = page.size < PAGE_SIZE;
        // Cursor moves only after EVERY document on this page was durably
        // considered. A failure repeats the page; material hashes deduplicate.
        await db.runTransaction(async tx => {
          const state = (await tx.get(ref)).data(), settings = (await tx.get(settingsRef)).data();
          if (state?.leaseId !== leaseId) fail("tracker_recovery_lease_lost");
          if (!ready(settings) || settings.workbookKey !== claimed.workbookKey) fail("tracker_recovery_configuration_changed");
          tx.update(ref, { activeScan: next, lastCheckedAtMillis: now(), leaseUntilMillis: now() + LEASE_MS });
        });
        scan = next;
        if (scanComplete) break;
      }
      const writer = (await db.doc("issueTrackerState/writer").get()).data();
      if (!writer || !Number.isSafeInteger(writer.revision) || writer.revision < 0) fail("tracker_recovery_missing_writer");
      const hasPending = !(await db.collection("issueTrackerQueue").where("pending", "==", true).limit(1).get()).empty;
      const writerBlocked = typeof writer?.blockedReason === "string" && Boolean(writer.blockedReason);
      // A fresh task repairs exhausted retries, including a frozen batch whose
      // selected queue rows are no longer otherwise discoverable. Never clear
      // a conflict/auth block, lease, frozen batch or transport attempt budget.
      if ((hasPending || writer?.activeBatchId) && !writerBlocked) await bridge.wake();
      await db.runTransaction(async tx => {
        const state = (await tx.get(ref)).data(), settings = (await tx.get(settingsRef)).data();
        if (state?.leaseId !== leaseId) fail("tracker_recovery_lease_lost");
        if (!ready(settings) || settings.workbookKey !== claimed.workbookKey) fail("tracker_recovery_configuration_changed");
        const update = { lastCheckedAtMillis: now(), lastWakeAtMillis: (hasPending || writer?.activeBatchId) && !writerBlocked ? now() : state.lastWakeAtMillis || null,
          writerBlockedReason: writerBlocked ? writer.blockedReason : null, pendingWorkObserved: Boolean(hasPending || writer?.activeBatchId), lastErrorCode: null };
        if (scanComplete) Object.assign(update, { activeScan: null, lastCompletedScan: { ...scan, finishedAtMillis: now(),
          enumerationComplete: true, pointInTimeSnapshot: false, sourceCompleteThroughAdvanced: false, publicationConfirmed: false } });
        tx.update(ref, update);
      });
      return { scanComplete, examined, writerBlocked, pendingWorkObserved: Boolean(hasPending || writer?.activeBatchId), sourceCompleteThroughAdvanced: false };
    } catch (error) {
      const code = /^tracker_[a-z_]+$/.test(error?.code || "") ? error.code : "tracker_recovery_failed";
      await db.runTransaction(async tx => {
        const state = (await tx.get(ref)).data();
        if (state?.leaseId === leaseId) tx.update(ref, { lastCheckedAtMillis: now(), lastFailedAtMillis: now(),
          lastErrorCode: code });
      });
      // Scheduled invocation logs must not expose a raw SDK/provider body.
      fail(code);
    } finally {
      await db.runTransaction(async tx => {
        const state = (await tx.get(ref)).data();
        if (state?.leaseId === leaseId) tx.update(ref, { leaseId: null, leaseUntilMillis: 0 });
      });
    }
  }
  return { run };
}
module.exports = { createIssueTrackerRecovery, STATE_PATH, PAGE_SIZE, MAX_PAGES, LEASE_MS };
