# Scoped app feedback release

This website repository owns the feedback function source and release package.
`deployments/app-feedback/index.js` exports only `receiveAppFeedback` (plain HTTPS,
credential-free public form) and `getAppFeedback` (authenticated PoseTek-admin
read-only callable).
Source lives in `functions/app-feedback.js`. No account records or legacy feedback
are read/written by the public receiver.

The two scoped functions are deployed and exact source/configuration/IAM checks
passed. The three TTL policies are ACTIVE and session-count indexes are READY.
Canonical client-denial rules are published, with source tracked in
[draft mobile PR #35](https://github.com/posetek/posetek-mobile-app/pull/35).
Website `6ac17bc21377cbeaea114800` is verified live, published October 3, 2026 at
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
repository. Public `/feedback` remains credential-free; `/admin/feedback` reads
through the existing verified PoseTek-admin callable. Read
[the complete handoff](../../docs/APP_FEEDBACK.md) and
[the production receipt](../../deployment/APP_FEEDBACK_PRODUCTION.json).
