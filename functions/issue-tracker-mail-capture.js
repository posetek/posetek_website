"use strict";
const { fail, digest } = require("./issue-tracker-bridge-model");
const { MAILBOX } = require("./issue-tracker-graph-reader");
const { createEvidenceArchive } = require("./issue-tracker-evidence");
const { mailReadBinding } = require("./issue-tracker-mail-read-proxy");
const Microsoft = require("./microsoft-email-model");
const Identity = require("./issue-tracker-mail-identity");
const { mailIdentityBinding } = require("./issue-tracker-mail-identity-proxy");
const { rowDocumentId } = require("./issue-tracker-bridge-seed");
const ALIAS_BUDGET_MS = 60000, ALIAS_CONCURRENCY = 3, MAX_ALIAS_CANDIDATES = 20, MAX_ALIAS_LOOKUPS = 40;
const CONTENT_FIELDS = ["internetMessageId", "receivedDateTime", "sentDateTime", "subject", "from", "sender", "body", "bodyPreview", "internetMessageHeaders", "toRecipients", "ccRecipients", "bccRecipients"];
const contentSnapshot = mail => Object.fromEntries(CONTENT_FIELDS.map(key => [key, mail[key] ?? null]));
const sameContent = (a, b) => digest(contentSnapshot(a)) === digest(contentSnapshot(b));

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
  const warning = require("./issue-tracker-mail-classification").powerAutomateWarning(mail);
  if (warning) return { relevant: true, reason: warning.reason, category: warning.category, operation: warning.operation, scope: warning.scope };
  const knownProject = /kickai-69dd0|posetek|postek\.net/i.test(all);
  const cloud = /(?:google\.com|googlecloud\.com)$/.test(sender.split("@")[1] || "") || /console\.cloud\.google\.com\/monitoring\//i.test(all);
  if (cloud && knownProject) return { relevant: true, reason: "google_cloud_project_notice" };
  if (cloud && /google\s+cloud|cloud\s+(?:monitoring|billing)|stackdriver|googlecloud|console\.cloud\.google\.com/i.test(all + "\n" + sender)) return { relevant: true, reason: "google_cloud_notice_project_needs_verification" };
  if ((/@alerts\.posetek\.net$/.test(sender) || sender === "alerts@posetek.net") && /(?:issue|error|fail|crash|bug|interrupt|undeliver|bounce|status)/i.test(all)) return { relevant: true, reason: "posetek_issue_notice" };
  if (knownProject && /(?:error|fail(?:ed|ure)?|crash|bug|exception|interrupt|undeliver|bounce|unavailable|monitoring|incident|quota|timeout|throttl)/i.test(all)) return { relevant: true, reason: "posetek_problem_evidence" };
  if (/\b(?:bug report|app (?:crashed|crash|error)|failed workout|workout (?:failed|crashed|error)|crash report)\b/i.test(all)) return { relevant: true, reason: "user_problem_report_needs_triage" };
  return { relevant: false, reason: "no_relevant_incident_evidence" };
}

function createMailCapture({ db, bridge, graph, archive = createEvidenceArchive(db), now = Date.now }) {
  function context() {
    const started = now(), controller = new AbortController(), cache = new Map();
    const timer = setTimeout(() => controller.abort(), ALIAS_BUDGET_MS); timer.unref?.();
    const check = () => { if (controller.signal.aborted || now() - started >= ALIAS_BUDGET_MS) fail("tracker_mail_alias_budget_exceeded"); };
    return { signal: controller.signal, cache, groups: new Map(), queries: new Map(), lookups: 0, check, close: () => clearTimeout(timer), async read(fn) {
      check(); let abort;
      const interrupted = new Promise((_, reject) => { abort = () => reject(Object.assign(new Error("tracker_mail_alias_budget_exceeded"), { code: "tracker_mail_alias_budget_exceeded" })); controller.signal.addEventListener("abort", abort, { once: true }); });
      try { const result = await Promise.race([Promise.resolve().then(fn), interrupted]); check(); return result; }
      finally { controller.signal.removeEventListener("abort", abort); }
    } };
  }
  async function aliasSettings(work) {
    work.settings ||= await work.read(async () => (await db.doc("issueTrackerSettings/current").get()).data()) || {};
    return work.settings;
  }
  async function aliasSeed(work) {
    work.seed ||= await work.read(async () => (await db.doc("issueTrackerState/seed").get()).data()) || {};
    if (work.seed.mailbox && work.seed.mailbox !== MAILBOX) fail("tracker_wrong_mailbox");
    return work.seed;
  }
  async function seededRows(ids, work) {
    const seed = await aliasSeed(work), matches = [...new Set(ids.map(id => seed.emailAliases?.[digest([MAILBOX, id])]).filter(Boolean))];
    if (matches.length > MAX_ALIAS_CANDIDATES) fail("tracker_mail_alias_candidates_exceeded");
    const rows = [];
    for (const id of matches) {
      const row = await work.read(async () => (await db.doc(`issueTrackerRows/${rowDocumentId("emails", id)}`).get()).data());
      if (!row || row.group !== "emails" || row.key !== id || !row.value?.rowId) fail("tracker_invalid_seed_row");
      rows.push({ id, row: row.value });
    }
    return rows.sort((a, b) => Number(a.row.rowId.replace(/^EM-/, "")) - Number(b.row.rowId.replace(/^EM-/, "")) || a.id.localeCompare(b.id));
  }
  async function canonical(id, work) {
    if (!work.cache.has(id)) {
      if (typeof graph.canonicalMessage !== "function") fail("tracker_mail_identity_unverified");
      if (++work.lookups > MAX_ALIAS_LOOKUPS) fail("tracker_mail_alias_lookups_exceeded");
      work.cache.set(id, work.read(() => graph.canonicalMessage(id, { signal: work.signal })));
    }
    return work.cache.get(id);
  }
  async function savedRepair(mail, work) {
    const seed = await aliasSeed(work), group = seed.emailCanonicalItems?.[digest([MAILBOX, mail.id])];
    if (group) return { schemaVersion: 1, ...group };
    const queued = await work.read(async () => (await db.doc(`issueTrackerQueue/mail-${digest([MAILBOX, mail.id])}`).get()).data());
    return queued?.message?.aliasReconciliation || null;
  }
  async function verifiedRepair(repair, mail, work) {
    const message = { immutableId: mail.id, originalId: mail.id, itemIdentity: mail.itemIdentity, aliases: repair?.retainedIds || [] };
    if (!Identity.validReconciliation(repair, message)) fail("tracker_alias_group_unverified");
    const evidence = await work.read(async () => (await db.doc(`issueTrackerEvidence/${repair.evidenceRef}`).get()).data());
    if (evidence?.complete !== true || evidence.source !== "outlook_alias_verification" || evidence.sourceId !== `${MAILBOX}/${mail.id}` || evidence.sha256 !== repair.proofSha256) fail("tracker_alias_group_unverified");
    return repair;
  }
  async function candidates(internetMessageId, work) {
    if (!internetMessageId || internetMessageId.length > 1000) return [];
    if (!work.queries.has(internetMessageId)) {
      const page = await work.read(() => db.collection("issueTrackerQueue").where("message.internetMessageId", "==", internetMessageId).limit(MAX_ALIAS_CANDIDATES + 1).get());
      // Internet-ID discovers candidates only; every retained member is later
      // proven through its exact item-ID mapping and full immutable content.
      if (page.size > MAX_ALIAS_CANDIDATES) fail("tracker_mail_alias_candidates_exceeded");
      const ids = page.docs.map(doc => doc.data()).filter(value => value.source === "outlook" && value.message?.mailbox === MAILBOX)
        .flatMap(value => [value.message.originalId || value.message.id, value.message.immutableId, ...(value.message.aliases || [])]).filter(Boolean);
      work.queries.set(internetMessageId, [...new Set(ids)]);
    }
    return work.queries.get(internetMessageId);
  }
  async function automaticRepair(mail, work, candidateIds = []) {
    if (!Identity.validItemIdentity(mail.itemIdentity, mail.id)) return null;
    const settings = await aliasSettings(work);
    if (settings.enabled !== true || !mailIdentityBinding(settings)) return null;
    const known = [mail.itemIdentity.sourceId, mail.id], prior = await savedRepair(mail, work);
    let rows = await seededRows([...known, ...candidateIds, ...(prior?.retainedIds || [])], work);
    if (prior) {
      await verifiedRepair(prior, mail, work);
      for (const item of rows.filter(item => !prior.retainedIds.includes(item.id))) {
        if (known.some(id => (work.seed.emailAliases || {})[digest([MAILBOX, id])] === item.id)) fail("tracker_alias_group_changed");
        const current = await canonical(item.id, work);
        if (!Identity.validItemIdentity(current.itemIdentity, current.id) || current.itemIdentity.sourceId !== item.id) fail("tracker_mail_identity_unverified");
        if (current.id === mail.id) fail("tracker_alias_group_changed");
      }
      return { repair: prior, primary: rows.find(item => item.id === prior.primaryId), published: Boolean(work.seed.emailCanonicalItems?.[digest([MAILBOX, mail.id])]) };
    }
    if (rows.length < 2) return null;
    // Before freezing a group, enumerate bounded historical candidates even
    // on a collection/arrival conflict. Freezing just two members while a third
    // seeded ID already represents this item would make later repair conflict.
    if (!candidateIds.length) rows = await seededRows([...known, ...await candidates(mail.internetMessageId, work)], work);
    if (work.groups.has(mail.id)) return work.groups.get(mail.id);
    const selected = [], originalItems = []; let next = 0, stopped;
    await Promise.all(Array.from({ length: Math.min(ALIAS_CONCURRENCY, rows.length) }, async () => {
      while (!stopped && next < rows.length) {
        const item = rows[next++];
        try {
          const current = await canonical(item.id, work);
          if (!Identity.validItemIdentity(current.itemIdentity, current.id) || current.itemIdentity.sourceId !== item.id) fail("tracker_mail_identity_unverified");
          if (current.id !== mail.id) {
            if (known.some(id => (work.seed.emailAliases || {})[digest([MAILBOX, id])] === item.id)) fail("tracker_alias_group_changed");
            continue; // Same Internet-ID can belong to a distinct physical copy.
          }
          if (!sameContent(mail, current)) fail("tracker_alias_group_changed");
          selected.push({ requestedId: item.id, itemIdentity: current.itemIdentity, mail: { id: current.id, ...contentSnapshot(current) } });
          originalItems.push({ id: item.id, mail: current.sourceMessage || current });
        } catch (error) { stopped ||= error; }
      }
    }));
    if (stopped) throw stopped;
    if (selected.length < 2) { work.groups.set(mail.id, null); return null; }
    selected.sort((a, b) => a.requestedId.localeCompare(b.requestedId));
    const proof = Identity.aliasGroupProof(selected), ids = new Set(proof.ids), primary = rows.find(item => ids.has(item.id));
    // Full original GET snapshots remain private. The group digest uses exact
    // immutable content, excluding mutable read/folder/link metadata so retries
    // cannot replace a writer-frozen group solely because someone read an email.
    for (const item of originalItems) { work.check(); await archive("outlook", `${MAILBOX}/${item.id}`, item.mail); work.check(); }
    const archived = await archive("outlook_alias_verification", `${MAILBOX}/${proof.canonicalId}`, proof); work.check();
    const result = { primary, repair: { schemaVersion: 1, canonicalId: proof.canonicalId, primaryId: primary.id, retainedIds: proof.ids, evidenceRef: archived.id, proofSha256: archived.sha256 } };
    work.groups.set(mail.id, result); return result;
  }
  async function refreshRepair(automatic, mail, work) {
    // A concurrent writer can publish an earlier queued proof while Graph
    // reads are in flight. Reuse that exact immutable anchor, never enqueue a
    // competing digest against a newly frozen group.
    const seed = await work.read(async () => (await db.doc("issueTrackerState/seed").get()).data());
    const queued = await work.read(async () => (await db.doc(`issueTrackerQueue/mail-${digest([MAILBOX, mail.id])}`).get()).data());
    const group = seed?.emailCanonicalItems?.[digest([MAILBOX, mail.id])];
    const anchor = group ? { schemaVersion: 1, ...group } : queued?.message?.aliasReconciliation;
    if (!anchor) return;
    await verifiedRepair(anchor, mail, work);
    if (anchor.canonicalId !== automatic.repair.canonicalId || anchor.primaryId !== automatic.repair.primaryId || digest([...anchor.retainedIds].sort()) !== digest([...automatic.repair.retainedIds].sort())) fail("tracker_alias_group_changed");
    automatic.repair = anchor;
  }
  async function findJoin(message) {
    if (!message.internetMessageId || message.internetMessageId.length > 1000 || !message.receivedRecipients?.length || message.from?.toLowerCase() !== "alerts@posetek.net") return null;
    const matches = await db.collection("userIssueOutbox").where("microsoft.internetMessageId", "==", message.internetMessageId).limit(2).get();
    if (matches.size !== 1) return null;
    const doc = matches.docs[0], job = { ...doc.data(), id: doc.id };
    const event = (await db.doc(`userIssueOccurrences/${doc.id}`).get()).data();
    return trustedMailJoin(message, job, event ? { ...event, id: doc.id } : null);
  }
  async function captureInternal(mail, { aliases = [], schedule = false, aliasReconciliation, candidateIds = [] } = {}, work) {
    work.check();
    if (!mail || typeof mail.id !== "string" || !Number.isFinite(Date.parse(mail.receivedDateTime))) fail("tracker_graph_invalid_message");
    const original = mail.sourceMessage || mail;
    if (typeof graph.canonicalize === "function") mail = await graph.canonicalize(mail);
    const decision = relevance(mail);
    if (!decision.relevant) return { ...decision, ticket: null };
    const automatic = aliasReconciliation ? null : await automaticRepair(mail, work, candidateIds);
    if (automatic) { aliasReconciliation = automatic.repair; aliases = [...new Set([...aliases, ...aliasReconciliation.retainedIds])]; }
    const proof = await archive("outlook", `${MAILBOX}/${mail.itemIdentity?.sourceId || mail.id}`, original);
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
    const verifiedIdentity = Identity.validItemIdentity(mail.itemIdentity, mail.id);
    const message = { mailbox: MAILBOX, originalId: mail.id,
      ...(verifiedIdentity ? { immutableId: mail.id, itemIdentity: mail.itemIdentity } : {}),
      receivedDateTime: mail.receivedDateTime, subject: mail.subject || "", body: { contentType: mail.body.contentType.toLowerCase(), content: excerpt },
      ...(from ? { from } : {}), ...(mail.internetMessageId ? { internetMessageId: mail.internetMessageId } : {}),
      receivedRecipients: receivedRecipients(mail),
      webLink: mail.webLink || `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(mail.id)}`,
      // A supplied arrival ID is an alias only after exact item-ID evidence.
      // An ignored Prefer header must never label a REST ID as immutable.
      aliases: [...new Set([...(aliasReconciliation ? aliases : []), ...(verifiedIdentity ? [mail.itemIdentity.sourceId] : [])].filter(id => id && id !== mail.id))],
      links, ...(issueLinks.length === 1 ? { detailUrl: issueLinks[0] } : {}),
      // Archive identity is internal evidence, never an instruction or a match to
      // a backend request. No exactJoin is derived from message text or headers.
      evidenceRef: proof.id,
      ...(aliasReconciliation ? { aliasReconciliation } : {}),
    };
    const join = await findJoin(message);
    if (join) message.exactJoin = join;
    if (automatic?.primary) {
      let old;
      for (const id of automatic.repair.retainedIds) {
        const retained = await work.read(async () => (await db.doc(`issueTrackerQueue/mail-${digest([MAILBOX, id])}`).get()).data());
        if (retained?.message?.exactJoin && (!join || digest(retained.message.exactJoin) !== digest(join))) fail("tracker_mail_join_changed");
        if (id === automatic.primary.id) old = retained;
      }
      // Retain historical labels and original source link; neither is new proof
      // of an actor, a backend attempt or a canonical item.
      for (const key of ["category", "functionName", "operation", "affected"]) if (old?.message?.[key] !== undefined) message[key] = old.message[key];
      if (automatic.primary.row.links?.["Outlook source"]) message.webLink = automatic.primary.row.links["Outlook source"];
      await refreshRepair(automatic, mail, work);
      message.aliasReconciliation = automatic.repair;
    }
    work.check();
    if (work.settings && mailIdentityBinding(work.settings)) {
      const current = await work.read(async () => (await db.doc("issueTrackerSettings/current").get()).data());
      if (current?.enabled !== true || mailReadBinding(current) !== mailReadBinding(work.settings)) fail("tracker_capture_configuration_changed");
    }
    const result = await bridge.enqueueMessage(message, { schedule });
    return { ...decision, ticket: result.ticket, queued: result.queued, evidenceRef: proof.id };
  }
  async function capture(mail, options) {
    const work = context();
    try { return await captureInternal(mail, options, work); } finally { work.close(); }
  }
  async function historicalAliases(message, work) {
    const settings = await aliasSettings(work);
    if (!mailIdentityBinding(settings) || !message?.internetMessageId || message.internetMessageId.length > 1000) return false;
    const candidateIds = await candidates(message.internetMessageId, work), rows = await seededRows(candidateIds, work);
    if (rows.length < 2) return false;
    const seed = await aliasSeed(work), registered = [...new Set(rows.map(item => seed.emailCanonicalAliases?.[digest([MAILBOX, item.id])]).filter(Boolean))];
    if (registered.length === 1 && rows.every(item => seed.emailCanonicalItems?.[registered[0]]?.retainedIds.includes(item.id))) return false;
    const current = await canonical(message.immutableId || message.originalId || message.id, work);
    const repair = await automaticRepair(current, work, candidateIds);
    if (!repair || repair.published) return false;
    const result = await captureInternal(current, { candidateIds }, work);
    return result.queued !== false;
  }
  return {
    capture,
    async capturePage(records) {
      if (!Array.isArray(records) || records.length > 50) fail("tracker_capture_invalid_page");
      const work = context(), results = [];
      try { for (const record of records) results.push(await captureInternal(record, {}, work)); return results; }
      finally { work.close(); }
    },
    async reconcile() {
      // Late traces can appear outside the normal mailbox receipt overlap.
      // This independent repair advances no source or publication checkpoint.
      const settings = (await db.doc("issueTrackerSettings/current").get()).data();
      if (settings?.enabled !== true || settings.sourceRecoveryEnabled !== true) return { skipped: "not_configured" };
      const ref = db.doc("issueTrackerState/mailJoinRecovery"), state = (await ref.get()).data() || {};
      let query = db.collection("issueTrackerQueue").where("source", "==", "outlook").orderBy("__name__").limit(40);
      if (state.cursor) query = query.startAfter(state.cursor);
      const page = await query.get(); let linked = 0, aliasesReconciled = 0;
      const work = context();
      try { for (const doc of page.docs) {
        work.check();
        let message = doc.data().message;
        if (!message) continue;
        if (await historicalAliases(message, work)) aliasesReconciled++;
        if (message.exactJoin) continue;
        // Legacy snapshots predate recipient extraction: re-fetch exact item.
        // Failure leaves the cursor unchanged so this page is retried.
        if (!message.receivedRecipients?.length && message.from?.toLowerCase() === "alerts@posetek.net") {
          const id = message.immutableId || message.originalId;
          const mail = typeof graph.canonicalMessage === "function" ? await canonical(id, work) : await work.read(() => graph.message(id, { signal: work.signal }));
          await captureInternal(mail, { aliases: message.aliases || [], schedule: false }, work);
          message = (await doc.ref.get()).data().message;
        }
        const join = await findJoin(message);
        if (join) { await bridge.enqueueMessage({ ...message, exactJoin: join }, { schedule: false }); linked++; }
      }
      work.check();
      await ref.set({ schemaVersion: 1, cursor: page.size < 40 ? null : page.docs.at(-1).id, lastCheckedAtMillis: now(), examined: page.size,
        linked, aliasesReconciled, enumerationComplete: page.size < 40, sourceCompleteThroughAdvanced: false, publicationConfirmed: false });
      } finally { work.close(); }
      if (linked || aliasesReconciled) await bridge.wake();
      return { examined: page.size, linked, aliasesReconciled, sourceCompleteThroughAdvanced: false };
    },
    async ingress(message) {
      // Arrival payload is an ID notification only. Re-fetch authoritative
      // evidence and its immutable ID in the explicitly allowed mailbox.
      const supplied = message.originalId || message.id;
      if (message.mailbox?.toLowerCase() !== MAILBOX || !supplied) fail("tracker_wrong_mailbox");
      const settings = (await db.doc("issueTrackerSettings/current").get()).data();
      const binding = mailReadBinding(settings);
      if (settings?.enabled !== true || !binding || settings.mailAliasesVerified !== true) fail("tracker_mail_not_configured");
      const work = context();
      try {
      const mail = await work.read(() => (graph.canonicalMessage || graph.message)(supplied, { signal: work.signal }));
      const current = (await db.doc("issueTrackerSettings/current").get()).data();
      if (current?.enabled !== true || current.mailAliasesVerified !== true || mailReadBinding(current) !== binding) fail("tracker_capture_configuration_changed");
      const result = await captureInternal(mail, { aliases: [supplied], schedule: true }, work);
      return { queued: Boolean(result.ticket), ignored: !result.relevant };
      } finally { work.close(); }
    },
    async verifiedAliases(originalIds) {
      if (!Array.isArray(originalIds) || originalIds.length > 1000 || new Set(originalIds).size !== originalIds.length) fail("tracker_invalid_alias_list");
      const aliases = {}, targets = new Map();
      for (const id of originalIds) {
        if (typeof graph.canonicalMessage !== "function") fail("tracker_mail_identity_unverified");
        const mail = await graph.canonicalMessage(id);
        if (!Identity.validItemIdentity(mail.itemIdentity, mail.id) || mail.itemIdentity.sourceId !== id) fail("tracker_mail_identity_unverified");
        // Two original canonical rows resolving to the same immutable item are
        // a migration conflict, not permission to silently drop a source row.
        if (targets.has(mail.id) && targets.get(mail.id) !== id) fail("tracker_alias_migration_conflict");
        targets.set(mail.id, id);
        aliases[digest([MAILBOX, mail.id])] = id;
        aliases[digest([MAILBOX, id])] = id;
      }
      return { mailbox: MAILBOX, verified: true, emailAliases: aliases, checked: originalIds.length };
    },
    async proveAliasGroup(originalIds, { sourceIdTypes = {} } = {}) {
      if (!Array.isArray(originalIds) || originalIds.length < 2 || originalIds.length > 20 || new Set(originalIds).size !== originalIds.length || typeof graph.canonicalMessage !== "function") fail("tracker_invalid_alias_group");
      const items = [];
      for (const requestedId of originalIds) {
        const mail = await graph.canonicalMessage(requestedId, { sourceIdType: sourceIdTypes[requestedId] || "restId" });
        items.push({ requestedId, itemIdentity: mail.itemIdentity, mail });
      }
      return Identity.aliasGroupProof(items);
    },
    async reconcileAliasGroup(proof, { primaryId, schedule = true } = {}) {
      Identity.verifyAliasGroup(proof);
      if (!proof.ids.includes(primaryId)) fail("tracker_invalid_alias_group");
      const archived = await archive("outlook_alias_verification", `${MAILBOX}/${proof.canonicalId}`, proof);
      return capture(proof.items[0].mail, { aliases: proof.ids, schedule, aliasReconciliation: {
        schemaVersion: 1, canonicalId: proof.canonicalId, primaryId, retainedIds: proof.ids,
        evidenceRef: archived.id, proofSha256: archived.sha256,
      } });
    },
  };
}
module.exports = { createMailCapture, relevance, receivedRecipients, trustedMailJoin };
