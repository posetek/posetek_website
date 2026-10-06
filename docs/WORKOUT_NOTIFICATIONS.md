# Workout email alerts

## Current Microsoft delivery

New workout notifications use **Microsoft 365 through Power Automate**, sent from
`alerts@posetek.net` to **`dylank@posetek.net` alone**. The existing Firebase workout
outbox and future-only intake contracts remain authoritative. The Microsoft
migration preserved the original intake cutoff, workout data, function IAM and
schedules. No additional subscription purchase or historical Resend replay is part
of the coverage correction. Frozen historical provider assignments, payloads,
claimed sends and delivery evidence remain intact.

Use [the Microsoft delivery guide](../deployments/microsoft-email/README.md),
[current coverage handoff](NOTIFICATION_COVERAGE_CORRECTION.md) and
[correction receipt](../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
for the latest operational checks. The
[migration receipt](../deployment/MICROSOFT_EMAIL_PRODUCTION.json) and
[recipient/contact refinement receipt](../deployment/NOTIFICATION_REFINEMENT_PRODUCTION.json)
retain their earlier dated acceptance. The current application release is
`6ac06e0d420f2b6b34129fb5`; the September 28 release below is historical.

The event-driven issue tracker remains in **PoseTek > Technology > Website >
User Issue Tracker > PoseTek Issue Tracker.xlsx**, with Nolan and Taiyo retaining
editing access. They no longer receive new alert emails. Power Automate event
intake and automatic cloud recovery run independently of this chat, Codex and
Dylan's computer. Capture, workbook publication, send acceptance and confirmed
recipient delivery are distinct; the latest receipt supplies the verified cutoffs.

## Historical September 28 activation and Resend acceptance

Workout email alerts activated for all players on September 28, 2026 at
4:06:30 PM PDT. Activation was confirmed at `2026-09-28T23:06:30.994Z` with exactly
`enabled: true`, `sendEnabled: true`, and
`activatedAtMillis: 1790636790868` (`2026-09-28T23:06:30.868Z`); no test allowlist
remains. The website release `6abadd8abff0a78fde2fbe28`, from frontend source
`d814225`, was promoted at `2026-09-28T22:56:54.754Z`.

At that rollout all seven scoped Firebase functions were ACTIVE at version 1,
with audited source bytes, definitions, IAM and preservation of unrelated
functions. The four intake functions were deployed from source `38baa80`.
Anonymous requests to both callables were rejected. The delivery functions then used
`RESEND_API_KEY` version 1; the signed webhook uses the independent
`RESEND_WEBHOOK_SECRET` version 1. No secret values belong in this repository.

Resend verified `alerts.posetek.net`. Its actual generated DNS consists of one
DKIM TXT record and two DNS-only CNAMEs, documented in
[the scoped release guide](../deployments/workout-notifications/README.md).
A fourth TXT record adds `v=DMARC1; p=none;` only at `_dmarc.alerts.posetek.net`;
public readback passed at 22:30:38 UTC. The root DMARC policy, mail routing and SPF
were unchanged. The quiet fixture email reached the inbox at 22:56:03 UTC after
that policy change. This observation does not guarantee future inbox placement.
The sending-only key was
restricted to `alerts.posetek.net`, open/click tracking is disabled, and the
enabled webhook subscribes to all six supported delivery events.

The isolated synthetic pilot completed with three provider-confirmed deliveries
and genuine signed delivery receipts: an assigned completion, a personal early
finish, and inactivity after a natural 30-minute wait. Only the third message's
inbox placement was independently confirmed; the first two have provider delivery
confirmation. Resume cancelled one unattempted quiet email, and one historical
fixture ending produced no email. Inactivity did not invent a workout ending.
Production protected links and sign-in return passed before fixture removal.
The final cleanup audit passed at `2026-09-28T23:06:17.889Z`.

The read-only postactivation audit verified the exact three settings fields,
observed zero records in each of three bounded private activity/outbox queries,
and confirmed all 15 explicit synthetic notification roots absent. These are
bounded observations, not evidence of real-athlete delivery or exhaustive
historical coverage. Missing settings still disable collection and sending by
design.

Read the [production activation receipt](../deployment/WORKOUT_NOTIFICATIONS_PRODUCTION.json).
The [provider verification checkpoint](../deployment/WORKOUT_NOTIFICATIONS_PROVIDER_VERIFIED.json),
[preview receipt](../deployment/WORKOUT_NOTIFICATIONS_PREVIEW.json), and
[earlier provider setup receipt](../deployment/WORKOUT_NOTIFICATIONS_PROVIDER_SETUP.json)
remain unchanged historical records; their pending DNS/access states are not the
current setup instructions.

That rollout's delivery source, secret bindings, function IAM, scheduler target and unrelated
function inventory passed readback. The publisher now accepts Google's equivalent
empty scheduler retry policy while still rejecting an enabled retry or changed
trigger. All 14 notification-publisher and 19 shared-publisher checks passed.

## Confirmed behavior

The only recipient is `dylank@posetek.net`. All players are eligible from the
activation cutoff.
Saved endings from both `players/{playerId}/workoutLogs/{logId}` and
`players/{playerId}/personalWorkoutLogs/{logId}` are observed, including endings
saved by the current native app. Assigned/ad-hoc endings support `completed`,
`endedEarly`, and `abandoned`; personal endings support `completed`, `stopped`,
and `pain`. Unsupported or incomplete records do not invent an outcome.

The updated website also reports Start/Resume, interactions, pause position, and
visible running connection signals. A workout with web observation and no saved
ending becomes eligible for one inactivity email after 30 minutes without a
meaningful interaction or saved progress. A five-minute sweep processes eligible
sessions in bounded batches, so this is not an exact 30-minute alarm. A paused
workout may qualify. Heartbeats and Pause do not renew the deadline. Resume or
progress cancels an unsent quiet alert. A later explicit ending can still send its
own email. Native-only sessions have saved-outcome coverage, not inferred
inactivity coverage. No start or immediate pause emails are sent.

Inactivity never writes an ending, abandonment, or completion to a workout log.
It cannot prove that the player stopped exercising: a pause or missing connection
may explain the silence. Workouts continue to save and operate when telemetry or
email fails. No new app installation is required for native saved outcomes;
physical-device acceptance of new native telemetry is not claimed.

Emails include the player and current organization/team, pinned workout title,
recorded start/end or last meaningful activity in America/Los_Angeles, timer or
estimated duration as available, reported sets, done/partial/skipped drills, and
the last selected drill when recorded. Completion is a logged outcome; skipped
drills do not become completed sets. Neither the email nor the admin history
claims measured attendance. No conversation contents or testing media are sent.

Each email opens the protected admin player history at the exact log/source:
`/admin/accounts/player/{playerId}?workoutSource={source}&workoutLog={logId}`.
The link survives sign-in only for an administrator. The history shows saved
outcomes separately from web signals and mail status. Status is fetched on entry
or Refresh, with a checked time; it is not a live presence indicator.

## Server contract

`functions/workout-notifications.js` owns transactions and job state;
`workout-notifications-provider.js` selects the frozen provider and retains legacy
Resend transport/raw-body signature verification; `microsoft-email-model.js` and
`microsoft-email-transport.js` freeze Microsoft routing and submit only the job
reference to the authenticated flow. The separate Microsoft email scope owns
transactional Claim/Receipt and Exchange trace reconciliation.
`workout-notifications-entrypoints.js` defines seven narrow workout exports.
Use the independent codebases in
[the scoped release guide](../deployments/workout-notifications/README.md).

Workout-specific private roots are:

- `workoutNotificationSettings/current`: operator configuration.
- `workoutNotificationActivity/{executionHash}` and its `sessions` subcollection:
  last meaningful activity, connection receipt, tab ownership, sequence and rate
  state, and the next quiet deadline.
- `workoutNotificationOutbox/{executionHash}_{terminal|inactivity}` and its
  `webhookEvents` subcollection: immutable attempted payload, leases, delivery
  evidence and deduplicated signed webhook receipts.

Microsoft claims and per-recipient results are retained on the same outbox job.
The separate email scope uses private `microsoftEmailSettings/current` and
`microsoftEmailState` for provider gates, send/recipient budgets and trace recovery.
It does not create a second authoritative workout outbox. These records and all
historical webhook evidence remain private; retention must preserve deduplication
and consumed-send evidence.

Canonical mobile-repository rules already deny direct client access, including
for administrators. Website admin reads use the verified-admin callable and
return a minimal status projection. No Firestore rule, gateway, native, catalog,
training-plan or existing log mutation belongs to this release. Private receipts
are durable; no automatic deletion/TTL is introduced. Preserve deduplication
receipts when applying any later retention policy.

Settings are server-only, with these fields:

| Field | Meaning |
| --- | --- |
| `enabled` | Collect future eligible outcomes and web observations when exactly true. |
| `sendEnabled` | Permit provider requests when both enable flags are true. |
| `activatedAtMillis` | Positive past/current Unix milliseconds; future or missing cutoff disables collection. |
| `testPlayerIds` | Optional nonempty unique list of 1–50 player IDs for a synthetic pilot. Omit for all players; invalid/empty lists disable collection. |
| `emailProvider` | `microsoft` for new jobs after the migration; an already frozen/attempted job retains its recorded provider. |

The recipient, authorized Microsoft sender, quiet threshold and timezone are server-owned;
client input cannot redirect mail. Parked settings may contain false flags and a
zero cutoff. For pilot acceptance, use only synthetic player IDs, a fresh cutoff,
and true flags after provider setup. For all-player activation, remove the test
allowlist and advance the cutoff to the actual activation time. Never backdate it.
Only a new terminal transition with an eligible recorded end and trigger time can
create an ending job; historical completed logs are not backfilled.

`recordWorkoutActivity` accepts only:

```text
source: workoutLogs | personalWorkoutLogs
logId: saved document ID
sessionId: UUID
sequence: nonnegative increasing integer
eventId: sessionId + ':' + sequence
type: resume | progress | pause | heartbeat
occurredAtMillis: captured interaction time
ownerEpoch: absent on first resume, then the returned server epoch
blockId: optional pinned snapshot block ID
```

The server resolves the signed-in athlete, excludes staff/ambiguous bindings,
and reads that athlete's exact existing log. First resume at sequence zero claims
ownership. Retired sessions cannot reclaim it; duplicates recover an unchanged
claim response. Events older than 120 seconds, more than 60 seconds in the future,
or before activation are refused. Replaying an ID with changed content fails.
The per-execution limit is 20 accepted events per minute. The browser coalesces a
bounded in-memory queue and preserves original timestamps across retries; it does
not persist/replay an offline history or block the workout save journal.

`getWorkoutNotificationStatus` accepts `{playerId, source, logId}` and requires
the existing verified PoseTek administrator predicate. Client-side previews do
not write activity. Heartbeats are at most once per minute while the current
owner is visible and running.

## Current Microsoft delivery and recovery

Execution keys include the player and personal/plan/ad-hoc namespace. A dispatch
lease freezes the provider, exact payload and workout source guard. The flow
receives only the job reference; an authenticated transactional Claim rereads the
current domain/provider gates, Dylan-only envelope and exact source state before
consuming permission. Claim binds the payload digest, recipient set, run and token.
Outlook Send retries are **None**. Duplicate triggers, a delayed flow response or
an uncertain acknowledgement cannot grant another send after a consumed claim.

A flow acknowledgement is only a wake-up. Its authenticated accepted/uncertain
Receipt and independent Exchange message trace supply delivery evidence. Accepted
means the send action accepted the request; delivered requires the matching
provider/recipient evidence and does not prove Inbox placement or reading.
Missing, expired or conflicting trace evidence remains `needs_review`, with
automatic resend blocked. Do not reset claims or move an uncertain job to another
provider. Historical partial outcomes retain their original recipients and status.

Set `sendEnabled: false` to stop new send authorization; also set `enabled: false`
to stop new collection. A request whose permission was already consumed may finish.
An unsent quiet job superseded by progress is cancelled. Preserve workout history
and original outcomes during notification recovery. The Microsoft flow and
existing secrets/connections/tenant restrictions are checked separately from
backend or website tests.

## Historical Resend delivery contract

Execution keys include the player and personal/plan/ad-hoc namespace. Delivery
uses a deterministic outbox ID, transactional two-minute lease, and the same
Resend idempotency key and frozen payload on every retry. Provider requests run
outside the Firestore transaction. Exponential retries honor bounded Retry-After.
Automatic uncertain sends stop before 23 hours; `needs_review` requires checking
provider evidence before any resend. This fits within Resend's documented
[24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).

Signed webhooks validate original bytes, the Svix signature and five-minute
freshness before parsing. Only the configured sender, recipient and matching
attempted job can advance delivery state. `accepted` means the provider accepted
the request; `delivered` means a delivery event, not that Dylan read the email.
Supported provider events are sent, delivered, delivery_delayed, bounced,
suppressed and failed. Duplicate/out-of-order events do not roll a final delivery
back to an intermediate state. Open/click tracking is disabled in provider setup.

Set `sendEnabled: false` to stop new sends. Also set `enabled: false` to stop new
collection. A provider request already in flight may complete. An unsent quiet
job superseded by activity is cancelled; a job that was attempted before the
change is marked for review because acceptance may already have occurred.
Never blindly issue a new key to recover an uncertain send. Do not delete workout
history or overwrite players' original outcomes during notification recovery.

Those keys, envelopes and signed receipts remain historical evidence. Resend's
idempotency window does not authorize sending a Microsoft job again, and a later
provider setting cannot recover an uncertain historical send. Historical Resend
jobs remain for deliberate review, without automatic replay.

## Validation and future release gates

Focused coverage includes future-only activation, both source namespaces,
synthetic allowlists, identity/ownership, delayed saves, idle/pause behavior,
duplicate triggers, provider uncertainty, webhook races, private collection
rules, protected deep links and truthful partial outcomes. The actual Firestore
SDK transaction tests run only against a guarded loopback demo emulator:

```powershell
# Start a disposable Firestore emulator at 127.0.0.1:8190 first.
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8190'
$env:GCLOUD_PROJECT = 'demo-workout-notifications-integration'
node --test functions/workout-notifications.emulator.cjs
```

Focused local provider and packaging checks use the bundled runtime; the cloud
package remains Node 22:

```powershell
$node = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $node --test functions/workout-notifications.test.js functions/microsoft-email.test.js functions/user-issue-source-packaging.test.js
```

Run frontend tests/TypeScript, backend Node tests, the `workoutNotifications`
canonical rules suite and scoped release auditor tests before publication.
Synthetic responsive review covers 360, 390, 430 and 1440 pixels. Preview images,
credentials, production captures and generated output remain ignored.

The following September 28 validation remains historical. Its full website suite passed 1,340 tests, TypeScript, 150 canonical
rules assertions, 22 release/baseline tests and 11 scoped publisher tests. The
backend suite passed 407 tests with three existing skips (410 total), and all
15 actual-SDK Firestore transaction cases passed after the final race fixes. The
deliberate application build preserved all 1,144 unrelated baseline files plus
all 32 current marketing files, replacing only the application entry and adding
62 compiled assets. Repository-wide lint still reports five existing
`useSelection` hook-name errors in unchanged `use-personal-workouts.ts`, plus
existing warnings; scoped admin notification lint is clean.

That production release was
[`6abadd8abff0a78fde2fbe28`](https://6abadd8abff0a78fde2fbe28--posetek.netlify.app/admin),
from frontend source `d814225`, promoted without rebuilding the reviewed candidate.
The reconciled protected baseline contains 1,207 files. The ordinary preservation
build passed all 1,239 artifact checks, retained all 32 marketing files, and passed
22 release/baseline tests. Production checks passed 30 routes and 1,049 asset HTTP
checks. Browser checks passed all three exact protected fixture links and automatic
sign-in return to the requested player before cleanup. History
remained a single section after selection, Refresh, Back and Forward; the history
component now has a distinct sibling key from AI incidents. Initial transient
account-access connection errors did not recur on this final preview. No
auth-domain/security settings were changed. The
[preview/intake receipt](../deployment/WORKOUT_NOTIFICATIONS_PREVIEW.json) for
the earlier prepared state remains historical; the
[production receipt](../deployment/WORKOUT_NOTIFICATIONS_PRODUCTION.json) records
completed live acceptance and activation.

At that rollout provider verification and the seven scoped deployments passed; the
five-minute scheduler is enabled with its verified target topic. For future
releases or reactivation, retain the synthetic quiet/resume test and independent
provider/mailbox acceptance to the sole recipient as gates. If artificial timing is used,
identify it as artificial; it cannot precede the real thirty-minute eligibility
or fresh cutoff. Require three delivered fixture messages, genuine
provider-specific delivery evidence, one unattempted cancelled quiet alert, and no historical
email or invented workout ending. Check truthful set/skip content and Pacific
times. Provider `delivered` alone does not establish inbox placement or reading.

For those future releases, after provider acceptance of all three messages,
promote the exact reviewed
website draft and reconcile its baseline. Verify the exact protected fixture
links through administrator sign-in on the published frontend while those
fixtures still exist. Then park the pilot, remove only its proven run-owned
fixtures, reconcile asynchronous descendants and the Auth-deletion tombstone,
and complete the read-only cleanup audit. Once mailbox acceptance and cleanup
have passed, enable all players with a fresh cutoff and remove the pilot
allowlist. Record the final production receipt and settings readback.
Local/emulator tests and provider setup checkpoints do not substitute for completed
live acceptance.
