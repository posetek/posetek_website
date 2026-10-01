# Event-driven issue tracker candidate

Status: **not live**. Dylan selected Power Automate on October 1, 2026 and
requires costs to be shown before a purchase. The existing hourly Codex tracker
remains the active workflow until the replacement is fully verified. No new
license, trial, Microsoft app registration, live Office Script, backend deployment
or cutover is confirmed by this document.

## Intended behavior

Backend issue, admin status and email-delivery changes enter an independent
durable queue. Outlook arrivals enter the same queue through a separate flow.
The queue batches bursts and calls one serialized Power Automate writer, which
runs the native Office Script against the existing shared cloud workbook. A
verified script receipt is required before acknowledging a batch. Email sending
and its quota are independent of tracker capture.

The shared master stays at **PoseTek > Technology > Website > User Issue Tracker >
PoseTek Issue Tracker.xlsx** in Dylan's PoseTek OneDrive. Dylan owns it; Nolan and
Taiyo retain their existing editing access. The writer preserves Status, Owner,
Due and Fix notes by Action ID. Raw email bodies, private queue state, scripts,
captures and backups do not belong in this shared folder or Git.

The Outlook connector can have polling latency; an arrival-triggered flow is not
a promise of instantaneous delivery. Backend changes normally coalesce briefly
before writing. Quotas, file locks and failed writes retain queued work.

## Candidate components

- `functions/issue-tracker-bridge*.js`: independent queue, material delivery
  changes, frozen batches, authenticated transport and bounded mailbox ingress.
- `functions/issue-tracker-normalize.js`: exact source identity, actor versus
  target, separate receipt and occurrence times, conservative evidence and remedies.
- `scripts/issue-tracker/`: native Office Script, bootstrap and contract. The
  writer preserves stable row IDs and checks existing machine-cell hashes.
- `deployments/issue-tracker/`: isolated packaging; the ordinary functions index
  does not export this candidate. No website, planner, email-sender or native
  deployment is required.

Unknown identities and causes remain explicit. Generic device diagnostics do
not establish a crash. Repeated Google Cloud emails retain separate evidence
rows while project and incident identifiers link the service incident. A shared
subject, issue fingerprint or nearby timestamp is not proof of the same attempt.
Recovery messages do not close manual actions. Partial provider delivery remains
partial; new three-recipient jobs require evidence for each recipient.

## Power Automate setup

The browser draft is named `PoseTek issue tracker - event writer`. Its request
trigger is restricted to specific tenant identities, with concurrency set to
one and secure inputs/outputs. It is currently an **unsaved draft**, stopped at
the Excel Online (Business) connection prompt. A browser draft is not a running
flow or a durable deployment artifact.

Finish the writer only after the connection is approved and licensing is
confirmed. Allowlist the dedicated caller's service-principal object ID; do not
use the trigger's legacy `Anyone` option or treat a secret URL as authentication.
Pass the serialized request to the script's `payloadJson` input. Disable the
Run script action's automatic retries, because the backend owns the frozen-batch
retry and call budget. Return HTTP 200 with the script receipt only after script
success. A request acceptance/202 is not a confirmed workbook write.

The Outlook intake uses the existing Dylan mailbox connection, `When a new
email arrives (V3)`, and a narrow authenticated queue endpoint. Secure its inputs
and outputs. Preserve the source message ID, Internet Message-ID when available,
original receipt time, sender, subject, original body and evidence URL. Filter
relevance using the sender, project, incident links and content, including Google
Cloud/Cloud Monitoring and delivery failures; do not rely on one subject or
unread status. Do not send emails, move messages or mark them read.

**Mailbox coverage is still a cutover gate.** Inventory routing rules and folders,
then configure supported arrival coverage and a tested recovery reader with full
pagination and durable receipt-time checkpoints. Inbox-only is not whole-mailbox
coverage, and moved messages do not reliably retrigger arrival flows. Keep
separate complete-through and last-checked timestamps for Outlook and backend.
An event arrival alone establishes no complete-through boundary. Catch up gaps
with fixed UTC bounds and the existing 30-minute overlap; only commit successful
source reads. Do not advertise equivalent coverage before this is implemented.

## Cost and access gates

The inspected account has Power Automate for Office 365 and Free licenses. The
HTTP integration uses premium capabilities. Microsoft lists Premium at **$15 per
user/month, paid yearly ($180/year before tax)** and Process at **$150 per
bot/month, paid yearly ($1,800/year before tax)**. These are public list prices,
not a quote or purchase authorization. Determine the actual saved flow's type,
owner/caller licensing context and applicable entitlement before recommending a
purchase. Do not assume a single Premium user license covers a service-principal
HTTP caller. Microsoft also documents a designated licensed-user option for
service-principal-owned flows; its suitability here remains unverified.

Cloud Tasks, Functions, Firestore and Secret Manager can add usage charges in the
existing Google Cloud project. There is no verified fixed monthly estimate yet.
The bridge limits writer transport attempts to 1,200 per UTC day; this does not
reserve Office Script quota from the user's other flows. Excel Run script has
its own per-user limits (currently 1,600 calls/day). No paid upgrade is approved.

Creating the Excel connection and a dedicated backend caller grants persistent
Microsoft access. Obtain the applicable access approval at that setup step.
Keep caller credentials and the bounded mailbox-ingress secret in Secret Manager,
and keep Power Automate action inputs/outputs secure. No credential belongs in
the workbook, flow screenshots, repository or this document.

## Cutover and recovery gates

1. Reconcile the pending October 1 hourly candidate against fresh cloud bytes.
   The 2:10 PM run validated a local candidate but did not confirm publication;
   do not initialize from a mixture of its local state and the older cloud file.
   Exact receipts, hashes and recovery instructions are private in
   `.netlify/error-tracker-2026-10-01/RECURRING-TRACKER.md`.
2. Complete licensing, access, flow configuration and private backend deployment
   review. Keep `enabled`, `seedVerified` and `connectionVerified` false until the
   respective evidence exists. Verify server-only collection access and private
   task invocation. Do not alter production issue or email records during setup.
3. Test the generated scripts in a private test workbook with synthetic rows, including
   sorting, saved human edits, duplicate arrivals, partial failures, quota deferral,
   stale revisions and exact replay. Offline mocks are not live Excel acceptance.
4. Prepare a verified migration seed from the confirmed master and ledger. Reuse
   all Action/Instance/Email IDs and machine hashes; review legacy action mappings.
   The bootstrap keeps the three existing visible tabs, moves daily delivery rows
   into a native table to the right of Instances, and adds hidden sync state.
5. Use an exclusive maintenance window to pause the old writer, bootstrap the
   cloud workbook, verify counts/formulas/links/human fields, seed the queue and
   catch up both sources. Never run both writers against the master. Keep the old
   ledger/read coverage available for gap recovery, but do not resume the old
   whole-file writer against a bootstrapped workbook without reviewed rollback.
6. Confirm actual workbook receipts for both intake paths and meaningful delivery
   updates before declaring the replacement live. Stop the hourly heartbeat only
   at the verified cutover; retain an explicit source-recovery procedure.

Excel does not provide a cross-cell transaction or an exclusive coauthor lock.
Serialization and post-read checks reduce risk, but do not make simultaneous
manual editing supported. Team members should save and close the workbook after
editing. A conflicting, partially applied or changed row stops acknowledgement
and requires reconciliation. Preserve the frozen batch and recoverable backup;
never force a whole-file overwrite to clear a conflict.

## Candidate verification

The combined offline suite passed **82 tests**: 23 bridge, 36 normalizer and
23 native writer/bootstrap/converter checks. It covers replay after an unknown
write outcome, competing workers, concurrent source changes, exact receipt
counts, sharded historical snapshots larger than a single Firestore document,
sorted human-field preservation, recurrence evidence, reviewed identity and
diagnosis preservation, partial recipient delivery and the real normalizer to
writer contract. Isolated packaging and paste-ready script generation passed.

These checks use fake Firestore and native API fixtures. They do not establish
Power Automate licensing, a live Microsoft connection, host compilation/runtime
acceptance, full mailbox coverage or successful cloud publication. The shared
workbook and committed source checkpoints were unchanged by this candidate work.

## References checked October 1, 2026

- [Microsoft pricing](https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing)
- [Licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs)
- [Service principal licensing](https://learn.microsoft.com/en-us/power-automate/service-principal-support)
- [HTTP trigger authentication](https://learn.microsoft.com/en-us/power-automate/oauth-authentication)
- [Excel connector limits](https://learn.microsoft.com/en-us/connectors/excelonlinebusiness/)
- [Office Script limits](https://learn.microsoft.com/en-us/office/dev/scripts/testing/platform-limits)
- [Email trigger troubleshooting](https://learn.microsoft.com/en-us/power-automate/email-troubleshooting)
