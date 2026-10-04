# User issue alerts

The approved recipient of new incident, status-change, daily-summary and workout
emails is `dylank@posetek.net`. Nolan and Taiyo retain shared Excel editing access.
Microsoft 365 sends application alerts from `alerts@posetek.net` through the
existing Power Automate connection. Both PoseTek Cloud Monitoring policies also
target Dylan only. The prior three-recipient expansion and Resend deliveries are
historical evidence; their original envelopes and partial outcomes stay intact.
See [the current coverage correction](NOTIFICATION_COVERAGE_CORRECTION.md) and
[its receipt](../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json).
The [October 2 refinement receipt](../deployment/NOTIFICATION_REFINEMENT_PRODUCTION.json)
and [outreach handoff](NOTIFICATION_OUTREACH_REFINEMENT.md) retain their dated
contact, delivery and recovery evidence.

## Shared issue tracker

The team's master workbook is in the shared PoseTek OneDrive at
**PoseTek > Technology > Website > User Issue Tracker > PoseTek Issue Tracker.xlsx**.
Dylan is the owner; Nolan Jetter (`nolanj@posetek.net`) and Taiyo Williamson
(`taiyow@posetek.net`) have verified editing access. Use that shared workbook for
triage rather than a downloaded attachment or an earlier local export.

The cloud event flow collects Outlook alerts, including Google Cloud Monitoring
notifications, and independently reconciles backend incident evidence. It records the known
actor and attempted operation, marks unknown identities honestly, links repeated
notifications to their underlying incident and retains proposed fixes. Team edits
to Status, Owner, Due and Fix notes must be preserved on refresh. A repeated alert
is evidence of recurrence, not automatically another distinct affected user.

Power Automate event intake and automatic cloud recovery operate independently
of this chat and Codex. Cloud connections and Dylan's licensed Power Automate
account must remain available; his computer can be off.
The native writer preserves human fields by stable Action ID and rejects changed
machine rows or revisions. Save edits and allow them to reach the cloud. A lock or
conflict defers publication. Capture and publication have separate checkpoints;
a successful flow badge does not establish complete source coverage.

## Coverage and limits

The React application captures uncaught errors, rejected promises, render failures,
unexpected callable and sign-in failures, failed training-job submission, workout
save errors with a service code, and catalog upload failures. The fourteen
instrumented social callables retain unsuccessful user attempts, including
blocking validation, permission, internal, deadline and unavailable failures;
expected validation is labelled separately. Expected incorrect-password outcomes
and cancellations do not raise incidents. Other handled failures are covered only
where their operation is instrumented. Existing `aiIncidents`,
`fieldReports` and `failureCases` are observed on creation. Cloud Run and Cloud
Functions ERROR-level logs enter through the dedicated Logging sink and Pub/Sub
topic; the alert pipeline excludes its own errors and canonical AI log copies.
An unhandled error before the reporting code loads, a blocked network request or
an uninstrumented handled failure can still escape detection. Historical static
marketing/legacy entry points are not instrumented by this application release.

The validated null-caller source correction keeps missing or rejected anonymous
credentials as **Action failed** with an unknown actor and unavailable contact.
It requires the original supported generation-1 function identity, failed outcome,
operation, code/category and request reference; client-supplied markers are removed.
Private observations, summaries and workbook annotations preserve that evidence.
Generic service logs remain service evidence, and no historical actor or failed
request is inferred from a failure code or similar wording alone. Its isolated
release acceptance is recorded separately in the correction receipt.

Crashlytics is the native crash recorder. Its per-event Cloud Logging adapter was
tested with a synthetic payload as an earlier setup check. The October 2–3 console
review confirms Cloud Logging export **On for the registered iOS app**
`1:839600313930:ios:bfa3172fbaa7b521e3f8b3`, bundle `Nolan-Jetter.KickAI`.
**A genuine symbolicated device export remains unverified.** Configuration alone
does not prove delivery. Verify an identified test-device crash after relaunch
through the exact export, backend occurrence, Dylan-only delivery and published
workbook evidence. Google's
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

Emails separate Account/reporter, Contact email, Target athlete and Attempted
action. The current name/email comes from a server-side lookup of the exact stored
Auth UID, with email verification state and lookup time. A failed lookup retains
the incident and retries; earlier contact evidence is labeled last-known and is
not represented as a current contact. Target athletes never supply the actor's
name. Service errors and diagnostic uploads leave an unknown original operator
explicit. Dylan handles outreach manually. Emails also retain platform/build/device and
occurrence/receipt times, with a protected admin link. Descriptions, diagnostic
messages and screenshots stay in the private record; common credentials and email
addresses in free text are redacted. Screenshot contents cannot be automatically
guaranteed free of private information; upload is deliberate. Authentication comes
from verified tokens; athlete attribution requires consistent ownership or existing
staff/admin access. Anonymous reports are labeled anonymous, not guessed identities.

## Delivery contract

Legacy primary occurrence keys bind the original actor and event/request ID.
Server-owned source claims and bounded branch registries preserve replay identity.
Client/server observations share an occurrence and send permission only when the
exact actor/reference and known operation/authorized target evidence are
compatible. Reused references with conflicting known endpoints, target athletes
or anonymous sessions remain distinct; missing context cannot choose between
conflicting branches. Each original observation retains its provenance. Manual
reports have individual issue records; automatic issues group by platform,
operation, code and kind. Sources without exact common evidence cannot always be
correlated. The website supplies a fresh diagnostic UUID per supported social
invocation, keeping it stable for SDK retries. Bounded Error-object suppression is
request aware: different scoped attempts retain reused Error objects, while a
global unhandled copy of an already captured wrapper error is suppressed.

The server-owned outbox freezes each envelope before sending. Dispatch and the
transactional Microsoft claim both enforce Dylan-only recipients before consuming
send permission. A consumed claim binds its payload digest and recipient set;
callbacks and Exchange traces retain that exact envelope across later changes.
Historical consumed three-recipient claims keep their original delivery results.
Recent unclaimed Microsoft failures can use an explicitly audited recipient/body
amendment while preserving the original payload, attempts and history. The
operator rechecks job and receipt evidence transactionally while sending is
paused. Historical Resend jobs are neither amended nor replayed by this release.
Send-action acceptance and recipient delivery are separate states. Delivered
requires provider evidence; it does not imply that a message was read. Frozen
multi-recipient historical jobs require all original recipients to settle and
preserve partial failure outcomes.

At **9 AM America/Los_Angeles**, a nonempty preceding 9-to-9 reporting period produces
one source-aware summary distinguishing recorded user attempts, automated service
failures, diagnostics and confirmed crash evidence, plus recurrences, status
changes, top issues, unresolved/unverified issues and email jobs needing attention.
The enumeration must complete the fixed period; partial pagination does not claim
complete coverage. Incident, actor/reference, action and email-row totals are not
counts of unique people. Generic diagnostic uploads and unclean exits do not prove
crashes or interrupted workouts. Daylight-saving transitions are tested. The independent
Cloud Monitoring policies send alert-pipeline failures and AI-incident notices
to Dylan independently of the application email provider. Original Outlook rows,
including repeated notices and unmatched messages, remain in the tracker.

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
| `userIssueOccurrences` | Private original event/contact evidence, optional screenshot and immutable `observations` subcollection |
| `userIssueActors` | Exact account-to-issue lookup |
| `userIssueContacts` | Server-owned bounded exact-UID contact cache; lookup failure and last-known evidence remain explicit |
| `userIssueSourceClaims` | Durable source-observation replay binding to its stable occurrence |
| `userIssueRequestIdentities` | Bounded server-owned request branches; conflicting or ambiguous evidence remains distinct |
| `userIssueDays` | Daily counts plus actor/issue aggregation subcollections |
| `userIssueOutbox` | Frozen email job, provider claim/trace state and retained historical `receipts` |
| `userIssueLimits` | Bounded intake counters |

Missing/invalid settings fail closed. Activation requires `enabled: true`,
`sendEnabled: true`, and a positive, nonfuture `activatedAtMillis`. A pilot uses a
nonempty `testUids` array; empty/malformed arrays disable intake. Server receipts
before activation are excluded, including delayed trigger redeliveries. Delayed
new receipts preserve the original occurrence time. There is no historical scan.
Disable intake and sending to stop the feature, or only sending to retain intake.
Never replay delivered jobs or blindly reset uncertain provider attempts.

See [the scoped release guide](../deployments/user-issues/README.md). The
[original production receipt](../deployment/USER_ISSUE_ALERTS_PRODUCTION.json)
retains initial deployment/activation evidence; the
[coverage correction receipt](../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
records the later scoped releases and remaining gates.
