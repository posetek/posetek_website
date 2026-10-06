"use strict";
const crypto = require("node:crypto");
const { fail, digest, materialOutbox } = require("./issue-tracker-bridge-model");
const { createEvidenceArchive } = require("./issue-tracker-evidence");
const { MAILBOX } = require("./issue-tracker-graph-reader");
const { mailReadBinding } = require("./issue-tracker-mail-read-proxy");
const OVERLAP_MS = 30 * 60000, WINDOW_MS = 86400000, LEASE_MS = 240000;
const ready = s => s?.enabled === true && s.seedVerified === true && s.connectionVerified === true && s.sourceRecoveryEnabled === true && typeof s.workbookKey === "string" && Boolean(s.workbookKey);
const iso = value => new Date(value).toISOString();
const errorCode = error => /^tracker_[a-z_]+$/.test(error?.code || "") ? error.code : "tracker_source_capture_failed";

function createBackendSourceReader({ db, bridge, archive = createEvidenceArchive(db) }) {
  return {
    async page({ since, until, cursor }) {
      const state = cursor || { phase: "occurrences", after: null };
      if (!["occurrences", "outbox"].includes(state.phase)) fail("tracker_backend_invalid_cursor");
      const collection = state.phase === "occurrences" ? "userIssueOccurrences" : "userIssueOutbox";
      const field = state.phase === "occurrences" ? "receivedAtMillis" : "createdAtMillis";
      let query = db.collection(collection).where(field, ">=", Date.parse(since)).where(field, "<", Date.parse(until)).orderBy(field).orderBy("__name__").limit(100);
      if (state.after) {
        if (!Array.isArray(state.after) || !Number.isFinite(state.after[0]) || !/^[a-f0-9]{64}$/.test(state.after[1] || "")) fail("tracker_backend_invalid_cursor");
        query = query.startAfter(...state.after);
      }
      const page = await query.get();
      const records = page.docs.map(doc => ({ id: doc.id, phase: state.phase, data: doc.data() }));
      if (records.some(r => !/^[a-f0-9]{64}$/.test(r.id) || !Number.isFinite(r.data[field]) || r.data[field] < Date.parse(since) || r.data[field] >= Date.parse(until))) fail("tracker_backend_window_violation");
      if (page.size === 100) {
        const last = records.at(-1); return { records, cursor: { phase: state.phase, after: [last.data[field], last.id] }, complete: false };
      }
      return { records, cursor: state.phase === "occurrences" ? { phase: "outbox", after: null } : null, complete: state.phase === "outbox" };
    },
    async capture(record) {
      const proof = await archive(record.phase === "occurrences" ? "backend-occurrence" : "backend-outbox", record.id, record.data);
      if (record.phase === "outbox" && !materialOutbox(record.data)) return { relevant: false, reason: "unsupported_outbox_type_archived", evidenceRef: proof.id, ticket: null };
      const result = record.phase === "occurrences" ? await bridge.observeOccurrence(record.id, { schedule: false }) : await bridge.observeOutbox(record.id, { schedule: false });
      if (!result.ticket) fail("tracker_capture_not_queued");
      return { relevant: true, ticket: result.ticket, evidenceRef: proof.id };
    },
  };
}

/** Capture completeness and publication are separate facts. A receipt-time
 * window advances capturedThrough only after every page is durably considered.
 * publishedThrough advances only after every relevant queue version in every
 * page has an exact successful native-workbook acknowledgement. Arrival events
 * never advance either checkpoint. This state is independent for each source.
 */
function createSourceCapture({ db, bridge, graph, mailCapture, backend = createBackendSourceReader({ db, bridge }), now = Date.now,
  randomId = crypto.randomUUID, maxPages = 2, settleMs = 120000 }) {
  const settingsRef = db.doc("issueTrackerSettings/current");
  const stateRef = source => db.doc(`issueTrackerState/capture-${source}`);
  const windowRef = (source, seq) => db.doc(`issueTrackerCaptureWindows/${source}-${seq}`);
  function configured(settings, source) {
    return ready(settings) && (source !== "outlook" || Boolean(mailReadBinding(settings)) && settings.mailAliasesVerified === true && settings.mailbox === MAILBOX);
  }
  async function checkLease(tx, source, leaseId, workbookKey, binding) {
    const state = (await tx.get(stateRef(source))).data(), settings = (await tx.get(settingsRef)).data();
    if (state?.leaseId !== leaseId) fail("tracker_capture_lease_lost");
    if (!configured(settings, source) || settings.workbookKey !== workbookKey) fail("tracker_capture_configuration_changed");
    if (source === "outlook" && (mailReadBinding(settings) !== binding || state.mailReadBinding !== binding)) fail("tracker_capture_configuration_changed");
    return state;
  }
  async function publish(source, claimed) {
    const ref = stateRef(source), state = (await ref.get()).data();
    const seq = (state.publishedSequence || 0) + 1;
    if (seq > (state.completedSequence || 0)) return false;
    const wref = windowRef(source, seq), window = (await wref.get()).data();
    if (!window?.captureComplete || window.workbookKey !== claimed.workbookKey) fail("tracker_capture_window_missing");
    let pageNumber = window.verifiedPages || 0;
    // Resume bounded receipt checks; an applied version only increases.
    for (let i = 0; i < maxPages && pageNumber < window.pages; i++, pageNumber++) {
      const page = (await wref.collection("pages").doc(String(pageNumber).padStart(6, "0")).get()).data();
      if (!page?.complete || !Array.isArray(page.tickets)) fail("tracker_capture_page_missing");
      for (const ticket of page.tickets) {
        const queued = (await db.doc(`issueTrackerQueue/${ticket.queueId}`).get()).data();
        if (!queued || !Number.isSafeInteger(queued.appliedVersion) || queued.appliedVersion < ticket.version) return false;
      }
      await db.runTransaction(async tx => {
        await checkLease(tx, source, claimed.leaseId, claimed.workbookKey, claimed.mailReadBinding);
        const current = (await tx.get(wref)).data();
        if (current.verifiedPages !== pageNumber) fail("tracker_capture_receipt_changed");
        tx.update(wref, { verifiedPages: pageNumber + 1 });
      });
    }
    if (pageNumber !== window.pages) return false;
    await db.runTransaction(async tx => {
      const current = await checkLease(tx, source, claimed.leaseId, claimed.workbookKey, claimed.mailReadBinding);
      const finished = (await tx.get(wref)).data();
      if ((current.publishedSequence || 0) + 1 !== seq || finished.verifiedPages !== finished.pages || !finished.captureComplete) fail("tracker_capture_receipt_changed");
      tx.update(wref, { publicationConfirmed: true, publishedAtMillis: now() });
      tx.update(ref, { publishedSequence: seq, publishedThrough: window.until, lastPublicationVerifiedAtMillis: now() });
    });
    return true;
  }

  async function run(source) {
    if (!["outlook", "backend"].includes(source)) fail("tracker_invalid_capture_source");
    const ref = stateRef(source), leaseId = randomId();
    const claimed = await db.runTransaction(async tx => {
      const settings = (await tx.get(settingsRef)).data();
      if (!configured(settings, source)) return { skipped: "not_configured" };
      const state = (await tx.get(ref)).data() || {};
      if (state.leaseUntilMillis > now()) return { skipped: "capture_busy" };
      if (state.workbookKey && state.workbookKey !== settings.workbookKey) fail("tracker_capture_workbook_changed");
      const binding = source === "outlook" ? mailReadBinding(settings) : null;
      if (source === "outlook" && state.mailReadBinding && state.mailReadBinding !== binding) fail("tracker_capture_provider_changed");
      const initial = Date.parse(settings.sourceCheckpoints?.[source]), floor = Date.parse(settings.sourceCaptureStart);
      if (!Number.isFinite(initial) || !Number.isFinite(floor) || floor > initial || initial > now() + 60000) fail("tracker_capture_missing_checkpoint");
      const through = state.capturedThrough || iso(initial), to = Math.min(now() - settleMs, Date.parse(through) + WINDOW_MS);
      let active = state.activeWindow || null;
      if (!active && to > Date.parse(through)) {
        const seq = (state.completedSequence || 0) + 1;
        active = { id: `${source}-${seq}`, seq, since: iso(Math.max(floor, Date.parse(through) - OVERLAP_MS)), until: iso(to), cursor: null, pages: 0, records: 0, relevant: 0, excluded: 0 };
        tx.create(windowRef(source, seq), { ...active, source, workbookKey: settings.workbookKey, captureComplete: false, publicationConfirmed: false, verifiedPages: 0, createdAtMillis: now() });
      }
      tx.set(ref, { ...state, workbookKey: settings.workbookKey, initialThrough: state.initialThrough || iso(initial), capturedThrough: through,
        publishedThrough: state.publishedThrough || iso(initial), completedSequence: state.completedSequence || 0, publishedSequence: state.publishedSequence || 0,
        activeWindow: active, leaseId, leaseUntilMillis: now() + LEASE_MS, lastAttemptAtMillis: now(), ...(binding ? { mailReadBinding: binding } : {}) });
      return { leaseId, workbookKey: settings.workbookKey, active, mailReadBinding: binding };
    });
    if (claimed.skipped) return claimed;
    try {
      await publish(source, claimed);
      let active = claimed.active;
      if (!active) return { current: true };
      for (let i = 0; i < maxPages; i++) {
        const wref = windowRef(source, active.seq);
        const cursorRef = wref.collection("cursors").doc(digest(active.cursor));
        if ((await cursorRef.get()).exists) fail("tracker_capture_pagination_loop");
        const page = source === "outlook" ? await graph.page(active) : await backend.page(active);
        if (!Array.isArray(page.records) || typeof page.complete !== "boolean" || page.complete !== (page.cursor === null)) fail("tracker_capture_invalid_page");
        const tickets = [], reasons = {}; let relevant = 0;
        // One shared bounded identity/alias operation covers the entire Outlook
        // page. Any failed item leaves the frozen page/cursor checkpoint intact;
        // successfully queued immutable evidence can be reused on its retry.
        const mailResults = source === "outlook" && typeof mailCapture.capturePage === "function" ? await mailCapture.capturePage(page.records) : null;
        for (let index = 0; index < page.records.length; index++) {
          const record = page.records[index];
          const result = mailResults ? mailResults[index] : source === "outlook" ? await mailCapture.capture(record) : await backend.capture(record);
          if (result.relevant) { if (!result.ticket || !Number.isSafeInteger(result.ticket.version) || result.ticket.version < 1) fail("tracker_capture_not_queued"); tickets.push(result.ticket); relevant++; }
          else { const reason = result.reason || "excluded"; reasons[reason] = (reasons[reason] || 0) + 1; }
        }
        const next = { ...active, cursor: page.cursor, pages: active.pages + 1, records: active.records + page.records.length, relevant: active.relevant + relevant, excluded: active.excluded + page.records.length - relevant };
        await db.runTransaction(async tx => {
          const state = await checkLease(tx, source, leaseId, claimed.workbookKey, claimed.mailReadBinding);
          if (state.activeWindow?.id !== active.id || state.activeWindow.pages !== active.pages) fail("tracker_capture_cursor_changed");
          tx.create(wref.collection("pages").doc(String(active.pages).padStart(6, "0")), { complete: true, tickets, records: page.records.length, relevant, excludedReasons: reasons });
          tx.create(cursorRef, { page: active.pages });
          tx.update(wref, { ...next, captureComplete: page.complete, lastCheckedAtMillis: now() });
          tx.update(ref, { activeWindow: page.complete ? null : next, lastCheckedAtMillis: now(), lastErrorCode: null, leaseUntilMillis: now() + LEASE_MS,
            ...(page.complete ? { capturedThrough: active.until, completedSequence: active.seq, lastCompleteAtMillis: now() } : {}) });
        });
        active = next;
        if (tickets.length) await bridge.wake();
        if (page.complete) { await publish(source, claimed); return { captureComplete: true, capturedThrough: active.until, records: active.records, relevant: active.relevant }; }
      }
      return { captureComplete: false, continuingWindow: active.id, pages: active.pages };
    } catch (error) {
      const code = errorCode(error);
      await db.runTransaction(async tx => { const s = (await tx.get(ref)).data(); if (s?.leaseId === leaseId) tx.update(ref, { lastCheckedAtMillis: now(), lastFailedAtMillis: now(), lastErrorCode: code }); });
      fail(code);
    } finally {
      await db.runTransaction(async tx => { const s = (await tx.get(ref)).data(); if (s?.leaseId === leaseId) tx.update(ref, { leaseId: null, leaseUntilMillis: 0 }); });
    }
  }
  return { run };
}
module.exports = { createSourceCapture, createBackendSourceReader, OVERLAP_MS, WINDOW_MS };
