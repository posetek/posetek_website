# Isolated tracker bridge candidate

Read [the event-flow handoff](../../docs/ISSUE_TRACKER_EVENT_FLOW.md) before setup.
This package is not deployed or wired into `functions/index.js`. It adds three
candidate entrypoints and no changes to the existing email delivery functions:

| Entrypoint | Purpose | Required access |
| --- | --- | --- |
| `observeUserIssueTracker` | Observe material changes to `userIssueOutbox/{id}` and queue reporting work | Firestore event retry; private source/state access |
| `drainUserIssueTracker` | Send one frozen batch to Power Automate and verify its receipt | Private Cloud Tasks invocation and task enqueue permissions |
| `ingestUserIssueTrackerMail` | Accept bounded mailbox evidence into the reporting queue | Dedicated server-verified ingress secret |

`prepare.cjs` only packages source into a new ignored directory; it does not read
credentials, install dependencies, enable APIs, deploy or modify remote resources.

```powershell
node deployments/issue-tracker/prepare.cjs .netlify/issue-tracker-candidate-UNIQUE
node scripts/issue-tracker/build-office-scripts.cjs .netlify/issue-tracker-scripts-UNIQUE
node --test functions/issue-tracker-bridge.test.js functions/issue-tracker-normalize.test.js scripts/issue-tracker/office-script.test.cjs
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

Unknown delivery outcomes retry the identical frozen batch. A rejected or
conflicting receipt stops the writer. Retries are bounded; persisted pending work
does not itself prove future execution. A tested source-recovery/queue-recovery
process, dead-letter visibility, seed migration and live Excel acceptance remain
activation gates. See the handoff for source coverage and licensing limits.
