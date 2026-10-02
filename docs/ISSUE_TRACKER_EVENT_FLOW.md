# Event-driven issue tracker candidate

Status: **not live**. Dylan reported purchasing Power Automate Premium on
October 1 and authorized setup. An available Premium license is now assigned to
dylank@posetek.net; the saved private writer no longer has the former licensing
block. Dylan explicitly paused the hourly Codex tracker to finish Power Automate
setup. `update-posetek-issue-tracker` is **PAUSED**; do not restart it automatically.
No backend deployment or shared-master cutover has occurred. Excel and Outlook
connections, the dedicated application/service
principal and eleven fixed credential secrets are configured. The writer is On
only for the private synthetic workbook and allows only that service principal.
Actual private Power Automate transport and identical replay returned exact
revision-six native receipts. Mailbox-scoped access, backend deployment and
shared-master migration remain gates. Neither cloud-mail intake nor the email
sender flow is imported; production Resend remains active. The pause does not
establish replacement coverage; migration must catch up from the committed cutoffs.
The separately approved Dylan Send As grant for `alerts@posetek.net` was verified
at `2026-10-02T05:29:31.9389018Z`, preserving Nolan's grant, Dylan's Full Access
and sent-copy settings. This sent no email and does not prove delivery or mailbox
reading through application RBAC.

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
- `functions/issue-tracker-{graph-reader,mail-capture,source-capture,evidence}.js`:
  fully paged whole-mailbox recovery, private original evidence, immutable-ID
  aliases, separate capture/publication checkpoints and backend occurrence intake.
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
Neither the backend nor Outlook intake is connected to this writer. After
Premium assignment and resaving, its saved details show **On**, type
**Automated**, owned by Dylan, running on its owner's plan. This is not a live
tracker replacement. The dedicated sender mailbox alerts@posetek.net exists;
email migration is described in the [Microsoft package](../deployments/microsoft-email/README.md).

The request trigger is restricted to the dedicated caller's service-principal
object ID, with concurrency set to one and secure inputs/outputs. Saving with
concurrency one and a synchronous Response failed; this configuration requires an asynchronous Response. The
candidate transport polls for a final, verified script receipt, with at most 24
polls inside 125 seconds. Polling stays on the original HTTPS origin and workflow;
redirects are rejected. Timeout retains the frozen batch for identical retry.
Actual tenant calls now pass through HTTP 202 polling to the exact final native
receipt, including identical replay. The observed Location omits the invoke URL's
`/cu/30/` routing segment. Only that Power Platform route segment is normalized
for comparison; origin, workflow and `/runs/` remain exact, and the returned URL
is requested unchanged. An initial HTTP 202 is never a confirmed workbook write.

Complete licensing and caller setup before activation. Allowlist the dedicated
caller's service-principal object ID; do not
use the trigger's legacy `Anyone` option or treat a secret URL as authentication.
Request the client-credentials scope `https://service.flow.microsoft.com//.default`.
The second slash retains the exact `https://service.flow.microsoft.com/` audience
required by the [public-cloud HTTP trigger](https://learn.microsoft.com/en-us/power-automate/oauth-authentication).
Microsoft's [v2 scope rules](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#trailing-slash-and-default)
append `/.default` to the complete resource identifier. The single-slash scope
issued an audience without the final slash during private setup and was rejected
with HTTP 403 `MisMatchingOAuthClaims`; no flow run was recorded for that attempt.
Safe claim comparison confirmed the corrected audience with the same tenant and
service-principal identity. Subsequent final receipts independently established
the private writer's actual transport and replay result.
Pass the serialized request to the script's `payloadJson` input. Disable the
Run script action's automatic retries, because the backend owns the frozen-batch
retry and call budget. Only the final successful response containing the exact
verified script receipt may acknowledge the frozen batch.

The prepared Outlook intake uses the existing Dylan mailbox connection, `When a new
email arrives (V3)`, and a narrow authenticated queue endpoint. Its secured
request carries only the message ID; the backend re-reads the original from
Graph with immutable-ID preference. Preserve Internet Message-ID as evidence,
original receipt time, sender, subject, original body and evidence URL. Filter
relevance using the sender, project, incident links and content, including Google
Cloud/Cloud Monitoring and delivery failures; do not rely on one subject or
unread status. Do not send emails, move messages or mark them read.

**Live mailbox coverage is still a cutover gate.** The arrival flow covers Inbox;
the independent candidate Graph reader traverses the entire authorized mailbox
without folder, subject or read-state filters. It uses fixed UTC bounds, a
30-minute overlap and persisted full pagination. Capture completion is separate
from publication: the latter requires native workbook receipts for every queued
version. Historical Outlook IDs must be directly re-read and mapped to immutable
IDs before enabling capture. Internet Message-ID alone cannot merge rows. Verify
Exchange application RBAC restricts content access to Dylan, including negative
tests for other mailboxes. Offline tests do not establish that live coverage.

## Cost and access gates

Before the user's purchase, the account had Office 365 and Free licenses. The
HTTP integration uses premium capabilities. Microsoft lists Premium at **$15 per
user/month, paid yearly ($180/year before tax)** and Process at **$150 per
bot/month, paid yearly ($1,800/year before tax)**. These are public list prices,
not a quote or purchase authorization. The saved flow is Automated and runs on
Dylan's plan. [Microsoft's licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs#who-needs-to-purchase-a-premium-license)
says automated flows use the owner's license regardless of who starts them;
only the owner needs Premium for premium connectors. On that evidence, the
recommended path is **one Premium license for
Dylan, $180/year before tax**, retaining his ownership. Microsoft accepted the
assigned entitlement in the actual private writer runs; the agent did not submit
a purchase or trial.

The earlier service-principal-owned/designated-user alternative is unnecessary
for this confirmed Automated flow. It would add Dataverse and ownership-rights
requirements that remain unverified. The authenticated backend caller can remain
a separate service principal without becoming the flow owner.

The earlier Microsoft 365 catalog inspection (before the reported purchase) showed
Business Basic and the following Premium offers:
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
its own per-user limits (currently 1,600 calls/day). No further paid upgrade is authorized.

The dedicated application and service principal now exist. Eleven fixed
credential/callback/ingress secrets were installed and read back as Secret Manager
version 1; endpoint secrets are not installed and runtime access remains to be verified. A bounded
live message-trace query returned HTTP 200 with zero matches. That proves query
access only, not delivery, mailbox-content access or writer transport.

Dylan-only Exchange application RBAC is still blocked: organization customization
completed and `IsDehydrated` is false, but a fresh authenticated session at
2026-10-02T04:41Z still received the prerequisite error from `New-ManagementScope`.
The cause of this contradictory Microsoft failure is unconfirmed. Resolve the
narrow scope without granting tenant-wide Mail.Read. Actual positive Dylan and
negative other-mailbox reads, followed by direct legacy-to-immutable ID mapping,
remain required before source capture is enabled.

The browser upload tool still rejects file selection for the prepared email package.
Neither the email sender nor cloud-mail intake is installed. Production Resend
remains active. The hourly workbook publisher is paused by user request; do not
resume it to work around these setup blockers.
Keep caller credentials and the bounded mailbox-ingress secret in Secret Manager,
and keep Power Automate action inputs/outputs secure. No credential belongs in
the workbook, flow screenshots, repository or this document.

## Cutover and recovery gates

1. Obtain a fresh cloud workbook and reconcile any new hourly candidate. The
   earlier b49ac4d/5e209015 discrepancy was resolved: the confirmed master now
   contains 23 actions, 598 instances and 128 emails, SHA-256
   `c9bf937b4cd1507d9f376bc861d0cb3779443b6a522e190ac48fb79c68f69d19`, with
   both source cutoffs at `2026-10-02T04:56:51.854Z`. There was no unfinished
   candidate at that checkpoint. Exact receipts and recovery instructions are
   private in `.netlify/error-tracker-2026-10-01/RECURRING-TRACKER.md`.
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
   revisions in the native host before migration. The larger private fixture now
   matches 23 actions/560 instances/128 emails. Native testing exposed Excel's
   15-significant-digit numeric storage and overlapping range/per-cell hyperlinks;
   the fixes passed exact frozen-batch recovery, append and ordinary-update tests.
   Append took 20,281 ms; an ordinary update took 17,485 ms, with exact replay
   taking 1,160 ms. Saved fields, adjacent daily data and the Monitoring footer
   survived. These are browser-host tests, not Power Automate transport tests.
   The fresh read-only preflight at `2026-10-02T04:20:06.051Z` verified ready
   revision five with no pending batch, current fixture counts 23/561/131/1,
   all 23 saved human-field records, 716 source rows, 858 links, formulas, five
   receipts and the moved footer. Actual flow transport then returned two exact
   final receipts for the identical batch at revision six, with no duplicate
   rows. The earlier revision-six native readback preserved all human fields,
   links, formulas and footer. The final post-replay inspection at
   `2026-10-02T04:51:56.787Z` confirmed those values, six receipts and ready
   revision six with no pending batch.
   See [native acceptance](../scripts/issue-tracker/NATIVE_ACCEPTANCE.md).
4. Prepare a verified migration seed from the confirmed master and ledger. Reuse
   all Action/Instance/Email IDs and machine hashes; review legacy action mappings.
   The bootstrap keeps the three existing visible tabs, moves daily delivery rows
   into a native table to the right of Instances, and adds hidden sync state.
5. Use an exclusive maintenance window and confirm the old writer remains paused.
   Bootstrap the cloud workbook, verify counts/formulas/links/human fields, seed the queue and
   catch up both sources. Never run both writers against the master. Keep the old
   ledger/read coverage available for gap recovery, but do not resume the old
   whole-file writer against a bootstrapped workbook without reviewed rollback.
6. Confirm actual workbook receipts for both intake paths and meaningful delivery
   updates before declaring the replacement live. Keep the user-requested hourly
   pause in place; retain an explicit source-recovery procedure and do not restart
   the old scheduler automatically.

Excel does not provide a cross-cell transaction or an exclusive coauthor lock.
Serialization and post-read checks reduce risk, but do not make simultaneous
manual editing supported. Team members should save and close the workbook after
editing. A conflicting, partially applied or changed row stops acknowledgement
and requires reconciliation. Preserve the frozen batch and recoverable backup;
never force a whole-file overwrite to clear a conflict.

## Candidate verification

The prior combined backend and native-model suite passed **212/212 tests**;
the Microsoft path also passes five actual Firestore SDK tests. Coverage includes replay after an unknown
write outcome, competing workers, concurrent source changes, exact receipt
counts, sharded historical snapshots larger than a single Firestore document,
sorted human-field preservation, recurrence evidence, reviewed identity and
diagnosis preservation, partial recipient delivery and the real normalizer to
writer contract. Isolated packaging and paste-ready script generation passed.
After the OAuth-audience and canonical polling-route corrections, all 57 affected
tests passed on Node 22. The private acceptance helper and endpoint-configuration
helper each passed seven offline tests. Two actual Power Automate calls returned
the identical verified revision-six receipt; private evidence remains outside Git.

Offline checks use fake Firestore and native API fixtures. The separate native
synthetic workbook run confirms the limited initialize/upsert/replay behavior
described above, including literal date/numeric-ID preservation. The optimized
writer is saved in Dylan's private Office Scripts folder. Actual private transport
and exact replay now pass. Neither offline checks nor that private workbook
establish live mailbox coverage or shared-master publication. The shared workbook and committed
source checkpoints were unchanged by this migration setup.

The exact deployed Firestore ruleset
`a3587b76-a66f-40f0-9979-ffd029d583ee` was retrieved read-only. Its bytes passed
432 targeted local-emulator client-denial checks over all nine new private roots,
including nested paths, for unauthenticated, player and verified PoseTek admin
identities; two positive controls passed. This confirms rules behavior at that
captured version, not runtime IAM or any later rules release. No rules changed.

## References checked October 1, 2026

- [Microsoft pricing](https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing)
- [Licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs)
- [Service principal licensing](https://learn.microsoft.com/en-us/power-automate/service-principal-support)
- [HTTP trigger authentication](https://learn.microsoft.com/en-us/power-automate/oauth-authentication)
- [Excel connector limits](https://learn.microsoft.com/en-us/connectors/excelonlinebusiness/)
- [Office Script limits](https://learn.microsoft.com/en-us/office/dev/scripts/testing/platform-limits)
- [Asynchronous flow responses](https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/asychronous-flow-pattern)
- [Email trigger troubleshooting](https://learn.microsoft.com/en-us/power-automate/email-troubleshooting)
