"use strict";
const M = require("./user-issue-model");
const { summarizeOccurrences } = require("./user-issue-classification");
const NotificationPolicy = require("./user-issue-notification-policy");
const PAGE = 250, MAX_PAGES = 2000;
const REVIEW = new Set(["failed", "bounced", "suppressed", "needs_review"]);
const error = code => Object.assign(new Error(code), { code });

async function pages(query, order) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await (cursor ? query.startAfter(...cursor) : query).limit(PAGE).get();
    if (!Array.isArray(result.docs) || result.size !== result.docs.length || result.size > PAGE) throw error("summary_invalid_page");
    for (const doc of result.docs) {
      const value = doc.data();
      if (!/^[a-f0-9]{64}$/.test(doc.id) || !value || typeof value !== "object") throw error("summary_invalid_source");
      const next = order === "receivedAtMillis" ? [value.receivedAtMillis, doc.id] : [doc.id];
      if (order === "receivedAtMillis" && !Number.isSafeInteger(next[0])) throw error("summary_invalid_receipt_time");
      if (cursor && (next[0] < cursor[0] || next[0] === cursor[0] && (next.length === 1 || next[1] <= cursor[1]))) throw error("summary_nonadvancing_page");
      cursor = next;
      rows.push({ ...value, id: doc.id });
    }
    if (result.size < PAGE) return rows;
  }
  // A bounded reader never substitutes a partial count for complete coverage.
  throw error("summary_pagination_incomplete");
}

async function reportingSummary(db, period) {
  const bounds = M.periodBounds(period);
  const query = db.collection("userIssueOccurrences").where("receivedAtMillis", ">=", bounds.lower)
    .where("receivedAtMillis", "<", bounds.upper).orderBy("receivedAtMillis").orderBy("__name__");
  const occurrences = await pages(query, "receivedAtMillis");
  if (occurrences.some(row => row.receivedAtMillis < bounds.lower || row.receivedAtMillis >= bounds.upper)) throw error("summary_receipt_window_mismatch");
  const notificationCadence = { routineRepeats: 0, backlogDeferred: 0, immediateSelected: 0, undecided: 0,
    scope: "exact_reporting_window_incident_jobs_at_summary_capture", enumerationComplete: true };
  // Bound each read without truncating the already fully paginated receipt-time
  // window. Status/daily jobs are not additional incident occurrences.
  for (let offset = 0; offset < occurrences.length; offset += 25) {
    const snapshots = await db.getAll(...occurrences.slice(offset, offset + 25).map(row => db.doc(`userIssueOutbox/${row.id}`)));
    if (snapshots.length !== Math.min(25, occurrences.length - offset)) throw error("summary_notification_read_incomplete");
    for (let index = 0; index < snapshots.length; index++) {
      const occurrence = occurrences[offset + index], job = snapshots[index].data(), decision = job?.notificationDecision;
      if (snapshots[index].id !== occurrence.id || job && (job.id !== occurrence.id || job.type !== "incident" || job.issueId !== occurrence.issueId)) throw error("summary_notification_occurrence_mismatch");
      if (decision?.schemaVersion === 1 && decision.source === NotificationPolicy.SOURCE && decision.jobId === occurrence.id
        && decision.occurrenceId === occurrence.id && decision.issueId === occurrence.issueId) {
        if (decision.action === "immediate") notificationCadence.immediateSelected++;
        else if (decision.action === "daily_summary" && decision.reason === "routine_repeat") notificationCadence.routineRepeats++;
        else if (decision.action === "daily_summary" && decision.reason === "backlog_before_cutover") notificationCadence.backlogDeferred++;
        else throw error("summary_notification_decision_invalid");
      } else notificationCadence.undecided++;
    }
  }
  return { schemaVersion: 2, period, lower: bounds.lower, upper: bounds.upper, enumerationComplete: true,
    ...summarizeOccurrences(occurrences), notificationCadence };
}

async function deliveryReviewSummary(db) {
  // Preserve provider assignment from the frozen job. Current configuration
  // does not retroactively make a Resend failure a Microsoft failure.
  const jobs = await pages(db.collection("userIssueOutbox").where("status", "in", [...REVIEW]).orderBy("__name__"), "__name__");
  const result = { total: 0, microsoft: 0, resend: 0, unassigned: 0, enumerationComplete: true, scope: "all_time_current_delivery_review" };
  for (const job of jobs) {
    if (!REVIEW.has(job.status)) throw error("summary_delivery_query_mismatch");
    result.total++;
    result[["microsoft", "resend"].includes(job.deliveryProvider) ? job.deliveryProvider : "unassigned"]++;
  }
  return result;
}

module.exports = { reportingSummary, deliveryReviewSummary, PAGE };
