# Scoped user-issue release

`prepare.py` prepares and audits ten functions in the independent `user-issues`
codebase. It captures exact source, runtime, triggers, IAM, secrets and rollback
archives and verifies unrelated function inventory. It never deploys rules or a
gateway. Preserve canonical rules and every other codebase.

## Current release and delivery

The October 2–3 correction verified all ten user-issue functions **ACTIVE at
version 8**, with exact source, Node 22 runtime, configuration and IAM preserved.
New alerts use Microsoft 365 through Power Automate, from `alerts@posetek.net` to
**Dylan only**. Nolan and Taiyo retain shared Excel editing access. Both independent
PoseTek Cloud Monitoring policies also target Dylan alone. Use
[the current handoff](../../docs/NOTIFICATION_COVERAGE_CORRECTION.md) and
[correction receipt](../../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
for current release and fixed-cutoff evidence. The October 1 three-recipient
expansion below is historical.

The isolated package includes `user-issue-contacts.js` for server-owned exact-UID
contact lookup; `user-issue-classification.js` and `user-issue-summary.js` for
evidence-based classification and fully paged fixed-period summaries; and
`user-issue-observations.js` / `user-issue-request-identity.js` for durable source
claims and compatible-request corroboration. Known operation and authorized target
evidence must be compatible. Conflicting endpoints, known athletes or anonymous
sessions remain separate; missing context and bounded-registry overflow cannot
silently discard an attempt. Source observations retain original context without
replacing canonical identity or frozen mail history.

`userIssueOccurrences/{id}/observations/{id}` holds immutable private source
observations. `userIssueSourceClaims/{id}` maps each source replay to its stable
occurrence; `userIssueRequestIdentities/{id}` stores the bounded server-owned branch
registry. These are private backend records, not a public user/contact directory.
Keep their replay evidence when reviewing retention. Exact contacts can be missing,
unverified or last-known; a target athlete and a reporting account remain separate.
Generic diagnostics and automated service failures do not establish an operator or
a confirmed crash. Workbook/action/email counts are not unique-user counts.

| Functions | Trigger |
|---|---|
| submitUserIssue, getUserIssues, updateUserIssue | Callable; auth enforced in handler |
| observeIssueAi, observeIssueReport, observeIssueDiagnostic | Create-only source observers |
| observeIssueLog | `posetek-user-issues` Pub/Sub topic |
| dispatchUserIssue | Outbox write; existing Microsoft secret bindings plus retained legacy Resend binding |
| sweepUserIssues | Every five minutes; same provider bindings |
| dailyUserIssues | 09:00 America/Los_Angeles; same provider bindings |

Use fresh ignored paths and the existing authorized short-lived owner-session
format (`access_token`, `expires_at` milliseconds). Keep credentials out of Git.

```powershell
$python = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$releaseDir = '.netlify/user-issues/RELEASE-UNIQUE'
$credentialFile = '.netlify/user-issues/owner-session.json'
& $python -B deployments/user-issues/prepare.py --mode prepare --run-dir $releaseDir --credential-file $credentialFile
npm --prefix "$releaseDir/source" ci --ignore-scripts --no-audit --no-fund
# Inspect the manifest, ten exports and current source/configuration/IAM before
# an explicitly authorized isolated deployment. Never use functions/index.js.
firebase deploy --project kickai-69dd0 --config "$releaseDir/firebase.json" --only functions:user-issues --non-interactive
& $python -B deployments/user-issues/prepare.py --mode verify --run-dir $releaseDir --credential-file $credentialFile
```

Do not use `--force` to bypass new deletion/retry or permission warnings. The
reviewed release used a source-only guarded operator with exact per-endpoint
preflight, write-ahead operation evidence, no replay after lost acknowledgement,
and full source/configuration/IAM readback. Packaging or a CLI success alone does
not establish this acceptance. Preserve every unrelated function and schedule.

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

Cloud Monitoring policy `6520825830736261069` now uses the Dylan email channel
`17819036609163820276`, independently of the application email provider. The
separate AI policy also targets Dylan alone. Existing channels and access are not
deleted by a recipient change. Verify actual policy destinations and enabled
state after changes; do not infer them from an older setup receipt. Read back
both Cloud Scheduler jobs. The original intake required the two additive
`userIssueOccurrences`/`userIssueActors` indexes declared in root
`firestore.indexes.json`. Preserve all existing composites and field overrides;
patch only a reviewed missing definition. The separate finalization-field repair
uses the [narrow index planner](../../docs/USER_ISSUE_COVERAGE_VALIDATION.md),
not a project-wide index replacement. Never delete unrelated indexes.

## Historical October 1 recipient expansion

For that rollout, the backward-compatible webhook scope was deployed and
verified before the user-issues scope. New
issue/status/daily payloads included all three recipients; the shared provider's
workout default remains Dylan-only. Frozen earlier payloads and keys are never
rewritten. Per-recipient callbacks must settle independently, including callbacks
received before the send response and out of timestamp order between recipients.
This backend-only adjustment does not require a website, rules, gateway or native
release. Read `deployment/USER_ISSUE_RECIPIENTS_PRODUCTION.json` for rollout evidence
and actual delivery limits; configured destinations are not proof of Inbox arrival.

That recipient set and Resend setup are historical. New dispatch and transactional
Microsoft send claims require Dylan-only effective recipients immediately before
authorization. Consumed claims, original payloads and per-recipient receipts remain
unchanged. The recent approved Microsoft amendments have their own audited window;
the older Resend backlog remains for review and is not replayed.

## Acceptance and application promotion

1. Run the focused Node tests below, including source packaging, request identity,
   classification, summary completeness, contact lookup and source observations.
2. Run `npm --prefix app test` and TypeScript. Test `userIssues` through
   `scripts/run-rules-tests.mjs`, pointing at the canonical native `firebase/` rules.
   This includes the real Firestore SDK transaction/query/outbox checks.
3. Run `app/scripts/test-user-issues-browser.mjs` against a local Vite preview on
   port 5184. It intercepts report submissions, tests offline→received once at
   360/390/768/1440 widths, and captures protected-admin synthetic layouts.
4. For an explicitly approved new pilot, use isolated temporary accounts and `testUids`; verify genuine delivery,
   original actor isolation, direct-client denial, protected evidence, duplicate
   events, recurrence, status changes and the scheduled summary. A synthetic
   Crashlytics payload tests the adapter, not a device/export integration.
5. The cloud runtime is `nodejs22`. The application engine is `>=22.19.0`; the
   bundled Node v24.19.0 satisfies it, while PATH v22.18.0 does not. Set
   `PUBLIC_RELEASE_SHA` and `VITE_RELEASE_SHA` to the committed source or exact
   frozen candidate-source digest. Use the explicit
   [Astro application-only workflow](../../deployment/ASTRO_APPLICATION_ONLY_RELEASE.md)
   with `--preserve-marketing` and a fresh provider-verified manifest. Preserve
   exact current marketing, protected assets and platform configuration.
6. Review the draft artifact, publish only to PoseTek site
   `b1ccf990-286c-4367-bb67-ca0d9ea2a020`, verify the exact draft and promote it
   without rebuilding. Reconcile the baseline from verified production inventory.
7. Park the pilot, verify no sends remain in flight, remove only run-owned synthetic
   data/accounts, then activate with a fresh server cutoff and no pilot allowlist.

If rollout fails, disable issue intake/sending and restore the reviewed Netlify
predecessor or the exact scoped backend rollback. Do not restore user data as a
code rollback. Do not change workout-notification settings. Native release remains
separate and requires the documented Mac/iPhone/TestFlight acceptance.

Focused local checks (production runtime remains Node 22):

```powershell
$node = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $node --test functions/user-issues.test.js functions/user-issue-classification.test.js functions/user-issue-summary.test.js functions/user-issue-observations.test.js functions/user-issue-request-identity.test.js functions/user-issue-contacts.test.js functions/user-issue-source-packaging.test.js functions/social-request-issue-correlation.test.js functions/workout-notifications.test.js functions/microsoft-email.test.js
```

Verify a genuine post-change alert against its provider evidence and fresh cloud
workbook, rather than creating another synthetic incident without approval.
Crashlytics Cloud Logging export is On for the registered iOS app; genuine
symbolicated device export and the native release gate remain unverified.
