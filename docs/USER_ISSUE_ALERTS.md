# User issue alerts

The approved issue-alert recipients are `dylank@posetek.net`, `nolanj@posetek.net`
and `taiyow@posetek.net`, independent of the email used to sign in to Resend or
GitHub. The October 1 recipient expansion covers new incident, status-change and
daily-summary emails. This is a separate workflow from workout notifications,
whose recipient remains `dylank@posetek.net`.
The sender is `PoseTek Support <support@alerts.posetek.net>`, using the existing
verified domain, restricted Secret Manager key and signed delivery webhook.

## Shared issue tracker

The team's master workbook is in the shared PoseTek OneDrive at
**PoseTek > Technology > Website > User Issue Tracker > PoseTek Issue Tracker.xlsx**.
Dylan is the owner; Nolan Jetter (`nolanj@posetek.net`) and Taiyo Williamson
(`taiyow@posetek.net`) have verified editing access. Use that shared workbook for
triage rather than a downloaded attachment or an earlier local export.

The hourly updater collects Outlook alerts, including Google Cloud Monitoring
notifications, and reconciles backend incident evidence. It records the known
actor and attempted operation, marks unknown identities honestly, links repeated
notifications to their underlying incident and retains proposed fixes. Team edits
to Status, Owner, Due and Fix notes must be preserved on refresh. A repeated alert
is evidence of recurrence, not automatically another distinct affected user.

This is a local scheduled update: Dylan's computer, Codex and OneDrive must remain
running, with the connected accounts available. Save and close desktop Excel after
editing and let OneDrive finish syncing. Avoid editing during the refresh window;
a locked or conflicting workbook must be deferred rather than overwriting team
changes. Email delivery runs separately in Google Cloud and is subject to the
provider's delivery capacity even if the computer is off.

## Coverage and limits

The React application captures uncaught errors, rejected promises, render failures,
unexpected callable and sign-in failures, failed training-job submission, workout
save errors with a service code, and catalog upload failures. Expected validation,
incorrect-password and cancellation outcomes are excluded. Existing `aiIncidents`,
`fieldReports` and `failureCases` are observed on creation. Cloud Run and Cloud
Functions ERROR-level logs enter through the dedicated Logging sink and Pub/Sub
topic; the alert pipeline excludes its own errors and canonical AI log copies.
An unhandled error before the reporting code loads, a blocked network request or
an uninstrumented handled failure can still escape detection. Historical static
marketing/legacy entry points are not instrumented by this application release.

Crashlytics is the native crash recorder. Its per-event Cloud Logging adapter is
implemented and was tested with a synthetic payload, not a real device crash.
**Firebase's Crashlytics → Cloud Logging integration and a genuine device export
remain unverified.** No events appeared in the bounded read-only export check;
the Firebase console browser connection was unavailable. Enable the iOS app under
[Firebase integrations](https://console.firebase.google.com/project/kickai-69dd0/settings/integrations),
then verify an intentional test-device crash after relaunch. Google's
[export setup](https://firebase.google.com/docs/crashlytics/cloud-logging-export)
describes the console step and possible export delays. Lack of events alone does
not prove that a link is disabled. Unknown interrupted sessions are labeled with
an unknown cause, never asserted to be crashes or memory exhaustion.

Native candidate `0f0d876` is on
[`worktree-user-issue-alerts`](https://github.com/posetek/posetek-mobile-app/tree/worktree-user-issue-alerts).
It adds the original Auth UID to Crashlytics context and a durable, account-bound
manual-report queue with optional screenshots. It has **not** been compiled or
released: Windows cannot run Xcode, device or TestFlight acceptance. Follow its
[`USER_ISSUE_ALERTS_PLAN.md`](https://github.com/posetek/posetek-mobile-app/blob/worktree-user-issue-alerts/docs/plans/USER_ISSUE_ALERTS_PLAN.md)
before merging or shipping. Existing native diagnostics have their own release
gates; this work does not clear them.

## User and admin flows

`/support#report-problem` accepts a description and optional PNG/JPEG screenshot.
The browser resizes the image to at most 175 KB before submission. IndexedDB keeps
pending reports across reloads; the original account must be signed in to send
them. The callable also checks the original `ownerUid`, so a token change cannot
reattribute a queued report. Reports show queued, received or unavailable accurately.
Payloads are cleared from acknowledged local entries. Pending entries are bounded
to 50; old acknowledgements are pruned. Clearing browser storage removes local
pending reports. Automatic reporting is best effort and never blocks the operation.

Verified PoseTek administrators use `/admin/user-issues`. They can filter loaded
issues, look up an exact account UID, open the latest 50 occurrences, view private
screenshots and delivery status, and change New / Investigating / Fixed / Verified /
Dismissed. Fixed requires a fix reference; Verified also requires retest evidence.
Concurrent changes reject a stale update. A later occurrence reopens Fixed or
Verified. A recurrence after Dismissed retains its dismissed state but is emailed.

Emails contain the recorded user identity, operation, platform/build/device and
occurrence/receipt times, with a protected admin link. Descriptions, diagnostic
messages and screenshots stay in the private record; common credentials and email
addresses in free text are redacted. Screenshot contents cannot be automatically
guaranteed free of private information; upload is deliberate. Authentication comes
from verified tokens; athlete attribution requires consistent ownership or existing
staff/admin access. Anonymous reports are labeled anonymous, not guessed identities.

## Delivery contract

An occurrence key binds the original actor and event/request ID. Retries and
correlated client/server copies do not create another email; distinct attempts or
different affected users do. Manual reports have individual issue records. Automatic
issues group by platform, operation, code and kind. Sources without a common
request ID cannot always be correlated. Repeated reports of the same Error object
are suppressed in the browser; separate Error objects remain separate attempts.

The server-owned outbox freezes each payload and Resend idempotency key before
sending. Leases last two minutes; a five-minute sweep retries transient/uncertain
attempts within 23 hours. Expired ambiguity requires review instead of risking a
second delivery beyond the provider's idempotency window. Signed callbacks can
arrive before API acknowledgement and settle the job. Delivered means accepted
by the recipient mail server, not a verified Inbox placement or read receipt.
Resend emits a separate callback for each recipient. The issue outbox stores
`recipientDelivery` with each recipient's status and provider event time; the
aggregate becomes Delivered only when all frozen recipients have delivered.
An individual failure remains visible even if the other recipients deliver.
Earlier Dylan-only jobs retain their original payload, destination and idempotency
key, including pending retries. This change does not backfill old emails or reset
uncertain attempts. Recipient verification uses the original frozen payload,
so callbacks for a newly added recipient cannot settle an old Dylan-only job.

At **9 AM America/Los_Angeles**, a nonempty preceding 9-to-9 reporting period produces
one summary with incident/crash/report counts, affected accounts or anonymous
sessions, recurrences, status changes, top issues, unresolved/unverified issues and
email jobs needing attention. Daylight-saving transitions are tested. The independent
Cloud Monitoring policy emails all three recipients on alert-service errors; it
does not use Resend. Its configuration is verified. Historical Dylan Inbox
messages are included in the tracker; adding recipients alone does not verify
Nolan's or Taiyo's Inbox delivery.

Intake limits are 120 reports per authenticated account per hour, 15 per anonymous
source IP, and 3,000 client reports globally per hour. Replays do not consume quota.
Limit records hold hashed identities, not raw IP addresses. No automated server
retention purge is deployed by this release; issue/evidence records require
deliberate administrator retention management. This also preserves deduplication
evidence until a retention workflow is reviewed.

## Storage and control

All new roots are denied to direct clients, including admins. Access is through
the verified admin callable. Canonical rules remain owned by the mobile repository.

| Root | Purpose |
|---|---|
| `userIssueSettings/current` | Collection/delivery gates and activation cutoff |
| `userIssues` | Grouped status, evidence and latest occurrence |
| `userIssueOccurrences` | Private original event and optional screenshot |
| `userIssueActors` | Exact account-to-issue lookup |
| `userIssueDays` | Daily counts plus actor/issue aggregation subcollections |
| `userIssueOutbox` | Immutable email job and signed `receipts` |
| `userIssueLimits` | Bounded intake counters |

Missing/invalid settings fail closed. Activation requires `enabled: true`,
`sendEnabled: true`, and a positive, nonfuture `activatedAtMillis`. A pilot uses a
nonempty `testUids` array; empty/malformed arrays disable intake. Server receipts
before activation are excluded, including delayed trigger redeliveries. Delayed
new receipts preserve the original occurrence time. There is no historical scan.
Disable intake and sending to stop the feature, or only sending to retain intake.
Never replay delivered jobs or blindly reset uncertain provider attempts.

See [the scoped release guide](../deployments/user-issues/README.md). The [production receipt](../deployment/USER_ISSUE_ALERTS_PRODUCTION.json) records
the verified website deployment, activation, delivery acceptance and remaining native gates.
