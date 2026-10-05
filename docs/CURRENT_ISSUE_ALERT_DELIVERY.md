# Current issue alert delivery

October 5 decision: prioritize new issue alerts and leave historical queued
notifications untouched. The new issue-only `sendFromMillis` setting applies to
dispatch and the transactional Microsoft send authorization before any job,
policy or send-budget write. It does not change intake, historical claims or
receipt reconciliation, the first-plus-daily policy, or workout notifications.

Only `dispatchUserIssue`, `sweepUserIssues`, `dailyUserIssues` and
`claimMicrosoftEmail` need the source-only release. Preserve their existing
configuration, triggers, secrets and IAM. Activate by setting one fixed current
`sendFromMillis` and `sendEnabled: true` on `userIssueSettings/current`, retaining
all other fields. On an uncertain response, read back that same cutoff; do not
choose a later one. Deployment and activation evidence will be recorded after
actual verification; this source change alone does not establish live delivery.

New authenticated-user incidents already resolve contact through the exact
recorded Auth UID. Emails separately show Account/reporter, Contact email with
verification state and lookup time, Target athlete, Attempted action, occurrence
time and evidence. Unknown actors and unavailable contacts stay explicit.
Diagnostic uploaders are not assumed to be the operator who experienced a crash.

Dylan alone receives issue, status, daily-summary and workout emails. New
problems, new reporting accounts or athletes, severity increases and recurrences
after a recorded fix can trigger immediate issue emails; routine repeats are
documented individually and summarized daily at 9 AM Pacific. The first summary
after activation includes only evidence captured after the new send cutoff and
does not include all-time historical delivery totals.

The cloud tracker remains **PoseTek → Technology → Website → User Issue Tracker
→ PoseTek Issue Tracker.xlsx** in the shared PoseTek OneDrive. Existing cloud
capture and publication continue independently; Nolan and Taiyo retain editing
access. No hourly Codex procedure is needed. This change does not replay the
historical Resend or Microsoft queues, purchase anything, or contact athletes.

Validation: focused sender, frontier, policy, summary, contact and packaging
tests passed, including independent review. Old queued jobs are skipped without
mutation, new retries cannot be blocked by the old due queue, first partial
summaries exclude historical evidence, invalid cutoffs fail closed, and workout
delivery and consumed receipt reconciliation retain their existing behavior.
