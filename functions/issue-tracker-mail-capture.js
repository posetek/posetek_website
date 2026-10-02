"use strict";
const { fail, digest } = require("./issue-tracker-bridge-model");
const { MAILBOX } = require("./issue-tracker-graph-reader");
const { createEvidenceArchive } = require("./issue-tracker-evidence");
const { mailReadBinding } = require("./issue-tracker-mail-read-proxy");
const Microsoft = require("./microsoft-email-model");

function receivedRecipients(mail) {
  if (Array.isArray(mail.toRecipients)) {
    const to = mail.toRecipients.map(item => item?.emailAddress?.address?.toLowerCase());
    if (to.every(value => typeof value === "string" && /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value))) return [...new Set(to)].sort();
    return [];
  }
  const headers = (mail.internetMessageHeaders || []).filter(header => /^to$/i.test(header.name));
  if (headers.length !== 1 || typeof headers[0].value !== "string") return [];
  return [...new Set((headers[0].value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(value => value.toLowerCase()))].sort();
}
function trustedMailJoin(message, job, event) {
  if (job?.type !== "incident" || job.deliveryProvider !== "microsoft" || !/^[a-f0-9]{64}$/.test(job.id || "")
    || event?.id !== job.id || !event.issueId || event.issueId !== job.issueId || job.microsoft?.traceAmbiguous === true
    || !Number.isFinite(job.microsoft?.traceCheckedAtMillis) || !job.microsoft?.claimedAtMillis
    || !message.internetMessageId || job.microsoft?.internetMessageId !== message.internetMessageId) return null;
  let payload; try { payload = Microsoft.effectiveDeliveryPayload(job); } catch (_) { return null; }
  const sender = String(message.from || "").toLowerCase();
  if (sender !== job.microsoft.senderMailbox || sender !== "alerts@posetek.net" || message.subject !== payload?.subject
    || !Array.isArray(message.receivedRecipients) || !message.receivedRecipients.length || payload.cc || payload.bcc
    || JSON.stringify(message.receivedRecipients) !== JSON.stringify([...new Set(payload.to.map(value => value.toLowerCase()))].sort())
    || Date.parse(message.receivedDateTime) < job.microsoft.claimedAtMillis - 300000
    || !Object.values(job.recipientDelivery || {}).some(value => value.evidence === "microsoft_trace" && value.traceId)) return null;
  return { type: "occurrenceId", value: job.id, evidence: `Verified Exchange Internet-Message-ID SHA256 ${digest(message.internetMessageId)}; exact sender, full subject, frozen effective recipient set and same-ID backend occurrence` };
}

function relevance(mail) {
  const sender = String(mail.from?.emailAddress?.address || mail.sender?.emailAddress?.address || "").toLowerCase();
  const subject = String(mail.subject || ""), body = String(mail.body?.content || "");
  const all = subject + "\n" + body;
  const knownProject = /kickai-69dd0|posetek|postek\.net/i.test(all);
  const cloud = /(?:google\.com|googlecloud\.com)$/.test(sender.split("@")[1] || "") || /console\.cloud\.google\.com\/monitoring\//i.test(all);
  if (cloud && knownProject) return { relevant: true, reason: "google_cloud_project_notice" };
  if (cloud && /google\s+cloud|cloud\s+(?:monitoring|billing)|stackdriver|googlecloud|console\.cloud\.google\.com/i.test(all + "\n" + sender)) return { relevant: true, reason: "google_cloud_notice_project_needs_verification" };
  if ((/@alerts\.posetek\.net$/.test(sender) || sender === "alerts@posetek.net") && /(?:issue|error|fail|crash|bug|interrupt|undeliver|bounce|status)/i.test(all)) return { relevant: true, reason: "posetek_issue_notice" };
  if (knownProject && /(?:error|fail(?:ed|ure)?|crash|bug|exception|interrupt|undeliver|bounce|unavailable|monitoring|incident|quota|timeout)/i.test(all)) return { relevant: true, reason: "posetek_problem_evidence" };
  if (/\b(?:bug report|app (?:crashed|crash|error)|failed workout|workout (?:failed|crashed|error)|crash report)\b/i.test(all)) return { relevant: true, reason: "user_problem_report_needs_triage" };
  return { relevant: false, reason: "no_relevant_incident_evidence" };
}

function createMailCapture({ db, bridge, graph, archive = createEvidenceArchive(db), now = Date.now }) {
  async function findJoin(message) {
    if (!message.internetMessageId || message.internetMessageId.length > 1000 || !message.receivedRecipients?.length || message.from?.toLowerCase() !== "alerts@posetek.net") return null;
    const matches = await db.collection("userIssueOutbox").where("microsoft.internetMessageId", "==", message.internetMessageId).limit(2).get();
    if (matches.size !== 1) return null;
    const doc = matches.docs[0], job = { ...doc.data(), id: doc.id };
    const event = (await db.doc(`userIssueOccurrences/${doc.id}`).get()).data();
    return trustedMailJoin(message, job, event ? { ...event, id: doc.id } : null);
  }
  async function capture(mail, { aliases = [], schedule = false } = {}) {
    if (!mail || typeof mail.id !== "string" || !Number.isFinite(Date.parse(mail.receivedDateTime))) fail("tracker_graph_invalid_message");
    const decision = relevance(mail);
    if (!decision.relevant) return { ...decision, ticket: null };
    const proof = await archive("outlook", `${MAILBOX}/${mail.id}`, mail);
    const body = mail.body.content;
    const excerpt = body.length <= 20000 ? body : body.slice(0, 20000) + "\n[Display excerpt; full message body retained in Outlook and private evidence archive.]";
    // Extract evidence URLs from the FULL body before excerpting. Long Google
    // notices must retain their exact incident/project even when the link is at
    // the end. These links are never treated as exact backend request joins.
    const links = [...new Set([...body.matchAll(/https:\/\/[^\s<>"']+/g)].map(match => match[0].replace(/&amp;/gi, "&")).filter(value => {
      if (value.length > 2048) return false;
      try { const url = new URL(value); return !url.username && !url.password && (url.hostname === "console.cloud.google.com" && /^\/monitoring\/alerting\/alerts\//.test(url.pathname) || url.hostname === "posetek.net" && url.pathname === "/admin/user-issues"); } catch (_) { return false; }
    }))];
    if (links.length > 20) fail("tracker_mail_evidence_links_exceeded");
    const issueLinks = links.filter(value => new URL(value).hostname === "posetek.net");
    const from = mail.from?.emailAddress?.address || mail.sender?.emailAddress?.address;
    const message = { mailbox: MAILBOX, originalId: mail.id, immutableId: mail.id,
      receivedDateTime: mail.receivedDateTime, subject: mail.subject || "", body: { contentType: mail.body.contentType.toLowerCase(), content: excerpt },
      ...(from ? { from } : {}), ...(mail.internetMessageId ? { internetMessageId: mail.internetMessageId } : {}),
      receivedRecipients: receivedRecipients(mail),
      webLink: mail.webLink || `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(mail.id)}`,
      aliases: [...new Set(aliases.filter(id => id && id !== mail.id))],
      links, ...(issueLinks.length === 1 ? { detailUrl: issueLinks[0] } : {}),
      // Archive identity is internal evidence, never an instruction or a match to
      // a backend request. No exactJoin is derived from message text or headers.
      evidenceRef: proof.id,
    };
    const join = await findJoin(message);
    if (join) message.exactJoin = join;
    const result = await bridge.enqueueMessage(message, { schedule });
    return { ...decision, ticket: result.ticket, evidenceRef: proof.id };
  }
  return {
    capture,
    async reconcile() {
      // Late traces can appear outside the normal mailbox receipt overlap.
      // This independent repair advances no source or publication checkpoint.
      const settings = (await db.doc("issueTrackerSettings/current").get()).data();
      if (settings?.enabled !== true || settings.sourceRecoveryEnabled !== true) return { skipped: "not_configured" };
      const ref = db.doc("issueTrackerState/mailJoinRecovery"), state = (await ref.get()).data() || {};
      let query = db.collection("issueTrackerQueue").where("source", "==", "outlook").orderBy("__name__").limit(40);
      if (state.cursor) query = query.startAfter(state.cursor);
      const page = await query.get(); let linked = 0;
      for (const doc of page.docs) {
        let message = doc.data().message;
        if (!message || message.exactJoin) continue;
        // Legacy snapshots predate recipient extraction: re-fetch exact item.
        // Failure leaves the cursor unchanged so this page is retried.
        if (!message.receivedRecipients?.length && message.from?.toLowerCase() === "alerts@posetek.net") {
          const mail = await graph.message(message.immutableId || message.originalId);
          await capture(mail, { aliases: message.aliases || [], schedule: false });
          message = (await doc.ref.get()).data().message;
        }
        const join = await findJoin(message);
        if (join) { await bridge.enqueueMessage({ ...message, exactJoin: join }, { schedule: false }); linked++; }
      }
      await ref.set({ schemaVersion: 1, cursor: page.size < 40 ? null : page.docs.at(-1).id, lastCheckedAtMillis: now(), examined: page.size,
        linked, enumerationComplete: page.size < 40, sourceCompleteThroughAdvanced: false, publicationConfirmed: false });
      if (linked) await bridge.wake();
      return { examined: page.size, linked, sourceCompleteThroughAdvanced: false };
    },
    async ingress(message) {
      // Arrival payload is an ID notification only. Re-fetch authoritative
      // evidence and its immutable ID in the explicitly allowed mailbox.
      const supplied = message.originalId || message.id;
      if (message.mailbox?.toLowerCase() !== MAILBOX || !supplied) fail("tracker_wrong_mailbox");
      const settings = (await db.doc("issueTrackerSettings/current").get()).data();
      const binding = mailReadBinding(settings);
      if (settings?.enabled !== true || !binding || settings.mailAliasesVerified !== true) fail("tracker_mail_not_configured");
      const mail = await graph.message(supplied);
      const current = (await db.doc("issueTrackerSettings/current").get()).data();
      if (current?.enabled !== true || current.mailAliasesVerified !== true || mailReadBinding(current) !== binding) fail("tracker_capture_configuration_changed");
      const result = await capture(mail, { aliases: [supplied], schedule: true });
      return { queued: Boolean(result.ticket), ignored: !result.relevant };
    },
    async verifiedAliases(originalIds) {
      if (!Array.isArray(originalIds) || originalIds.length > 1000 || new Set(originalIds).size !== originalIds.length) fail("tracker_invalid_alias_list");
      const aliases = {}, targets = new Map();
      for (const id of originalIds) {
        const mail = await graph.message(id);
        // Two original canonical rows resolving to the same immutable item are
        // a migration conflict, not permission to silently drop a source row.
        if (targets.has(mail.id) && targets.get(mail.id) !== id) fail("tracker_alias_migration_conflict");
        targets.set(mail.id, id);
        aliases[digest([MAILBOX, mail.id])] = id;
        aliases[digest([MAILBOX, id])] = id;
      }
      return { mailbox: MAILBOX, verified: true, emailAliases: aliases, checked: originalIds.length };
    },
  };
}
module.exports = { createMailCapture, relevance, receivedRecipients, trustedMailJoin };
