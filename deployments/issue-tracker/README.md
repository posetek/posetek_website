# Isolated tracker bridge candidate

Read [the event-flow handoff](../../docs/ISSUE_TRACKER_EVENT_FLOW.md) before setup.
This package is not deployed or wired into `functions/index.js`. It adds four
candidate entrypoints and no changes to the existing email delivery functions:

| Entrypoint | Purpose | Required access |
| --- | --- | --- |
| `observeUserIssueTracker` | Observe material changes to `userIssueOutbox/{id}` and queue reporting work | Firestore event retry; private source/state access |
| `drainUserIssueTracker` | Send one frozen batch to Power Automate and verify its receipt | Private Cloud Tasks invocation and task enqueue permissions |
| `ingestUserIssueTrackerMail` | Accept bounded mailbox evidence into the reporting queue | Dedicated server-verified ingress secret |
| `recoverUserIssueTracker` | Every 15 minutes, resume bounded outbox enumeration and wake stranded queued work | Scheduled Pub/Sub trigger, private source/state access and task enqueue permissions |

`prepare.cjs` only packages source into a new ignored directory; it does not read
credentials, install dependencies, enable APIs, deploy or modify remote resources.

```powershell
node deployments/issue-tracker/prepare.cjs .netlify/issue-tracker-candidate-UNIQUE
node scripts/issue-tracker/build-office-scripts.cjs .netlify/issue-tracker-scripts-UNIQUE
node --test functions/issue-tracker-bridge.test.js functions/issue-tracker-recovery.test.js functions/issue-tracker-transport.test.js functions/issue-tracker-normalize.test.js scripts/issue-tracker/office-script.test.cjs
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
Verify the deployed
rules deny client access before activation; do not infer that from local rules.

The worker binds `ISSUE_TRACKER_FLOW_ENDPOINT`, `ISSUE_TRACKER_FLOW_TENANT_ID`,
`ISSUE_TRACKER_FLOW_CLIENT_ID` and `ISSUE_TRACKER_FLOW_CLIENT_SECRET` from Secret
Manager. The intake binds `ISSUE_TRACKER_MAIL_INGRESS_SECRET`. The dedicated caller
needs permission to invoke only the authenticated Power Automate flow, not broad
Graph mailbox/file permissions. Review actual task invoker/enqueuer IAM and retry
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
No source complete-through checkpoint or workbook publication state advances,
and this sweep provides no mailbox coverage. Existing source-recovery gates
remain required. The 13 offline recovery tests cover these distinctions; live
Scheduler, IAM and task delivery acceptance remain unverified.

Unknown delivery outcomes retry the identical frozen batch. A rejected or
conflicting receipt stops the writer. Retries are bounded; persisted pending work
does not itself prove future execution. The bounded queue-recovery candidate
still needs live acceptance; tested mailbox/source recovery, operational review
of persistent failure state, seed migration and live Excel acceptance remain
activation gates. See the handoff for source coverage and licensing limits.
