# Microsoft email delivery candidate

Source candidate only. The user selected Power Automate Premium and the dedicated
shared mailbox `alerts@posetek.net`. The application/service principal and eleven
fixed credential/callback/ingress secrets are configured; the secrets were read
back as Secret Manager version 1. Endpoint secrets are not installed and runtime
grants remain gates. A bounded live trace query returned HTTP 200 with zero matches, proving
trace query access only, not email delivery. No email flow is imported, function
deployed or production provider setting changed. Keep the new route disabled
until the live acceptance below is complete. The issue tracker and its workbook
migration are independent.

The separate tracker writer is On only for its private synthetic fixture and
allows the dedicated service principal. Actual Power Automate transport and
identical replay returned exact revision-six native receipts. The shared-master
hourly writer is **paused by Dylan's request** while Power Automate setup finishes;
do not restart it automatically. Production Resend remains active and the cloud
tracker is not live. Dylan-only mailbox reading for tracker recovery remains
blocked by a contradictory Microsoft prerequisite error in a fresh session despite
`IsDehydrated:false`; the cause is unconfirmed. Mailbox reading is not a permission
needed by this email sender. See [the tracker handoff](../../docs/ISSUE_TRACKER_EVENT_FLOW.md).

Dylan has Full Access to the shared sender mailbox. After his explicit approval,
Send As for `alerts@posetek.net` was read back at `2026-10-02T05:29:31.9389018Z`.
Nolan's existing Send As, Dylan's Full Access and sent-copy settings were preserved.
No email was sent by this step; actual send and recipient-trace acceptance remain
unproven. Preserve the existing mailbox grants. Browser file upload
currently blocks email-flow package import. Neither that flow nor cloud-mail
intake is installed; actual send/recipient-trace acceptance remains required.

The existing Firebase workout and issue outboxes remain authoritative. Workout
recipients remain Dylan only. New issue/status/daily messages retain Dylan, Nolan
and Taiyo. No historical backfill, recipient expansion, native or website release
is part of this package. Google Cloud's independent alert policy remains separate.

## Flow and credentials

Create an Automated cloud flow owned by Dylan and using his licensed connection.
The connection owner's Full Access and Send As for `alerts@posetek.net` are now
verified; recheck the actual permissions before the pilot. The sender is locked in backend
configuration to that exact mailbox. Every new Microsoft issue/status/daily
payload must contain the exact three-recipient set; every workout payload must
contain Dylan alone. Omitting a teammate fails closed. Old attempted Resend
payloads retain their frozen destinations. No general sender or recipient is accepted
from the HTTP trigger.

The backend caller is a dedicated Entra application/service principal. The flow's
Request trigger must use **Specific users in my tenant**, containing the caller's
**service-principal object ID**, not its application/client ID and not `Anyone`.
The backend obtains a client-credentials token for
`https://service.flow.microsoft.com//.default`. The doubled slash preserves the
exact public-cloud audience `https://service.flow.microsoft.com/`; removing it
produces an audience without the required trailing slash and the trigger rejects
the token. See Microsoft's [HTTP-trigger audience requirements](https://learn.microsoft.com/en-us/power-automate/oauth-authentication)
and [v2 resource/.default construction](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#trailing-slash-and-default).
For reconciliation, the same app
requests `https://graph.microsoft.com/.default` with application permission
`ExchangeMessageTrace.Read.All` and tenant admin consent. Provision Microsoft's
message-trace service principal `8bd644d1-64a1-4d4b-ae52-2e0cbf64e373` as required
by the current [onboarding guide](https://learn.microsoft.com/en-us/exchange/monitoring/trace-an-email-message/graph-api-message-trace).
This email backend needs no Graph Mail.Send, mailbox reading or workbook permission.

Bind these exact Secret Manager names:

| Secret | Consumers |
| --- | --- |
| `MICROSOFT_EMAIL_FLOW_ENDPOINT` | Both existing alert dispatchers/sweeps and issue daily function |
| `MICROSOFT_EMAIL_TENANT_ID` | Those senders and trace reconciliation |
| `MICROSOFT_EMAIL_CLIENT_ID` | Those senders and trace reconciliation |
| `MICROSOFT_EMAIL_CLIENT_SECRET` | Those senders and trace reconciliation |
| `MICROSOFT_EMAIL_CALLBACK_SECRET` | Claim and receipt endpoints; identical private secure parameter in flow |

Use a random callback secret of at least 32 characters. The flow calls the public
HTTPS callback transport with `x-posetek-email-secret`; the handler compares this
secret in constant time before parsing the request. No Entra callback audience is
required. The transport is public so Power Automate can reach it, but neither
endpoint accepts an unauthenticated action. Keep action inputs/outputs secure.
Secrets, signed URLs, private flow exports and run bodies must stay out of Git,
terminal output, shared workbooks and diagnostic logs.

`flow-definition.json` contains no credentials. It uses the real exported package
shape from the existing PoseTek Automated writer. Generate an import package:

```powershell
python -B deployments/microsoft-email/build_flow.py --output .netlify/microsoft-alerts-setup/email-flow-UNIQUE.zip --private-config .netlify/microsoft-alerts-setup/email-flow-private.json
```

The private JSON contains `callerObjectId`, `callbackSecret` and optionally
`outlookConnectionName`. The builder prints metadata only. Without this file it
produces a placeholder package for review, which must not be activated. Import as
a **new** flow, select Dylan's Office 365 Outlook connection, then inspect the
saved definition. Tenant import and the connector's actual parameter mapping are
acceptance gates; generating a zip does not establish a working flow. Delete or
secure private substituted packages when they are no longer needed.

The saved flow must retain concurrency one, an asynchronous Response and these
actions: Claim, conditional Send once, accepted/uncertain Receipt. **Claim retries
and Send retries must both be None.** Receipt retries are safe and bounded. The
shared-mailbox action is `SharedMailboxSendEmailV2`, with MailboxAddress, To,
Subject and Body from the successful claim response. It must never send from the
trigger body or on `allowSend:false`. Do not copy a successful Claim action's
outputs into a separate manual send flow.

## Exact wire contract

Backend → OAuth-authenticated flow:

```json
{"schemaVersion":1,"kind":"issue","jobId":"64-lowercase-hex-outbox-id"}
```

`kind` is `issue` or `workout`. Workout IDs are 64 lowercase hex followed by
`_terminal` or `_inactivity`. The backend treats HTTP 200/202 only as a flow
wake-up; it never records that response as email acceptance.

Flow → `https://us-central1-kickai-69dd0.cloudfunctions.net/claimMicrosoftEmail`:

```json
{"schemaVersion":1,"kind":"issue","jobId":"...","runId":"workflow-run-name"}
```

Both callbacks require the secret header and `Content-Type: application/json`.
The claim either returns `{schemaVersion:1,allowSend:false}` (possibly
`deferred:true`), or returns `allowSend:true` with `kind`, `jobId`, `runId`,
`claimToken`, `correlation`, `fromMailbox`, semicolon-separated `to`, `subject`
and `html`. Only the latter authorizes one send.

Flow → `https://us-central1-kickai-69dd0.cloudfunctions.net/receiptMicrosoftEmail`:

```json
{"schemaVersion":1,"kind":"issue","jobId":"...","runId":"workflow-run-name","claimToken":"returned-64-hex-token","outcome":"accepted"}
```

Use `accepted` only after the Outlook action succeeds; use `uncertain` if it
fails or times out. Do not send raw connector errors, recipient outcomes or a
`delivered` status. The response is `{schemaVersion:1,recorded:true}` with optional
`duplicate:true`. Duplicate receipts are harmless; different claim/run identities
are rejected.

## Durable behavior and limits

The first attempted route is frozen as `deliveryProvider`. Existing attempted
Resend jobs, including those without this new field, keep their original provider,
payload, key and 23-hour retry window. Resend callbacks explicitly ignore Microsoft
jobs; retain the old verified Resend callback endpoint while any old receipt may
arrive. Never reroute an uncertain old attempt to Microsoft.

A Microsoft claim consumes send permission transactionally **before** revealing
the message. Repeating even the same run cannot obtain permission again. A lost
claim response or a crash before the Outlook action can therefore leave an unsent
message requiring review; this is the intentional duplicate-avoidance tradeoff.
The scheduler does not blindly send it again. Unclaimed Microsoft wake-ups may
retry indefinitely with the frozen payload; they do not inherit Resend's 23-hour
idempotency expiry. Workflow retries are safe only because the backend refuses
all repeated claims.

All Microsoft email types share a limit of **20 claims per rolling five minutes**.
They also share **9,000 recipients per rolling 24 hours**: a three-recipient issue
message consumes three units; a workout message consumes one. Fifteen-minute
buckets include the complete partially overlapping boundary bucket, so a job can
wait up to fifteen extra minutes rather than exceed the rolling limit. This is
not a midnight reset. Claims consume quota even if the subsequent send outcome is
uncertain, and repeated denied claims consume none. Excess jobs remain pending
and unclaimed; no alert is discarded by either budget. Keep the durable send
budget across pauses and activation; do not delete it to bypass limits. The
9,000 allowance is below Exchange's
[10,000-recipient daily mailbox limit](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits#sending-limits)
but cannot reserve quota consumed by sends outside this application.
The two original sweep queues are bounded, so a burst can wait longer than one
interval. Microsoft trace considers at most 40 due jobs from each outbox per
five-minute invocation. A persisted rolling budget permits 80 trace API requests
per five minutes and the worker stops within its bounded execution deadline.
These limits do not reserve Microsoft quota from other tenant applications.
Monitor due-job age and the reconciliation state; queue persistence is not a
promise of immediate processing during persistent tenant/provider failures.

The subject starts with an exact `[PTM-<32hex>]` token and the body includes the
same reference. Reconciliation directly calls Microsoft's
[message trace API](https://learn.microsoft.com/en-us/graph/api/messagetracingroot-list-messagetraces?view=graph-rest-1.0),
with bounded UTC receipt times, sender and correlation. It exhausts bounded
pagination before applying evidence, validates next links, and additionally
requires the exact complete subject, approved frozen recipient and one unique
Internet message ID. Conflicting evidence requires review. Missing trace data
is never interpreted as failed delivery or permission to resend.

Each recipient is recorded independently. Flow success means accepted; aggregate
Delivered requires trace delivery for every frozen recipient. Quarantine/spam
filtering stays distinct in the stored trace status and maps to suppressed; an
unknown/expanded status requires review. Trace evidence is checked for seven days
after claim. Missing acknowledgement becomes reviewable after ten minutes but can
still be resolved by later matching trace evidence. Exhausted evidence windows
remain reviewable, never silently resent.

`receivedDateTime` is when Exchange received the message, **not** delivery time.
Recipient `exchangeReceivedAtMillis`, `observedAtMillis` and job
`deliveryObservedAtMillis` remain separate. No `deliveredAtMillis` is invented.
Delivery does not establish Inbox placement or that anyone read the email.

## Settings, private storage and deployment

The server-only `microsoftEmailSettings/current` is absent/disabled by default:

```json
{
  "enabled": false,
  "connectionVerified": false,
  "traceEnabled": false,
  "senderMailbox": "alerts@posetek.net",
  "activatedAtMillis": 0
}
```

Before the isolated pilot, use a positive nonfuture cutoff and a nonempty
`testJobIds` allowlist of `issue:<id>` / `workout:<id>`. An empty allowlist fails
closed. A deliberately frozen Microsoft setup-test job can exercise the shared
transport while both normal domain routes remain Resend; no incident or athlete
record is required. Label that private job and message as setup-only, keep its
exact provider/claim evidence, and do not treat it as a real user issue.
For production activation, the corresponding `userIssueSettings/current` and
`workoutNotificationSettings/current` select `emailProvider:"microsoft"` while
retaining existing intake/send gates. Selecting Microsoft while its gate is
disabled holds new jobs; it never falls back to Resend. Existing attempted Resend
jobs ignore this route setting. Eligibility also checks the existing domain pilot
and cutoff. Do not casually advance existing collection cutoffs during migration.

The server-only `microsoftEmailState` contains rolling send/trace budgets and the
reconciliation lease/health record. Existing private outboxes hold frozen
payloads, claim-token hashes, flow receipts, recipient evidence and trace due
times. No automatic purge is added. Verify deployed rules deny direct clients,
including administrators, access to the two new roots. Canonical rules remain
owned by the mobile repository; this package deploys no rules or indexes.

`enabled:false` stops new Microsoft send claims. `traceEnabled:true` can remain
set to reconcile late evidence while sending is paused. An already returned
permission/in-flight send cannot be recalled. Never clear `claimedAtMillis`,
claim-token hashes, provider selection or delivered evidence to recover a job.

The new `microsoft-email` codebase exports exactly three functions:

| Function | Trigger |
| --- | --- |
| `claimMicrosoftEmail` | Authenticated POST handler, 60 seconds |
| `receiptMicrosoftEmail` | Authenticated POST handler, 60 seconds |
| `reconcileMicrosoftEmail` | Every five minutes, 300 seconds |

Prepare and audit using the existing isolated source/IAM/rollback workflow:

```powershell
python -B deployments/microsoft-email/prepare.py --mode prepare --run-dir .netlify/microsoft-email/RELEASE --credential-file .netlify/microsoft-email/owner-session.json
npm --prefix .netlify/microsoft-email/RELEASE/source ci --ignore-scripts --no-audit --no-fund
firebase deploy --project kickai-69dd0 --config .netlify/microsoft-email/RELEASE/firebase.json --only functions:microsoft-email --non-interactive --force
python -B deployments/microsoft-email/prepare.py --mode verify --run-dir .netlify/microsoft-email/RELEASE --credential-file .netlify/microsoft-email/owner-session.json
```

Separately prepare/audit the existing workout **delivery** and user-issues scopes
with the added secret bindings. Deploy the backward-compatible workout webhook
scope before activation so it rejects Microsoft-tagged jobs. The workout intake
scope is needed only if exposing the optional provider/observed-delivery metadata
through its callable. Do not deploy the whole functions index. Preserve source,
IAM and scheduler inventory outside these reviewed scopes.

## Acceptance before activation

Run the combined unit tests and actual loopback SDK suite:

```powershell
node --test functions/microsoft-email.test.js functions/user-issues.test.js functions/workout-notifications.test.js
# Start disposable Firestore emulator at 127.0.0.1:8193, demo-microsoft-email only.
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8193'
$env:GCLOUD_PROJECT='demo-microsoft-email'
node --test functions/microsoft-email.emulator.cjs
```

Then verify in the actual tenant: Premium entitlement accepted; shared mailbox
Full Access/Send As; caller identity allowlist; secure action settings; no retries
on Claim or Send; correct async response; callbacks reject wrong secrets and run
tokens; exact duplicate wake-ups yield one send; lost callback leaves reviewable
state; all approved pilot recipients receive their intended message; each trace
settles separately; pagination and mailbox trace access work; old Resend jobs
remain unchanged; scheduled reconciliation executes with correct secret versions.
Use only isolated fixtures and retain metadata evidence without private payloads.

Record the rollout and only then remove the pilot allowlist for future approved
jobs. Failed/expired historical Resend messages require a separately reviewed
recovery decision; changing providers is not authorization to replay them.
