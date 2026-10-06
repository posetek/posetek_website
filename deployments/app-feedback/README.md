# Scoped app feedback release

This website repository owns the feedback function source and release package.
`deployments/app-feedback/index.js` exports only `receiveAppFeedback` (plain HTTPS,
anonymous or token-authenticated account form) and `getAppFeedback` (authenticated PoseTek-admin
read-only callable).
Source lives in `functions/app-feedback.js`. The receiver reads Firebase Auth
for a submitted account author; it does not modify account/player records or
read/write legacy feedback.

The prospective October 5 contract keeps anonymous v1 responses unchanged and
adds v2 `identityMode`. Anonymous requests carry no auth; account submissions
carry a bearer token only, with no client author/UID/name/email fields. The
receiver verifies the token and reads the Auth account for an immutable response
author snapshot. V2 workout/results submissions require account mode; signed-out
QR/message/direct visitors may remain anonymous. Sessions/counts store no author
or account identifiers. The updated form's prominent notice precedes questions,
with no extra consent checkbox. See [the attribution receipt](../../deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json)
for exact publication and validation; the old anonymous receipt does not prove
this updated contract is live.

The original two-function deployment passed exact source/configuration/IAM checks.
Updated source and deployment checks belong in the attribution receipt. The
three TTL policies are ACTIVE and session-count indexes are READY.
Canonical client-denial rules are published, with source tracked in
[draft mobile PR #35](https://github.com/posetek/posetek-mobile-app/pull/35).
The historical anonymous website `6ac17bc21377cbeaea114800` was published October 3, 2026 at
3:12:14 PM PDT. Its exact candidate passed 20 hosted browser checks with nine
screenshots and zero feedback writes before promotion; full production inventory
and artifact verification passed. Publication and exact integrity results are in
[the production receipt](../../deployment/APP_FEEDBACK_PRODUCTION.json).
The [12-player pilot and native invitation release](../../docs/APP_FEEDBACK.md#validation-and-remaining-pilot)
remain separate outstanding work.

Prepare an immutable scope using the existing authorized operator session, held
in an ignored credential file; no token belongs in source or terminal output:

```powershell
python deployments/app-feedback/prepare.py --mode prepare --run-dir .netlify/feedback-release --credential-file .netlify/owner.json
npm --prefix .netlify/feedback-release/source ci --ignore-scripts
firebase deploy --only functions:app-feedback --config .netlify/feedback-release/firebase.json --project kickai-69dd0 --non-interactive
python deployments/app-feedback/prepare.py --mode verify --run-dir .netlify/feedback-release --credential-file .netlify/owner.json
```

Create/bind `APP_FEEDBACK_RATE_KEY` via Secret Manager with a cryptographically
random value of at least 32 characters. Only the receiver binds this secret. Do
not deploy the central functions entry or change existing codebases. A slow local
source discovery can use `FUNCTIONS_DISCOVERY_TIMEOUT=60`; this does not change
the deployed 30-second function timeout.

`storage.py --credential-file ... --apply --output .netlify/feedback-storage.json`
adds three session-count indexes and `expiresAt` TTL policies on the three new
collections. Rerun without `--apply` and confirm indexes READY / TTL ACTIVE. The
90-day response/session and 30-minute counter lifetimes come from server code.

Rules are owned/published only by the canonical mobile repository. Website
`app/rules-tests/appFeedback.emulator.mjs` verifies denied direct client access
against `RULES_PATH`; no rule files are copied into this website repository.
Publish rules only with `python firebase/operations.py publish` from that
repository. Public `/feedback` supports the disclosed account/anonymous modes;
`/admin/feedback` reads through the existing verified PoseTek-admin callable and
shows an account snapshot only for v2 account responses. It never joins or
infers an anonymous author. Read
[the complete handoff](../../docs/APP_FEEDBACK.md) and
[the attribution receipt](../../deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json)
and [the historical anonymous receipt](../../deployment/APP_FEEDBACK_PRODUCTION.json).

## Verified account or privacy deletion

The email-based account/privacy deletion operation must also remove attributed
feedback within the policy's 30 days. Obtain the exact UID through that verified
request; never infer it from an anonymous response, a name, email or network log.
This operator step is separate from deleting the account itself and is not an
automatic Auth-deletion hook. The 90-day feedback TTL does not replace it.

With an authorized owner OAuth credential inside ignored `.netlify`, first
preview using a fresh private run directory:

```powershell
python deployments/app-feedback/erase.py --uid "EXACT_VERIFIED_UID" --credential-file .netlify/owner.json --run-dir .netlify/feedback-erasure/preview-1
```

After reviewing the matching counts, apply with a different fresh directory:

```powershell
python deployments/app-feedback/erase.py --uid "EXACT_VERIFIED_UID" --credential-file .netlify/owner.json --run-dir .netlify/feedback-erasure/apply-1 --apply
```

Preview again in another fresh directory to confirm zero remaining matches.
The tool selects only v2 account responses matching `author.uid`, reads only
eligibility fields, and atomically deletes each response and its exact-UUID
session with revision guards. V1, anonymous v2, player/Auth records and network
counters are preserved. No rule, function or index deployment is needed.
Outputs and `erasure.json` contain counts only; no author, answer, UID, credential
or document path is included. On an error or lost acknowledgement, retain the
incomplete receipt, preview again, then retry the same verified UID. The tool
does not report an unacknowledged commit as a confirmed deletion.

Synthetic checks: `python -m unittest discover -s deployments/app-feedback -p test_erase.py`.
