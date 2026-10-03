# Optional PoseTek app feedback

Use this handoff for behavior and recovery, [the scoped release guide](../deployments/app-feedback/README.md)
for backend delivery, and [the production receipt](../deployment/APP_FEEDBACK_PRODUCTION.json)
for exact published artifacts and acceptance evidence. The exact reviewed
website candidate `6ac17bc21377cbeaea114800` is verified live, published October 3,
2026 at 3:12:14 PM PDT (`2026-10-03T22:12:14.725Z`). Production promotion and
integrity checks are recorded in the receipt.

The website offers feedback after meaningful use. An invitation appears on
return to Training only after a completed workout save is acknowledged, with
some prescribed work recorded. Assigned and personal workouts use the same
trigger. Pain stops, early endings, failed saves, changed accounts, hidden tabs
and previews do not invite. No feedback action changes workout data or results.

The optional card says **Help us improve PoseTek — three quick questions.**
**Give feedback** opens a new document; **Not now** dismisses it. A single
browser timestamp limits automatic invitations to once every seven days. No
account identifier is stored in that timestamp or sent with feedback. Blocked
browser storage suppresses automatic invitations. Clearing storage or changing
browsers can reset the cadence. Available Web Locks serialize competing tabs.

Players with visible results retain a **Give feedback** link, independently of
the cooldown. Verified PoseTek admins can download the QR code from `/admin/feedback` for use after
a testing session or results review. Existing coach/parent communication can
share `https://posetek.net/feedback?source=message`. Sharing is manual; this release
sends no invitations through email or messaging services.

## Public form

`/feedback` is an isolated Astro document with one React island. It imports no
Firebase authentication, account data, application router, analytics or session
replay. Invitations use ordinary full-page anchors with no referrer. The form
uses local styles/system fonts and requires no login or name.

The three agreed questions and answer labels are preserved in
`app/src/pages/feedback/FeedbackPage.tsx`. Each question can be skipped and
revisited. The final comment is optional, capped at 1,000 characters. Choosing
**Haven’t used it yet** bypasses ratings and offers an explicit send. Skipping
everything ends without sending an empty response. PoseTek reads answers to
improve the application; the form discourages names and contact details.

Sending confirms success only after an acknowledgement. A failed/timed-out send
keeps the original answers and exact request for retry. It freezes that attempt
to prevent changing a response that may already have arrived. Page refresh
creates a new form session; answers are deliberately not stored on the device.
`?preview=1` allows a labeled sample form with no production requests.

## Data and interfaces

Public endpoint: `POST https://us-central1-kickai-69dd0.cloudfunctions.net/receiveAppFeedback`.
It receives JSON using `credentials: omit` and `referrerPolicy: no-referrer`.
An allowlist accepts only `formVersion: 1`, `event`, a per-opening random UUID,
`entrySource`, optional versioned answers and bounded `durationSeconds`.
Sources are `workout`, `results`, `qr`, `message` or `direct`. No account, player,
team, workout, full URL or authentication token is included.

`opened`, `started` and `submitted` events are idempotent, may arrive out of order
and record only actual received transitions. Telemetry failures never prevent
answers being sent. One UUID creates at most one response; an exact submission
retry returns success, while changed content under that UUID returns HTTP 409.
All optional answers can be null. The real UI does not submit a wholly empty
response; the endpoint accepts bounded optional answer payloads from other clients.

Separate collections:

| Collection | Purpose | Default expiry |
|---|---|---|
| `appFeedbackResponsesV1` | Versioned answers, source, comment, server times and optional duration | 90 days after submission |
| `appFeedbackSessionsV1` | Actual open/start/submission flags and times for one form opening | 90 days after first accepted event |
| `appFeedbackRateLimitsV1` | Separate secret-keyed, time-window network counter | 30 minutes after window start |

The network counter allows 60 new form sessions per 15-minute window, so a shared
testing-session network can support the pilot. Accepted transitions/retries do
not consume new-session quota. Raw addresses are neither stored with responses
nor logged by feedback code. Cloud/hosting providers still process ordinary
network request logs; the privacy policy distinguishes these from feedback.

Firestore TTL policies on `expiresAt` are active. Physical expiry deletion is
asynchronous; admin review and counts filter out the expired 90-day window.
The three session flag/date composite indexes are READY. `storage.py` adds only
these indexes and TTL settings, without replacing existing database configuration.

The canonical mobile repository owns rules. All three collections have explicit
recursive client denials; the live rule set has no permissive unknown-collection
fallback. Even admins cannot read them directly from client SDKs. The read-only
`getAppFeedback` callable enforces the existing verified, nonanonymous PoseTek
admin predicate. It returns the newest 50 responses, a stable cursor and actual
90-day form-session counts. Counts are never presented as unique players.
Opened means the form appeared; started means someone interacted with a question
or optional comment, including skipping; submitted means the response was saved.
The read-only view shows source, answer labels, optional comment, server date and
duration when supplied, plus submitted/opened and submitted/started rates.
Its share panel creates the QR image locally and offers an SVG download and
manual copy fallback; it sends no messages to recipient accounts.
The legacy `userFeedback` collection and issue-reporting workflow are separate.

## Release and recovery

The implementation merges teammate commit `41fa4fc`, preserving the already-live
October 3 issue-coverage application and its history. Backend deployment uses
the isolated `app-feedback` codebase containing only two functions. Exact source,
configuration, transport, IAM and unrelated function inventory were verified.
Canonical rules were published through `firebase/operations.py` after fresh live
drift and identity checks. Storage rule bytes and training data remain unchanged.
The website owns feedback function source and its isolated release package;
`PoseTek-mobile-app/firebase/` owns rule source and publishing. The published
client-denial change is tracked in [draft mobile PR #35](https://github.com/posetek/posetek-mobile-app/pull/35).
Publishing those rules does not release native invitation UI.

Production `6ac17bc21377cbeaea114800` matches the exact reviewed draft: the full
provider inventory has 1,538 records and the artifact has 1,537 files. The release
preserves the prior marketing and unrelated application/public records and adds
52 assets plus the isolated feedback entry. The application SHA1 is
`b9fe37549537848de13fcbe85cafd11a8097a445`; feedback is
`7e31700f6b0339e287b05399416c21ed99b8f8a9`. The receipt and reconciled
`deployment/homepage-baseline.json` define the current verification boundary;
the preceding issue-coverage deployment and its 1,482-file baseline remain
historical evidence without changing notification behavior.

Build with the supported Node runtime and a verified current marketing snapshot:

```powershell
node scripts/build-application-release.mjs --preserve-marketing .netlify/approved-marketing/manifest.json
node scripts/serve-astro-preview.mjs
node scripts/verify-app-feedback.mjs --base http://127.0.0.1:4175 --public-only
```

Use `netlify deploy --no-build --dir production-dist --site b1ccf990-286c-4367-bb67-ca0d9ea2a020`
to prepare a draft for review. Release `6ac17bc21377cbeaea114800` promoted its
exact reviewed candidate without rebuilding after final integrity checks passed.
Follow that same draft-review workflow and record the actual result in
[the production receipt](../deployment/APP_FEEDBACK_PRODUCTION.json).
Retain approved Players/Coaches bytes and all protected application/public files.
Do not use a default site link or publish unrelated rules/functions. The release
receipt records the actual candidate, production, hashes and verified limits.

To stop website invitations, restore the prior verified website deployment.
The separate endpoint/records can remain available for shared-link responses.
If the feedback service must be withdrawn, disable its two scoped functions
without touching existing issue, training, gateway or legacy feedback services.
Do not relax client rules to work around admin access errors.

## Validation and remaining pilot

1,469 application tests passed after source reconciliation, plus 11 backend
tests, 38 release/baseline/preview tests, 120 website rules assertions, 1,130 canonical SDK
tests and 34 canonical publisher tests. Synthetic browser review covers
320/390/820/1440px, keyboard controls, exact retry bodies, skips, preview silence,
no public external font/auth/tracking traffic and locally generated admin QR.
Hosted candidate `6ac17bc21377cbeaea114800` passed 20 browser checks with nine
screenshots and zero feedback writes. This verifies synthetic behavior and
responsive delivery; it does not complete the player comprehension pilot.
Live synthetic HTTPS acceptance confirmed idempotency, identifier rejection,
separate records, 90-day expiry and signed-out admin denial. Synthetic response
and session records were removed after verification.

The **12-player comprehension review across the three previously agreed age
bands remains outstanding**. Use [the pending pilot worksheet](APP_FEEDBACK_PILOT.md).
No participant review or child consent is invented.
The numeric age-band boundaries were not present in the implementation request.
Recruit through existing approved coach/parent channels and record four players
per agreed band. Check whether each child understands all questions, can skip
and exit unaided, and recognizes that results/progress do not depend on feedback.
Record completion times without names or account identifiers. The 30–60-second
target and seven-day cadence are pilot defaults, not validated outcomes.
Native invitations require a separate mobile release. Existing 80-drill mobile
acceptance/content gates remain held; this feature grants no training clearance.
