# Isolated tracker bridge

Read [the event-flow handoff](../../docs/ISSUE_TRACKER_EVENT_FLOW.md) before setup.
This package is not wired into `functions/index.js`. Its isolated six-function
release is now **ACTIVE at version 6** for all six endpoints, with exact
source/configuration/IAM and unrelated-resource verification complete. The
shared native master is event driven, with automatic cloud catch-up independent
of this chat, Codex and Dylan's computer.
Dylan alone receives alerts, while Nolan and Taiyo retain workbook editing.
The [current verification checkpoint](../../deployment/OUTLOOK_IDENTITY_AUTOMATION_PROGRESS.json)
records the unfinished identity settings cutover and capacity-blocked publication
at native revision 266. A reviewed adaptive batch candidate is prepared; its
deployment and physical cloud publication are not yet confirmed.
Use [the current coverage handoff](../../docs/NOTIFICATION_COVERAGE_CORRECTION.md)
and [correction receipt](../../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
for the latest physical workbook revision, separate capture/publication cutoffs,
queue state and delivery review. Earlier revision-eight and revision-121 results
are dated historical checkpoints, not current completeness claims. This scope
contains six entrypoints and does not redeploy the email sender:

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
$node = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$python = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $node deployments/issue-tracker/prepare.cjs .netlify/issue-tracker-candidate-UNIQUE
& $node scripts/issue-tracker/build-office-scripts.cjs .netlify/issue-tracker-scripts-UNIQUE
& $node --test functions/issue-tracker-bridge.test.js functions/issue-tracker-recovery.test.js functions/issue-tracker-source-capture.test.js functions/issue-tracker-transport.test.js functions/issue-tracker-normalize.test.js functions/issue-tracker-mail-identity.test.js functions/issue-tracker-mail-correlation.test.js functions/issue-tracker-mail-read-proxy.test.js functions/issue-tracker-mail-relevance.test.js functions/issue-tracker-source-observation.test.js scripts/issue-tracker/office-script.test.cjs
& $python -B -m unittest discover -s deployments/issue-tracker -p '*_test.py'
```

The cloud package remains `nodejs22`; the local bundled v24.19.0 runtime also
satisfies the application engine `>=22.19.0`. Inspect the generated
manifest and exact endpoint list before any later deployment. An approved
deployment must be scoped to these endpoints; never deploy the entire root
functions project or unrelated Firestore rules as part of this setup.

The two Firestore observers intentionally enable failure retries. Firebase CLI
14.14 requires an acknowledgement for new retry policies. Use an interactive
terminal and acknowledge only the prompt naming those two observers after
reviewing the exact scope; do not use `--force` to bypass other deployment
checks. The observer reads current source state transactionally, coalesces
unchanged material hashes and retries scheduling with deterministic task IDs.
Queue acknowledgement requires an exact verified writer receipt. The scoped
source, control-plane and IAM/schedule readbacks remain required after deploy.

The current package includes separate mail-identity, identity-proxy and
mail-classification modules; exact contact and issue classification helpers; and
Microsoft effective-envelope validation. Generic diagnostics and automated service
failures remain distinct from proven user attempts. Actor/contact/target evidence,
source observations and historical wording use the existing workbook columns;
duration stays in linked Cloud Logging, with no workbook timing column. Human
Status, Owner, Due and Fix notes remain keyed by stable Action ID after sorting.

## Mailbox identity settings cutover held

The package requires the explicit `mailIdentityEnabled = true` capability;
packaging alone does not activate its settings or authorize deployment. The
installed version-six source includes the identity resolver and its two pinned
secret bindings, but the additive settings transaction is still pending. The
dedicated conversion flow passed read-only semantic acceptance; this does not
establish historical alias publication. The old reader's `Prefer: IdType="ImmutableId"` header and
corrected inputs were saved through code view. Its actual export passed exact
runtime-definition review and the flow is On. Current conversion behavior comes
from the separately tested dedicated Graph connection; retained alias updates
still require the settings cutover and native publication receipts.
Do not claim all reader/translation changes are complete or enable the translation secret
from local builder tests alone. The ordinary approved delegated mailbox route
and independent backend capture remain separate from this unfinished correction.
Retain every original row and unconfirmed alias until exact Exchange identity
evidence proves the mapping; similar subject/body/time is insufficient.

## Historical initial activation

The first release's interactive CLI run reported an invoker error after creating
the private drain and queue: CLI14.14 called `bindings.filter` on an empty queue
policy whose response omitted `bindings`. Actual readback then verified all six
ACTIVE version-one functions and identical source ZIPs, the intended empty
private policies, task settings and inherited runtime permissions. All prior
114 function policies, five schedules and nine secret policies were preserved.
The CLI failure remains recorded; no redeploy or IAM repair was needed. A live
runtime evidence and independent shared-master readback subsequently passed.

The shared master was initialized and made ready at revision zero, with an exact
750-row disabled seed and preserved 882 source links and 23 human-field records.
The saved writer retarget, current cloud script bytes and On state are verified.
Backend settings are enabled. Independent fresh cloud revision-eight readback
verified 70 actions, 684 instances, 160 emails and one daily record, preserving
original human records and links. Both temporary queue holds were restored to
RUNNING. Source capture/publication remain separate, with 490 pending tickets at
the audit; full catch-up remains in progress. The setup-classification correction
was acknowledged at revision seven and is included in the verified workbook.
Read [the production receipt](../../deployment/ISSUE_TRACKER_EVENT_PRODUCTION.json). Do not rebuild or replace the master with the old whole-file renderer
or run bootstrap again. Use native revisions and exact receipt-based recovery.

## Private state and safe operation

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
Contact and late-email repair use separate bounded cursors in `issueTrackerState`;
they never advance source completeness just because a lookup or join succeeded.
The identity modules retain verified alias proof and original row keys in native
state/evidence; they do not delete historical aliases to make counts agree.
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
The async transport tests cover URL boundaries, missing/invalid receipts,
pending deadlines and identical retry. Actual tenant authentication, polling and
two exact terminal receipts now pass against the private synthetic workbook.
Microsoft's Location omitted the invoke URL's numeric `/cu/30/` routing segment;
the comparison normalizes only that segment while retaining the exact origin
and workflow. The final native readback confirmed ready revision six, no pending
batch, preserved team fields and all 858 evidence links. This establishes the
private writer path; production intake and shared-master cutover remain separate
requirements. See [native acceptance](../../scripts/issue-tracker/NATIVE_ACCEPTANCE.md).

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
is separate. The offline recovery tests cover these distinctions; actual
Scheduler, IAM, task delivery and workbook acceptance require their own dated
proof. The current receipt records the latest verified operational state.

Unknown delivery outcomes retry the identical frozen batch. A rejected or
conflicting receipt stops the writer. Retries are bounded; persisted pending work
does not itself prove future execution. Reverify mailbox authorization,
persistent failure state and fresh cloud Excel publication before another
activation or recovery change. The master is already initialized: do not reseed
it or repeat bootstrap. See the handoff for source coverage and licensing limits.

## Receipt-time source recovery and arrival intake

`ISSUE_TRACKER_GRAPH_TENANT_ID`, `ISSUE_TRACKER_GRAPH_CLIENT_ID` and
`ISSUE_TRACKER_GRAPH_CLIENT_SECRET` use client credentials with Graph `.default`.
The explicit `mailReadProvider: "graph"` route requires verification that Exchange
application RBAC restricts Mail.Read to `dylank@posetek.net`; the code never requests
another mailbox and does not grant tenant-wide Mail.Read. The alternative
`mailReadProvider: "power_automate"` route uses Dylan's existing delegated Outlook
connection through a fixed GET proxy and requires separate endpoint/export/caller/
connection proof. It keeps `graphMailboxVerified` false and never falls back to
application Graph. See [MAIL_READ_PROXY.md](MAIL_READ_PROXY.md) for its package,
acceptance gates and exact settings. Both arrival and source-capture endpoints
bind their read credentials. The scheduled capture's backend side
still runs when Outlook reads fail; their leases, failures and checkpoints are
independent. Permission errors and unfinished pagination fail closed.

Before activation, import verified native seed and identity aliases, then set
`sourceRecoveryEnabled`, the explicitly selected/verified mail provider, `mailAliasesVerified`,
`sourceCaptureStart` and `sourceCheckpoints: {outlook, backend}`. The two initial
checkpoints must come from confirmed publication, not a local save. The historical
pre-migration publication covered both sources through `2026-10-02T04:56:51.854Z`, with
598 instances, 128 emails and 23 actions, workbook SHA-256
`c9bf937b4cd1507d9f376bc861d0cb3779443b6a522e190ac48fb79c68f69d19`.
The cloud writer is enabled; the original revision-eight publication remains
historical evidence. Ongoing capture and publication run entirely in the cloud.
Those original
cutoffs remain the initialization basis; ongoing catch-up resumes from each
source's verified publication checkpoint in the production receipt. Never run
the old renderer against the initialized native master. For each original Outlook
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
anything. Endpoint receipt validation and real connection behavior require
fresh acceptance for a later flow change. Event intake and automatic cloud
catch-up provide ongoing operation without a Codex chat or desktop process.
