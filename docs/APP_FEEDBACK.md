# Optional PoseTek app feedback

Use this handoff for behavior and recovery, [the scoped release guide](../deployments/app-feedback/README.md)
for backend delivery, and [the attribution release receipt](../deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json)
for publication and acceptance of the prospective account-attribution change.
The [original anonymous release receipt](../deployment/APP_FEEDBACK_PRODUCTION.json)
is historical evidence: `6ac17bc21377cbeaea114800` was published October 3, 2026
at 3:12:14 PM PDT (`2026-10-03T22:12:14.725Z`). Its anonymity promises still apply
to responses collected through that earlier form.

The October 5 update links new signed-in submissions to the submitting account
after clear disclosure before the questions. It adds no consent checkbox and
does not infer identities for earlier anonymous responses. Publication of the
updated contract must be established by the attribution receipt, not the earlier
deployment badge. The user's statement that current players are above 13 is a
scope statement, not a recorded DOB or proof of parental consent; existing
under-13 protections and limits on public profiles remain unchanged.

The website offers feedback after meaningful use. An invitation appears on
return to Training only after a completed workout save is acknowledged, with
some prescribed work recorded. Assigned and personal workouts use the same
trigger. Pain stops, early endings, failed saves, changed accounts, hidden tabs
and previews do not invite. No feedback action changes workout data or results.

The optional card says **Help us improve PoseTek — three quick questions.**
**Give feedback** opens a new document; **Not now** dismisses it. A single
browser timestamp limits automatic invitations to once every seven days. No
account identifier is stored in that timestamp, and it is not sent with feedback. Blocked
browser storage suppresses automatic invitations. Clearing storage or changing
browsers can reset the cadence. Available Web Locks serialize competing tabs.

Players with visible results retain a **Give feedback** link, independently of
the cooldown. Verified PoseTek admins can download the QR code from `/admin/feedback` for use after
a testing session or results review. Existing coach/parent communication can
share `https://posetek.net/feedback?source=message`. Sharing is manual; this release
sends no invitations through email or messaging services.

## Public form

`/feedback` is an isolated Astro document with one React island. The updated
form loads only the isolated Firebase Auth integration needed to resolve its
submission mode and obtain a token. It does not import the application router,
issue-reporting client, analytics or session replay. Invitations use ordinary
full-page anchors with no referrer and local styles/system fonts.

The notice appears before the questions: while signed in, PoseTek administrators
can see the submitting account's name, email when available and account ID with
the response. Workout/results invitations require an account; a signed-out
visitor follows sign-in before answering. Signed-out QR, message and direct-link
visitors can submit anonymously without logging in or giving a name. Giving
feedback remains optional and never gates results or saved progress.

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
An allowlist accepts `formVersion: 2`, `identityMode: account | anonymous`,
`event`, a per-opening random UUID, `entrySource`, optional versioned answers and
bounded `durationSeconds`. Sources are `workout`, `results`, `qr`, `message` or
`direct`. Clients do not supply an author, UID, name, email, player/team/workout
identifier or full URL in JSON. Anonymous requests send no auth header. An
account submission sends its Firebase ID token only in the Authorization bearer
header; the server verifies it and reads the Auth account to create the author
snapshot. Only submitted v2 workout/results events require account mode.

The receiver also accepts the earlier v1 contract to preserve already-open
anonymous forms. Every v1 response remains anonymous, even if other supplied or
stored fields could suggest an identity. No logs or player records are correlated
to infer an anonymous submitter.

`opened`, `started` and `submitted` events are idempotent, may arrive out of order
and record only actual received transitions. Telemetry failures never prevent
answers being sent. One UUID creates at most one response; an exact submission
retry returns success, while changed content, submission mode or account under
that UUID is rejected. The first saved response's author snapshot is immutable;
a retry does not replace it with a renamed account or a different submitter.
All optional answers can be null. The real UI does not submit a wholly empty
response; the endpoint accepts bounded optional answer payloads from other clients.

Separate collections:

| Collection | Purpose | Default expiry |
|---|---|---|
| `appFeedbackResponsesV1` | Versioned answers, mode, source, comment, server times, optional duration and v2 account author when applicable | 90 days after submission |
| `appFeedbackSessionsV1` | Actual open/start/submission flags, mode and times for one form opening; no UID/name/email/author | 90 days after first accepted event |
| `appFeedbackRateLimitsV1` | Separate secret-keyed, time-window network counter | 30 minutes after window start |

Sessions and responses share the random deduplication UUID. A privileged backend
operator can therefore relate a submitted session to its attributed response.
Diagnostic records themselves contain no account or author fields, and the
participation report counts form sessions. These records are not described as
anonymous or impossible to link.

The network counter allows 60 new form sessions per 15-minute window, so a shared
testing-session network can support the pilot. Accepted transitions/retries do
not consume new-session quota. Raw addresses are neither stored with responses
nor logged by feedback code. Cloud/hosting providers still process ordinary
network request logs; the privacy policy distinguishes these from feedback.

Firestore TTL policies on `expiresAt` are active. Physical expiry deletion is
asynchronous; admin review and counts filter out the expired 90-day window.
The three session flag/date composite indexes are READY. `storage.py` adds only
these indexes and TTL settings, without replacing existing database configuration.

Verified account or privacy-deletion requests must also remove that account's
attributed feedback within the privacy policy's 30-day account-deletion period.
The privileged operator tool `deployments/app-feedback/erase.py` queries only
the exact verified `author.uid` and checks `formVersion: 2` and
`identityMode: account`. It reads no answers, names or emails and deletes each
matching response and its same-UUID session together. V1 and anonymous v2
records remain unchanged; names, emails and logs are never used to identify them.
The tool previews by default and requires `--apply` for deletion. Use a fresh
ignored `.netlify` run directory for each count-only receipt. Follow
[the scoped guide's preview/apply commands](../deployments/app-feedback/README.md#verified-account-or-privacy-deletion)
and preview again to check that no matching responses remain. Interrupted or
unacknowledged commits require a fresh preview and retry with the same verified
UID; do not claim that an unacknowledged deletion succeeded.
The 90-day TTL does not replace an earlier verified deletion request. This
package has no automatic Auth-deletion hook: the existing email-based deletion
process must include this operator step. No player or Auth record is deleted
by the tool, and it deploys no functions, rules or indexes.

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
**Submitted by** shows **Signed-in account** for v2 account responses, using
account name, email or the exact UID as a fallback. Optional name/email are
bounded, rendered as text, and email verification is labeled accurately. An
Auth account is not a verified real-world person. UID is plain selectable text,
not an inferred player-profile link. Historical v1 and future anonymous v2 rows
are explicitly **Anonymous** and show no account association.
Its share panel creates the QR image locally and offers an SVG download and
manual copy fallback; it sends no messages to recipient accounts.
The legacy `userFeedback` collection and issue-reporting workflow are separate.

## Release and recovery

The prospective attribution change updates only the feedback receiver/reader,
isolated form/Auth integration, admin author display and privacy disclosure. It
keeps the existing collection names, direct client denials, legacy-feedback
boundary, 90-day TTL and session-wide count definitions. The October 5 privacy
text and prominent before-question notice describe the new collection; generic
older terms are not treated as authorization to identify past anonymous people.
The attribution receipt records its actual source, publication and validation.

The original implementation merged teammate commit `41fa4fc`, preserving the
October 3 issue-coverage application and its history. Backend deployment uses
the isolated `app-feedback` codebase containing only two functions. Exact source,
configuration, transport, IAM and unrelated function inventory were verified.
Canonical rules were published through `firebase/operations.py` after fresh live
drift and identity checks. Storage rule bytes and training data remain unchanged.
The website owns feedback function source and its isolated release package;
`PoseTek-mobile-app/firebase/` owns rule source and publishing. The published
client-denial change is tracked in [draft mobile PR #35](https://github.com/posetek/posetek-mobile-app/pull/35).
Publishing those rules does not release native invitation UI.

Historical production `6ac17bc21377cbeaea114800` matched the exact reviewed draft: the full
provider inventory has 1,538 records and the artifact has 1,537 files. The release
preserves the prior marketing and unrelated application/public records and adds
52 assets plus the isolated feedback entry. The application SHA1 is
`b9fe37549537848de13fcbe85cafd11a8097a445`; feedback is
`7e31700f6b0339e287b05399416c21ed99b8f8a9`. Those counts and hashes describe that
release. The attribution receipt and `deployment/homepage-baseline.json` define
the updated publication and verification boundary;
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
[the attribution release receipt](../deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json).
Retain approved Players/Coaches bytes and all protected application/public files.
Do not use a default site link or publish unrelated rules/functions. The release
receipt records the actual candidate, production, hashes and verified limits.

To stop website invitations, restore the prior verified website deployment.
The separate endpoint/records can remain available for shared-link responses.
If an attribution rollout is withdrawn, retain v2 author snapshots privately
until their expiry or an earlier verified deletion request; do not expose them
through an older anonymous UI or relabel
them as never identified. Historical v1 responses remain unlinked throughout.
If the feedback service must be withdrawn, disable its two scoped functions
without touching existing issue, training, gateway or legacy feedback services.
Do not relax client rules to work around admin access errors.

## Validation and remaining pilot

The original anonymous release passed 1,469 application tests after source
reconciliation, plus 11 backend
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
These are historical v1 checks. Attribution validation must cover mixed-version
private rendering, account-derived snapshots, anonymous no-auth behavior, clear
mode disclosure, same-account retries and protection against identity changes;
its actual results belong in the attribution receipt.

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
