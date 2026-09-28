# Workout email alerts

Implemented September 28, 2026. Email activation is pending Resend account access,
verification of `alerts.posetek.net`, real Secret Manager credentials, and mailbox
acceptance. Missing settings keep collection and sending disabled. Do not describe
the feature as delivering production mail until these steps have passed.

## Confirmed behavior

The only recipient is `dylank@posetek.net`. All players are eligible after launch.
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
`workout-notifications-provider.js` owns Resend transport and raw-body signature
verification; `workout-notifications-entrypoints.js` defines seven narrow exports.
Use the independent codebases in
[the scoped release guide](../deployments/workout-notifications/README.md).

Only these new private roots are written:

- `workoutNotificationSettings/current`: operator configuration.
- `workoutNotificationActivity/{executionHash}` and its `sessions` subcollection:
  last meaningful activity, connection receipt, tab ownership, sequence and rate
  state, and the next quiet deadline.
- `workoutNotificationOutbox/{executionHash}_{terminal|inactivity}` and its
  `webhookEvents` subcollection: immutable attempted payload, leases, delivery
  evidence and deduplicated signed webhook receipts.

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

The recipient, sender, quiet threshold and timezone are fixed in server source;
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

## Delivery and recovery

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

## Validation and activation gate

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

Run frontend tests/TypeScript, backend Node tests, the `workoutNotifications`
canonical rules suite and scoped release auditor tests before publication.
Synthetic responsive review covers 360, 390, 430 and 1440 pixels. Preview images,
credentials, production captures and generated output remain ignored.

The September 28 full website suite passed 1,340 tests, TypeScript, 150 canonical
rules assertions, 22 release/baseline tests and 11 scoped publisher tests. The
backend suite passed 407 tests with three existing skips (410 total), and all
15 actual-SDK Firestore transaction cases passed after the final race fixes. The
deliberate application build preserved all 1,144 unrelated baseline files plus
all 32 current marketing files, replacing only the application entry and adding
62 compiled assets. Repository-wide lint still reports five existing
`useSelection` hook-name errors in unchanged `use-personal-workouts.ts`, plus
existing warnings; scoped admin notification lint is clean.

The reviewed draft is
[`6abada4b493ace6c0a463c71`](https://6abada4b493ace6c0a463c71--posetek.netlify.app/admin).
All 1,239 uploaded artifact files match the local candidate, all 32 served
marketing routes match current production, and protected deep-link routes serve
the intended application entry. Production remains `6ab8679ccbfca079f8997124`.
Authenticated preview browser acceptance is incomplete: sign-in returned a
connection interruption twice. No auth-domain/security settings were changed.

Before all-player activation: verify the sending domain, deploy the genuine
secret-bound delivery/webhook scopes, confirm the five-minute scheduler, and
perform synthetic live completion, early-finish, quiet/resume and delivery-status
acceptance to the sole recipient. Check the protected link through sign-in and
read back all scoped source/configuration/IAM metadata. Record the actual
production receipt and activation cutoff; remove only run-owned synthetic data.
Local/emulator tests do not substitute for mailbox acceptance.
