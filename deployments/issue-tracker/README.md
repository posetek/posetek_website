# Isolated tracker bridge candidate

Read [the event-flow handoff](../../docs/ISSUE_TRACKER_EVENT_FLOW.md) before setup.
This package is not deployed or wired into `functions/index.js`. It adds six
candidate entrypoints and no changes to the existing email delivery functions:

| Entrypoint | Purpose | Required access |
| --- | --- | --- |
| `observeUserIssueTracker` | Observe material changes to `userIssueOutbox/{id}` and queue reporting work | Firestore event retry; private source/state access |
| `observeUserIssueTrackerOccurrence` | Independently capture `userIssueOccurrences/{id}`, including records with no email outbox | Firestore event retry; private source/state access |
| `drainUserIssueTracker` | Send one frozen batch to Power Automate and verify its receipt | Private Cloud Tasks invocation and task enqueue permissions |
| `ingestUserIssueTrackerMail` | Resolve an arrival ID to authoritative Graph evidence and immutable identity | Ingress secret plus verified, mailbox-scoped Graph reader |
| `recoverUserIssueTracker` | Every 15 minutes, resume bounded outbox enumeration and wake stranded queued work | Scheduled Pub/Sub trigger, private source/state access and task enqueue permissions |
| `captureUserIssueTrackerSources` | Every five minutes, resume bounded whole-mailbox and independent backend receipt-time recovery | Mailbox-scoped Graph reader, private source/state access and task enqueue permissions |

`prepare.cjs` only packages source into a new ignored directory; it does not read
credentials, install dependencies, enable APIs, deploy or modify remote resources.

```powershell
node deployments/issue-tracker/prepare.cjs .netlify/issue-tracker-candidate-UNIQUE
node scripts/issue-tracker/build-office-scripts.cjs .netlify/issue-tracker-scripts-UNIQUE
node --test functions/issue-tracker-bridge.test.js functions/issue-tracker-recovery.test.js functions/issue-tracker-source-capture.test.js functions/issue-tracker-transport.test.js functions/issue-tracker-normalize.test.js scripts/issue-tracker/office-script.test.cjs
python -m unittest discover -s deployments/issue-tracker -p '*_test.py'
```

Use the configured Node runtime if `node` is not on PATH. Inspect the generated
manifest and exact endpoint list before any later deployment. An approved
deployment must be scoped to these endpoints; never deploy the entire root
functions project or unrelated Firestore rules as part of this setup.

The configuration lives in the private `issueTrackerSettings/current` record.
It requires `enabled`, `seedVerified`, `connectionVerified`, `workbookKey` and the
exact authorized `mailbox`. Keep all three gates false until verified. The
private `issueTrackerState/writer` record holds the revision/lease/frozen batch,
and `issueTrackerState/seed` holds compact preserved IDs and machine hashes.
`issueTrackerRows` holds the full per-row machine snapshots, outside the seed
document, so reviewed descriptions survive later delivery-only updates.
Queue/batch collections are `issueTrackerQueue` and `issueTrackerBatches`.
Source windows and original body/backend snapshots live in private
`issueTrackerCaptureWindows` and `issueTrackerEvidence` (including subcollections).
Verify the deployed
rules deny client access before activation; do not infer that from local rules.

The worker binds `ISSUE_TRACKER_FLOW_ENDPOINT`, `ISSUE_TRACKER_FLOW_TENANT_ID`,
`ISSUE_TRACKER_FLOW_CLIENT_ID` and `ISSUE_TRACKER_FLOW_CLIENT_SECRET` from Secret
Manager. The intake binds `ISSUE_TRACKER_MAIL_INGRESS_SECRET` and the Graph
credentials below. The flow-caller credential needs only the authenticated
Power Automate flow. Graph reader authorization is separately scoped to Dylan's
mailbox; it does not grant workbook writes. Review actual task invoker/enqueuer IAM and retry
configuration in the deployed definitions. Never make the drain endpoint public.

The serialized Power Automate request trigger requires the Response action's
asynchronous setting. A `202` response is pending, never a workbook receipt.
The transport polls a returned Location at most 24 times within the same
125-second transport deadline, honoring Retry-After with a five-second minimum.
Each URL must remain on the original HTTPS origin and in that exact workflow's
`/runs/` subtree. Redirects and unexpected URL shapes fail closed. Returned
signed polling URLs are held only in memory and receive no additional OAuth
header; neither URLs nor response bodies enter error logs. Only a final HTTP 200
containing the exact verified native receipt acknowledges the frozen batch.

Polling locations are not persisted across worker invocations. A bounded timeout
retains the frozen payload; a later retry can submit another run of that same
payload. Therefore verified trigger concurrency **one**, Run script retries
**None**, and native exact-batch replay are mandatory acceptance gates. The
240-second backend lease alone cannot prevent remote overlap after a caller
timeout. Do not disable flow concurrency to obtain a synchronous response.
The 9 async transport tests cover URL boundaries, missing/invalid receipts,
pending deadlines and identical retry. The actual tenant's Location URL shape,
authentication and final receipt still require a live test before activation.

The installed Admin SDK enqueues tasks with an OIDC token for the runtime service
account. Before activation, record that actual service-account identity, its
task-enqueue authorization for the `drainUserIssueTracker` queue, its permission
to use the task OIDC identity, and its invoker authorization on the drain function.
`invoker: "private"` is not evidence those runtime grants exist. The generated
recovery endpoint is scheduled Pub/Sub, not an additional public HTTP endpoint;
verify the deployed Scheduler/topic binding and publisher permissions. It binds
no Microsoft or mail-ingress secrets and invokes only the existing private task.
No identity or IAM policy is created by the candidate packager or tests.

Recovery stays inert until `enabled`, `seedVerified`, `connectionVerified` and
`workbookKey` all pass. Its independent lease and cursor live at
`issueTrackerState/outboxRecovery`. A run scans no more than two 100-document
pages ordered by document ID. It retains the original scan creation-time upper
bound, advances each cursor only after all eligible records on that page are
durably considered, and refreshes historical delivery states through the same
material-hash observer. This deliberately does not query only job creation time:
existing delivery callbacks do not maintain a universal `updatedAtMillis` field.
A crash repeats the unfinished page; a scheduling failure retains pending work.
Each run wakes the private writer at most once. Writer conflicts/auth blocks,
frozen payloads, leases and transport budgets are never cleared or bypassed.

Inspect `activeScan`, `lastCompletedScan`, `lastCheckedAtMillis`,
`lastFailedAtMillis`, `lastErrorCode`, `pendingWorkObserved` and
`writerBlockedReason` for recovery evidence. A completed scan means the last
document-ID page was reached; concurrent source changes make it **not** a
point-in-time snapshot. An insertion behind the cursor can be found next pass.
Each observed full job snapshot is retained privately before the cursor advances;
`deliveryStatuses` counts the statuses observed during that enumeration. No
source complete-through checkpoint or workbook publication state advances,
and this sweep provides no mailbox coverage. Receipt-time source capture below
is separate. The offline recovery tests cover these distinctions; live
Scheduler, IAM and task delivery acceptance remain unverified.

Unknown delivery outcomes retry the identical frozen batch. A rejected or
conflicting receipt stops the writer. Retries are bounded; persisted pending work
does not itself prove future execution. The bounded queue-recovery candidate
still needs live acceptance; mailbox authorization, operational review of
persistent failure state, seed migration and live Excel acceptance remain
activation gates. See the handoff for source coverage and licensing limits.

## Receipt-time source recovery and arrival intake

`ISSUE_TRACKER_GRAPH_TENANT_ID`, `ISSUE_TRACKER_GRAPH_CLIENT_ID` and
`ISSUE_TRACKER_GRAPH_CLIENT_SECRET` use client credentials with Graph `.default`.
Verify Exchange application RBAC restricts Mail.Read to `dylank@posetek.net`;
the code never requests another mailbox and does not grant tenant-wide Mail.Read.
Both Graph endpoints bind these secrets. The scheduled capture's backend side
still runs when Outlook reads fail; their leases, failures and checkpoints are
independent. Permission errors and unfinished pagination fail closed.

Before activation, import verified native seed and identity aliases, then set
`sourceRecoveryEnabled`, `graphMailboxVerified`, `mailAliasesVerified`,
`sourceCaptureStart` and `sourceCheckpoints: {outlook, backend}`. The two initial
checkpoints must come from confirmed publication, not a local save. The last
published local ledger during implementation was `2026-10-02T00:23:48.011Z`;
re-read the current committed ledger before seeding. For each original Outlook
row, `createMailCapture().verifiedAliases(originalIds)` reads that original ID
with `Prefer: IdType="ImmutableId"` and returns a map to preserve its original
row key. Merge this map into the reviewed seed before enabling intake. A missing
old item or conflicting alias stops migration; matching a subject, time or
Internet-Message-ID is not a substitute. No User.Read.All translation permission
is needed.

`issueTrackerState/capture-outlook` and `capture-backend` maintain separate
`capturedThrough`, `publishedThrough`, `lastCheckedAtMillis`, `lastFailedAtMillis`
and `lastErrorCode`. Capture resumes no more than two pages per scheduled run,
using the same fixed UTC upper bound, a two-minute settle delay, 30-minute
overlap and at most one day per catch-up window. All normal mailbox folders are
enumerated through `/users/dylank@posetek.net/messages`, including read messages;
neither subject nor read-state filters are used. Exact nextLinks are retained,
with immutable-ID preference on every request. Known project notices and Google
Cloud notices whose project needs verification are both considered. Unrelated
mail is counted with an exclusion reason. Relevant original bodies/selected
headers and each backend snapshot are archived privately; original Outlook items
remain untouched. Attachments remain at the original Outlook source.

Backend receipt windows enumerate occurrences by `receivedAtMillis`, then
incident/status/daily outbox records by `createdAtMillis`, with document ID as a
tie-breaker. Independent historical outbox recovery above continues to inspect
older delivery changes. Neither cursor proves a point-in-time snapshot of all
delivery states. Missing outbox records remain explicit unknown delivery;
previously recorded delivery cannot disappear on refresh. Actor and athlete are
separate, and generic diagnostics do not establish crashes. Microsoft send
acceptance, Exchange trace observation and Exchange receipt time stay distinct.

Established nonempty source hyperlinks remain stable because native Excel can
share a hyperlink across adjacent cells. Blank links can be enriched. When a
current Outlook or verified correlation URL differs, the row explicitly notes
that the established link is preserved, may be stale, and needs reviewed
migration; new raw evidence retains the current URL privately. Verified instance
and action correlations still update. No automatic hyperlink clearing occurs.
Machine numbers are canonicalized to Excel's 15 significant digits before
freezing hashes; untouched historical seed snapshots keep their exact hashes.

Capture completeness advances only after the page's originals and queue tickets
are durable. Publication completeness advances in order only when every relevant
ticket version has a verified native workbook receipt; a newer pending version
does not erase an earlier confirmed version. Arrival notifications advance no
coverage checkpoint. The source-window ledger and queue provide the audit trail.

Build the separate Outlook flow ZIP with:

```powershell
python deployments/issue-tracker/build_mail_flow.py --output .netlify/mail-intake-UNIQUE.zip --private-config .netlify/mail-intake.config.private.json
```

The private config has `outlookConnectionName` and `ingressSecret` (the same value
as `ISSUE_TRACKER_MAIL_INGRESS_SECRET`). Without a secret the ZIP is explicitly an
unconfigured template. The existing Dylan Outlook connection must be selected on
import. The V3 Inbox arrival trigger sends only its item ID, fixed mailbox and
schema version to `ingestUserIssueTrackerMail`; the backend fetches authoritative
content and immutable identity. Secure inputs/outputs are enabled on both steps;
four bounded exponential HTTP retries are safe through queue identity. It sends
no mail and changes no read state. The connector can miss oversized/protected
messages or moved-folder events, so live acceptance must cover both arrival and
independent recovery. This local builder does not import, enable or purchase
anything. Endpoint receipt validation and real connection behavior still need
live acceptance before replacing the hourly desktop tracker.
