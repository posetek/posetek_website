# Event-driven issue tracker candidate

Status: **not live**. Dylan selected Power Automate on October 1, 2026 and
requires costs to be shown before a purchase. The existing hourly Codex tracker
remains the active workflow until the replacement is fully verified. No new
license or trial was purchased, and no backend deployment or master-workbook
cutover occurred. Dylan's Excel connection is confirmed. A saved writer targets
only a private test workbook; Microsoft blocks activation for lack of a Premium
license. Native script performance work and final transport verification remain
in progress.

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
- `functions/issue-tracker-recovery.js`: bounded outbox recovery every 15 minutes,
  separate from immediate event capture; resumes missed material changes and
  stranded tasks without overriding writer blocks or claiming source coverage.
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

The recovery candidate reads at most 200 outbox records per invocation, retaining
a fixed creation-time upper bound and document-ID cursor across pages. A full
enumeration refreshes old delivery states as well as missed creations. Its
private `issueTrackerState/outboxRecovery` record distinguishes the active scan,
last completed enumeration, last check/failure and writer-block reason. Because
source data can change between pages, completion is not a consistent snapshot
and never advances backend or Outlook complete-through checkpoints. It supplies
no mailbox recovery. Scheduled execution and private task IAM require live
verification before it can be relied on.

## Power Automate setup

The saved flow `PoseTek issue tracker - event writer` has ID
`b011912f-bb15-453f-92ef-761d223095b4`. Excel Online (Business) is connected as
`dylank@posetek.net`, and the writer targets only the private test workbook.
Neither the backend nor Outlook intake is connected to this writer. Microsoft
reports a Premium-license block. The saved details show **Suspended**, type
**Automated**, owned by Dylan, and running on its owner's plan. This is not a
live tracker replacement.

The request trigger is restricted to specific tenant identities, with concurrency
set to one and secure inputs/outputs. Saving with concurrency one and a synchronous
Response failed; this configuration requires an asynchronous Response. The
candidate transport polls for a final, verified script receipt, with at most 24
polls inside 125 seconds. Polling stays on the original HTTPS origin and workflow;
redirects are rejected. Timeout retains the frozen batch for identical retry.
The actual tenant's polling URL and final receipt still need live verification.
An initial HTTP 202 is never a confirmed workbook write.

Complete licensing and caller setup before activation. Allowlist the dedicated
caller's service-principal object ID; do not
use the trigger's legacy `Anyone` option or treat a secret URL as authentication.
Pass the serialized request to the script's `payloadJson` input. Disable the
Run script action's automatic retries, because the backend owns the frozen-batch
retry and call budget. Only the final successful response containing the exact
verified script receipt may acknowledge the frozen batch.

The planned Outlook intake uses the existing Dylan mailbox connection, `When a new
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
not a quote or purchase authorization. The saved flow is Automated and runs on
Dylan's plan. [Microsoft's licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs#who-needs-to-purchase-a-premium-license)
says automated flows use the owner's license regardless of who starts them;
only the owner needs Premium for premium connectors. On that evidence, the
recommended path is **one Premium license for
Dylan, $180/year before tax**, retaining his ownership. Verify Microsoft accepts
the assigned entitlement when activating the flow; no purchase or trial occurred.

The earlier service-principal-owned/designated-user alternative is unnecessary
for this confirmed Automated flow. It would add Dataverse and ownership-rights
requirements that remain unverified. The authenticated backend caller can remain
a separate service principal without becoming the flow owner.

The PoseTek Microsoft 365 admin catalog was also inspected: the tenant has
Business Basic and no purchased Premium subscription. Its Premium offer shows
one-year prepaid at $180/license/year; annual commitment billed monthly at
$15.75/month; and monthly commitment at $18/month, before checkout taxes/fees.
The one-year prepaid option is the lowest regular subscription price shown.
Nolan and Taiyo do not need Premium solely to edit the tracker or receive alerts.
Pay-as-you-go is $0.60 per billable cloud-flow run and exceeds the $15/month
annual-plan equivalent above 25 such runs/month; it is not the recommended fit
for ongoing incident capture. No plan, trial, or billing change was submitted.

Cloud Tasks, Functions, Firestore and Secret Manager can add usage charges in the
existing Google Cloud project. There is no verified fixed monthly estimate yet.
The bridge limits writer transport attempts to 1,200 per UTC day; this does not
reserve Office Script quota from the user's other flows. Excel Run script has
its own per-user limits (currently 1,600 calls/day). No paid upgrade is approved.

The Excel connection is confirmed; the dedicated backend caller is not configured.
Creating that caller grants persistent Microsoft access. Obtain the applicable
access approval at that setup step.
Keep caller credentials and the bounded mailbox-ingress secret in Secret Manager,
and keep Power Automate action inputs/outputs secure. No credential belongs in
the workbook, flow screenshots, repository or this document.

## Cutover and recovery gates

1. Reconcile the pending October 1 hourly candidate against fresh cloud bytes.
   The 2:10 PM run validated a local candidate but did not confirm publication;
   do not initialize from a mixture of its local state and the older cloud file.
   Exact receipts, hashes and recovery instructions are private in
   `.netlify/error-tracker-2026-10-01/RECURRING-TRACKER.md`.
   Fresh browser download `(10).xlsx` still matched the old cloud hash
   `b49ac4d...`; validated local candidate `5e209015...` remains unpublished.
   The committed ledger and both source checkpoints are unchanged.
2. Complete licensing, access, flow configuration and private backend deployment
   review. Keep `enabled`, `seedVerified` and `connectionVerified` false until the
   respective evidence exists. Verify server-only collection access and private
   task invocation. Do not alter production issue or email records during setup.
3. Complete native acceptance in the private test workbook. Initialize, upsert and
   exact replay passed with two actions, three instances, three emails and one
   daily row at revision one, preserving human fields. This small synthetic test
   does not establish scale, performance, both intake paths or failure recovery.
   The optimized one-row update then passed at revision two in 24,463 ms; exact
   replay took 520 ms. This tiny browser test is not representative-size Power
   Automate acceptance. Verify sorting, partial failures, quota deferral and stale
   revisions in the native host before migration.
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

The combined offline suite passed **108/108 tests**. It covers replay after an unknown
write outcome, competing workers, concurrent source changes, exact receipt
counts, sharded historical snapshots larger than a single Firestore document,
sorted human-field preservation, recurrence evidence, reviewed identity and
diagnosis preservation, partial recipient delivery and the real normalizer to
writer contract. Isolated packaging and paste-ready script generation passed.

Offline checks use fake Firestore and native API fixtures. The separate native
synthetic workbook run confirms the limited initialize/upsert/replay behavior
described above, including literal date/numeric-ID preservation. The optimized
writer is saved in Dylan's private Office Scripts folder. Neither evidence establishes licensing, full
mailbox coverage or shared-master publication. The shared workbook and committed
source checkpoints were unchanged by this candidate work.

## References checked October 1, 2026

- [Microsoft pricing](https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing)
- [Licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs)
- [Service principal licensing](https://learn.microsoft.com/en-us/power-automate/service-principal-support)
- [HTTP trigger authentication](https://learn.microsoft.com/en-us/power-automate/oauth-authentication)
- [Excel connector limits](https://learn.microsoft.com/en-us/connectors/excelonlinebusiness/)
- [Office Script limits](https://learn.microsoft.com/en-us/office/dev/scripts/testing/platform-limits)
- [Asynchronous flow responses](https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/asychronous-flow-pattern)
- [Email trigger troubleshooting](https://learn.microsoft.com/en-us/power-automate/email-troubleshooting)
