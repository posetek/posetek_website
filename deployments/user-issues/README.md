# Scoped user-issue release

`prepare.py` prepares and audits ten functions in the independent `user-issues`
codebase. It captures exact source, runtime, triggers, IAM, secrets and rollback
archives and verifies unrelated function inventory. It never deploys rules or a
gateway. Preserve canonical rules and every other codebase.

| Functions | Trigger |
|---|---|
| submitUserIssue, getUserIssues, updateUserIssue | Callable; auth enforced in handler |
| observeIssueAi, observeIssueReport, observeIssueDiagnostic | Create-only source observers |
| observeIssueLog | `posetek-user-issues` Pub/Sub topic |
| dispatchUserIssue | Outbox write; RESEND_API_KEY |
| sweepUserIssues | Every five minutes; RESEND_API_KEY |
| dailyUserIssues | 09:00 America/Los_Angeles; RESEND_API_KEY |

Use fresh ignored paths and the existing authorized short-lived owner-session
format (`access_token`, `expires_at` milliseconds). Keep credentials out of Git.

```powershell
python -B deployments/user-issues/prepare.py --mode prepare --run-dir .netlify/user-issues/RELEASE --credential-file .netlify/user-issues/owner-session.json
npm --prefix .netlify/user-issues/RELEASE/source ci --ignore-scripts --no-audit --no-fund
firebase deploy --project kickai-69dd0 --config .netlify/user-issues/RELEASE/firebase.json --only functions:user-issues --non-interactive --force
python -B deployments/user-issues/prepare.py --mode verify --run-dir .netlify/user-issues/RELEASE --credential-file .netlify/user-issues/owner-session.json
```

The existing `resendWorkoutNotificationWebhook` forwards verified issue-tagged
callbacks to the new receipt handler. Its independent
`deployments/workout-notifications/prepare.py --scope webhook` bundle includes the
shared issue module/model. Audit the issue scope before publishing the webhook
scope so each unrelated-inventory comparison has a stable predecessor. The latest
webhook only uses the issue delivery handler; later intake-only changes do not
change its delivery contract.

The Logging sink named `posetek-user-issues` routes Crashlytics event logs and
Cloud Run/Functions ERROR logs to the same-named topic. Its dedicated Logging
writer has publisher access on that topic. The source adapter rechecks project,
resource, severity and exclusions. Exclude alert/workout-mail services to avoid
recursive reporting; canonical `ai_incident` logs are covered by their document
observer. Existing sinks and Taiyo's notification channel remain intact.

Cloud Monitoring policy `6520825830736261069` uses email channels
`17819036609163820276` for `dylank@posetek.net`, `1643439989627158215` for
`nolanj@posetek.net`, and the existing `13952378452960206658` channel for
`taiyow@posetek.net`, independently of Resend. Verify
policy/channel enabled state after changes. Read back both Cloud Scheduler jobs.
Create only the two additive `userIssueOccurrences`/`userIssueActors` indexes
declared in root `firestore.indexes.json`; do not deploy or delete unrelated indexes.

For the October 1 recipient expansion, deploy the backward-compatible webhook
scope first and verify it before preparing/deploying the user-issues scope. New
issue/status/daily payloads include all three recipients; the shared provider's
workout default remains Dylan-only. Frozen earlier payloads and keys are never
rewritten. Per-recipient callbacks must settle independently, including callbacks
received before the send response and out of timestamp order between recipients.
This backend-only adjustment does not require a website, rules, gateway or native
release. Read `deployment/USER_ISSUE_RECIPIENTS_PRODUCTION.json` for rollout evidence
and actual delivery limits; configured destinations are not proof of Inbox arrival.

## Acceptance and promotion

1. Run `node --test functions/user-issues.test.js functions/workout-notifications.test.js`.
2. Run `npm --prefix app test` and TypeScript. Test `userIssues` through
   `scripts/run-rules-tests.mjs`, pointing at the canonical native `firebase/` rules.
   This includes the real Firestore SDK transaction/query/outbox checks.
3. Run `app/scripts/test-user-issues-browser.mjs` against a local Vite preview on
   port 5184. It intercepts report submissions, tests offline→received once at
   360/390/768/1440 widths, and captures protected-admin synthetic layouts.
4. Use isolated temporary accounts and `testUids`; verify genuine signed delivery,
   original actor isolation, direct-client denial, protected evidence, duplicate
   events, recurrence, status changes and the scheduled summary. A synthetic
   Crashlytics payload tests the adapter, not a device/export integration.
5. Build with Node 22.19+ in the Node 22 line and `PUBLIC_RELEASE_SHA` set to the
   committed source. Use `scripts/build-astro-release.mjs`, then retain the exact
   verified predecessor Players and Coaches HTML for this application-only change.
   Existing assets remain content-addressed and checksum protected.
6. Review the draft artifact, publish only to PoseTek site
   `b1ccf990-286c-4367-bb67-ca0d9ea2a020`, verify the exact draft and promote it
   without rebuilding. Reconcile the baseline from verified production inventory.
7. Park the pilot, verify no sends remain in flight, remove only run-owned synthetic
   data/accounts, then activate with a fresh server cutoff and no pilot allowlist.

If rollout fails, disable issue intake/sending and restore the reviewed Netlify
predecessor or the exact scoped backend rollback. Do not restore user data as a
code rollback. Do not change workout-notification settings. Native release remains
separate and requires the documented Mac/iPhone/TestFlight acceptance.
