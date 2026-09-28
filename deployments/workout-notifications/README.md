# Workout notifications: scoped release

This release adds email observers and web activity tracking without modifying
workout logs, gateway operations, native code or Firebase rules. Missing settings
disable collection and sending. Never enable production mail before verifying
Resend and the intended recipient with synthetic outcomes.

## Prerequisites

- Resend sending domain `alerts.posetek.net`, with its exact generated DNS records
  installed and verified. Preserve existing `posetek.net` mail routing.
- Sender `PoseTek Workouts <workouts@alerts.posetek.net>`; the sole destination is
  `dylank@posetek.net`. Disable open and click tracking in Resend.
- Sending-only, domain-restricted `RESEND_API_KEY` and independent
  `RESEND_WEBHOOK_SECRET` in Google Secret Manager for `kickai-69dd0`. Enter values
  through the provider/secret-manager UI or secure CLI input, never in Git or chat.
- Configure the signed webhook URL after its function exists:
  `https://us-central1-kickai-69dd0.cloudfunctions.net/resendWorkoutNotificationWebhook`.
  Subscribe to sent, delivered, delivery_delayed, bounced, failed and
  suppressed email events supported by the adapter.

## Prepare and verify

`prepare.py` reuses the Expanded Insights immutable source/inventory/IAM auditor.
Three independent codebases prevent a partial setup from deleting another scope:

| Scope | Exports | Secret |
| --- | --- | --- |
| intake | observeWorkoutNotifications, observePersonalWorkoutNotifications, recordWorkoutActivity, getWorkoutNotificationStatus | None |
| delivery | dispatchWorkoutNotification, sweepWorkoutNotifications | RESEND_API_KEY |
| webhook | resendWorkoutNotificationWebhook | RESEND_WEBHOOK_SECRET |

Use a fresh ignored directory for each scope/attempt and a current authorized
short-lived owner session containing `access_token` and `expires_at` in
milliseconds, following the existing Expanded Insights operations workflow.
The helper reads credentials without printing them. It does not deploy.

```powershell
python -B deployments/workout-notifications/test_prepare.py
$releaseDir = '.netlify/workout-notifications/intake-YYYYMMDDTHHMMSSZ'
$credentialFile = '.netlify/workout-notifications/owner-session.json'
python -B deployments/workout-notifications/prepare.py --mode prepare --scope intake --run-dir $releaseDir --credential-file $credentialFile
npm --prefix "$releaseDir/source" ci --ignore-scripts --no-audit --no-fund
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '120'
firebase deploy --project kickai-69dd0 --config "$releaseDir/firebase.json" --only functions:workout-notifications-intake --non-interactive --force
python -B deployments/workout-notifications/prepare.py --mode verify --scope intake --run-dir $releaseDir --credential-file $credentialFile
```

Repeat with `delivery` and `webhook` only after their real secrets are available.
Never substitute placeholder keys to force deployment. Use only the exact
generated codebase with its matching configuration; do not deploy all root
functions. Keep prepared bytes unchanged through deployment and verification.
Read back the five-minute scheduler and its target topic after deploying delivery.

The canonical rules in `posetek/posetek-mobile-app/firebase` already default-deny
the three private top-level roots. Run `workoutNotifications` through
`scripts/run-rules-tests.mjs` against those exact canonical rules. Do not restore
the retired website rules copies or deploy rules from this repository.

## Enable and recover

Use an operator-reviewed server write to `workoutNotificationSettings/current`;
clients have no direct access. The settings contract and activity API are documented
in `docs/WORKOUT_NOTIFICATIONS.md`. Save the previous settings before changing them.
Choose `activatedAtMillis` at the verified production activation, so historical
completion records do not flood the mailbox. Keep global mail disabled until
mailbox acceptance passes. Enable both flags only with a synthetic test allowlist
for the live pilot, then advance the cutoff when enabling all players.

For website changes, use the guarded application builder with a verified current
marketing snapshot, review the exact draft, promote it without rebuilding and
reconcile the preservation baseline. Source commits use `[skip netlify]`.

To stop emails, set `sendEnabled: false`. To stop all new collection, also set
`enabled: false`. Neither operation alters workout saving. Disabling is the first
rollback action; do not delete workout history or notification receipts. Restore
only the exact owned function source/configuration/IAM versions from the private
before-images, after checking for concurrent changes. Keep server-only storage
private. An uncertain send older than the provider's idempotency window must be
reviewed with Resend before any manual resend; never replace its idempotency key
and blindly retry it.
