# Workout notifications: scoped release

New workout mail uses Microsoft 365 through Power Automate, from
`alerts@posetek.net` to Dylan alone. The authoritative workout outbox, intake
cutoffs, saved-outcome and inactivity contracts remain unchanged. Read
[the current Microsoft guide](../microsoft-email/README.md),
[workout handoff](../../docs/WORKOUT_NOTIFICATIONS.md) and
[coverage correction receipt](../../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
before another release. Frozen historical provider assignments and receipts are
preserved; Resend history is not replayed or rerouted. The following September 28
activation and provider setup remain historical evidence, not instructions to
replace the current Microsoft flow.

## Historical September 28 activation

This release adds email observers and web activity tracking without modifying
workout logs, gateway operations, native code or Firebase rules. Missing settings
disable collection and sending. All-player activation was confirmed on September
28, 2026 at `23:06:30.994Z` (4:06:30 PM PDT). Settings then contained exactly
`enabled: true`, `sendEnabled: true`, and `activatedAtMillis: 1790636790868`
(`2026-09-28T23:06:30.868Z`), with no test allowlist. All seven scoped functions and
the five-minute scheduler are deployed and audited.
At that rollout Resend domain, key scope, tracking settings and signed webhook setup passed.
The synthetic pilot completed with three provider-confirmed deliveries and genuine
signed delivery receipts, including inactivity after a natural 30-minute wait.
The quiet message's inbox arrival was independently confirmed at 22:56:03 UTC;
the first two messages have provider delivery confirmation only. Resume cancelled
one unattempted quiet email, and a historical fixture ending produced no email.
The exact reviewed website `6abadd8abff0a78fde2fbe28` (frontend source `d814225`)
was promoted at `22:56:54.754Z`, with protected links and sign-in return verified
before cleanup. Final run-owned cleanup passed at `23:06:17.889Z`.

The postactivation read-only audit confirmed the exact settings, zero records in
each of three bounded private activity/outbox queries, and all 15 explicit
synthetic notification roots absent. These observations do not establish
real-athlete delivery or exhaustive historical coverage. Read
[the production activation receipt](../../deployment/WORKOUT_NOTIFICATIONS_PRODUCTION.json);
preserve [the provider verification receipt](../../deployment/WORKOUT_NOTIFICATIONS_PROVIDER_VERIFIED.json)
and earlier receipts as historical checkpoints.

## Historical Resend prerequisites

- Resend sending domain `alerts.posetek.net`, with its exact generated DNS records
  installed and verified. The three provider-generated records and subsequent
  subdomain-only DMARC record are below;
  use the provider's current values for later setup or rotation. Preserve existing
  `posetek.net` mail routing.
- Sender `PoseTek Workouts <workouts@alerts.posetek.net>`; the sole destination is
  `dylank@posetek.net`. Both open and click tracking were verified disabled in the
  Resend dashboard and must remain disabled.
- Sending-only, domain-restricted `RESEND_API_KEY` and independent
  `RESEND_WEBHOOK_SECRET` in Google Secret Manager for `kickai-69dd0`. Enter values
  through the provider/secret-manager UI or secure CLI input, never in Git or chat.
  Both historical bindings used version 1; the sending key's domain was exactly
  `alerts.posetek.net`.
- Register the exact signed webhook URL to obtain its endpoint-specific signing
  secret, store the genuine secret, then deploy and verify the receiver before
  any live pilot:
  `https://us-central1-kickai-69dd0.cloudfunctions.net/resendWorkoutNotificationWebhook`.
  The enabled endpoint `000f971a-e5b5-4df1-9a87-c0335554f403` subscribes to
  `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
  `email.failed` and `email.suppressed`.

| Type | Name | Actual provider target/value | Cloudflare mode |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.alerts.posetek.net` | Provider-generated DKIM public key; exact value verified in the private DNS receipt | DNS only |
| CNAME | `rsend.alerts.posetek.net` | `rsend.forge.rmta.net` | DNS only |
| CNAME | `send.alerts.posetek.net` | `send.forge.rmta.net` | DNS only |
| TXT | `_dmarc.alerts.posetek.net` | `v=DMARC1; p=none;` | DNS only |

Public resolution of the three provider-generated records passed at 22:18:17 UTC
and Resend showed the domain verified at 22:20 UTC. The additional DMARC TXT
readback passed at 22:30:38 UTC; the root `_dmarc.posetek.net` remained absent.
The initial `p=none` policy applies only to alerts, with no reporting/forwarding
addresses or change to root mail policy. The quiet fixture email reached the
inbox at 22:56:03 UTC after this change; future inbox placement is not guaranteed.
This setup uses these TXT/CNAME records; older
example MX/SPF lookups in the historical setup receipt are not records to add.
The existing root Microsoft mail routing and SPF were preserved. Provider public
keys are not credentials, but future operators should obtain their exact current
value from the verified domain configuration rather than copy an obsolete key.

## Prepare and verify

`prepare.py` reuses the Expanded Insights immutable source/inventory/IAM auditor.
Three independent codebases prevent a partial setup from deleting another scope:

| Scope | Exports | Secret |
| --- | --- | --- |
| intake | observeWorkoutNotifications, observePersonalWorkoutNotifications, recordWorkoutActivity, getWorkoutNotificationStatus | None |
| delivery | dispatchWorkoutNotification, sweepWorkoutNotifications | Microsoft flow/tenant/client bindings plus retained legacy RESEND_API_KEY |
| webhook | resendWorkoutNotificationWebhook | RESEND_WEBHOOK_SECRET |

Use a fresh ignored directory for each scope/attempt and a current authorized
short-lived owner session containing `access_token` and `expires_at` in
milliseconds, following the existing Expanded Insights operations workflow.
The helper reads credentials without printing them. It does not deploy.

```powershell
$python = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python -B deployments/workout-notifications/test_prepare.py
$releaseDir = '.netlify/workout-notifications/intake-YYYYMMDDTHHMMSSZ'
$credentialFile = '.netlify/workout-notifications/owner-session.json'
& $python -B deployments/workout-notifications/prepare.py --mode prepare --scope intake --run-dir $releaseDir --credential-file $credentialFile
npm --prefix "$releaseDir/source" ci --ignore-scripts --no-audit --no-fund
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '120'
firebase deploy --project kickai-69dd0 --config "$releaseDir/firebase.json" --only functions:workout-notifications-intake --non-interactive
& $python -B deployments/workout-notifications/prepare.py --mode verify --scope intake --run-dir $releaseDir --credential-file $credentialFile
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

For subsequent setup, releases or reactivation, preserve the following acceptance
and recovery gates. Use an operator-reviewed server write to
`workoutNotificationSettings/current`;
clients have no direct access. The settings contract and activity API are documented
in `docs/WORKOUT_NOTIFICATIONS.md`. Save the previous settings before changing them.
Choose `activatedAtMillis` at the verified production activation, so historical
completion records do not flood the mailbox. Keep global mail disabled until
mailbox acceptance passes. Enable both flags only with a synthetic test allowlist
for an explicitly approved live pilot. A generic callback returning HTTP 200 is insufficient:
require actual attempted messages, the selected provider's delivery evidence,
independent provider readback and mailbox/protected-link acceptance. For current
Microsoft jobs, verify the consumed claim, signed-secret callback and exact
Exchange trace; duplicate or uncertain outcomes cannot authorize another Send.
Complete quiet/resume
checks and provider acceptance of all three messages. Promote the exact reviewed
frontend and reconcile its baseline, then check production protected links while
the fixtures still exist. Park and clean up only proven run-owned fixtures and
audit that cleanup. After mailbox acceptance and cleanup pass, remove the pilot
allowlist and advance the cutoff at all-player activation;
neither a provider checkpoint nor a pilot authorizes a historical
backfill.

For website changes, use the
[Astro application-only builder](../../deployment/ASTRO_APPLICATION_ONLY_RELEASE.md)
with a verified current marketing manifest and `--preserve-marketing`, review the
exact draft, promote it without rebuilding and
reconcile the preservation baseline. Source commits use `[skip netlify]`.

To stop emails, set `sendEnabled: false`. To stop all new collection, also set
`enabled: false`. Neither operation alters workout saving. Disabling is the first
rollback action; do not delete workout history or notification receipts. Restore
only the exact owned function source/configuration/IAM versions from the private
before-images, after checking for concurrent changes. Keep server-only storage
private. An uncertain historical Resend send must be reviewed against its original
provider evidence before any separately approved resend; never replace its
idempotency key blindly. Microsoft consumed claims have no automatic resend,
including after a delayed acknowledgement. Never clear a claim or move a frozen
job to another provider as recovery.
