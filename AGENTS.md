# PoseTek website context

## Current planner preview context guard release — November 1, 2026

Exact deployment `6ae7cb8d2a05c4dbbbd9b7e5` is live. **Preview priorities** now
requires the same completed training context as generation, with visible guidance
when schedule or equipment confirmation is missing. Candidate and production
signed-in synthetic assessments completed; no real player profile or plan changed.

All 2,436 artifact files match 2,437 provider records. The reconciled baseline
protects 2,434 files and passes the ordinary preservation build. Only the existing
application entry changed; seven runtime assets were added. Marketing, feedback,
coach enrollment and prior accepted results remain preserved. Read [the release
handoff](docs/releases/PLANNER_PREVIEW_CONTEXT_GUARD.md) and [production receipt](docs/releases/receipts/PLANNER_PREVIEW_CONTEXT_GUARD_PRODUCTION.json) for exact scope and limits.

Runtime `f4ce1a8` extends approved `757cf1b`; it is separate from source main.
Held policy, session and Ball Striking candidates remain excluded. Keep
`[skip netlify]` on source/receipt integration. No backend, rules, indexes,
gateway, catalog or native release is included. Earlier sections are historical.

## Preserved web AI-sharing recovery release — October 24, 2026

Exact reviewed deployment `6adc6d7bf370755a2aabc65b` was published October 24.
Its preserved behavior lets players review
AI sharing from Coach, personal Workouts and their own Profile, explicitly allow
or decline, and retry a blocked AI request after allowing sharing. Opening the
control never saves consent or starts generation. No real account choice was
changed during release verification.

All 2,292 artifact files match the provider inventory (2,293 records including
routing metadata). The reconciled baseline protects 2,290 files. Marketing,
feedback, coach enrollment and historical assets remain exact. Runtime `bb3274c` contains approved `499dc815` plus this fix; held
policy, session and Ball Striking candidates remain excluded. Keep runtime
branches separate and retain `[skip netlify]` on source and receipt integration.

For consent behavior, release verification or the next application release, read
[the handoff](docs/releases/WEB_AI_SHARING_RECOVERY.md) and
[the production receipt](docs/releases/receipts/WEB_AI_SHARING_PRODUCTION.json).
No backend, rules, indexes, gateway, catalog or native release is included.
Earlier sections remain historical checkpoints of preserved behavior.

Earlier release-by-release notes (October 3–22, 2026 and before) live in
[docs/releases/HISTORY.md](docs/releases/HISTORY.md); receipts are in `docs/releases/receipts/`
and handoffs in `docs/releases/`. Use the latest applicable handoff, and treat
older checkpoints as records of their releases.

## Current backend ownership — migration branch

Shared Firebase/runtime source moved to `posetek/posetek-backend`. Read
[docs/features/BACKEND_MIGRATION.md](docs/features/BACKEND_MIGRATION.md) and use the exact
`backend-source.json` pin. This current ownership note supersedes historical
Mobile rules/Web Functions paths below. Production behavior is unchanged;
Backend publication remains held until release qualification. Client application,
site/native delivery and historical production evidence stay in this repository.



For the staged engineering pipeline, start at
`docs/engineering/README.md`, then read `WORKFLOW.md` and the approved plan in
that directory. The pipeline remains separate from the current production
release below until staged integration and hosted verification. Current policy
allows authors to merge their own PRs after passing CI and a completed
latest-revision advisory AI review; private protection and paid reviewer
activation remain pending. Preserve the published release records and use
isolated worktrees.


Read `POSETEK_PROJECT_CONTEXT.md` before working on this website. It records the
source version, project background, key files, release workflow, and review results.

`README.md` contains fresh-clone setup, preview, validation, and collaboration steps.

The shared website repository is `https://github.com/dk242/posetek_website.git`.
The user requires website changes to be committed here and the repository updated
for collaborators. Preserve teammates' commits, include required source and assets,
and update the handoff docs with confirmed project decisions. Keep generated output,
local reference captures, dependencies, and credentials out of Git.

## Agent gateway

**The agent-gateway lives only in `python-video-processor/Services/agent-gateway`.**
This repository's `services/agent-gateway/` copy was retired and deleted; do not
re-add it, and do not edit or deploy a gateway from here. Gateway changes go to
that repository.

**The gateway is released only through
`python-video-processor/Services/agent-gateway/scripts/release.sh`, from a pushed
commit on its `main`.** No `gcloud run deploy --source`, no `git archive` of a
website directory, no branch or dirty-tree deploys. `scripts/release-training-expansion.cjs`,
which deployed `git archive HEAD:services/agent-gateway` to Cloud Run, was deleted
with the copy; a website script or doc that deploys the gateway is a defect.

The website's half of the contract — the capabilities it calls, the server-written
public projection, and the delivery/recovery guarantees — is in
`docs/features/PERSONALIZED_PLANNER_WEB_CONTRACT.md`. Gateway revision names in the release
notes below and in `deployment/*.json` are historical records of what was serving
at the time, not instructions or a current source pointer.

## Firebase rules

**Firestore and Storage rules live only in `PoseTek-mobile-app/firebase/`**
(`firestore.rules`, `storage.rules`). They are published only by
`python firebase/operations.py publish` in that repo, and never from here.
This repository has no rules files, and `firebase.json` carries Firestore
*indexes* only, so no form of `firebase deploy` from this checkout can publish
rules. Do not re-add a `rules` key to `firebase.json` or to any other config here,
and do not add a rules file. A rules change is a change to the mobile repo.

The suites in `app/rules-tests/` test the canonical files. Run them with
`node scripts/run-rules-tests.mjs` (see `app/rules-tests/README.md`). They
default to a sibling `../PoseTek-mobile-app` checkout, and `RULES_PATH` /
`STORAGE_RULES_PATH` override that. Rules, receipts and releases in
`deployment/*.json`, including the composed `whole-body-firestore.rules`
(deleted), are historical records of past publishes, not instructions.

## Build, preview and release

The feed feature stack is available in `app/src/pages/feed/` and `functions/`.
Read `docs/releases/FEED_SOURCE_HANDOFF.md` for setup, API contracts and provenance. The
frontend is recovered editable JSX; the backend is original deployed source.
Feed development uses the Vite app at `/feed?preview=1` and requires no reference
capture. Source recovery did not deploy or change the application baseline.

At the initial September 15 review, GitHub main was older than the live homepage.
The user chose the deployed site as the reference. Recovered modules have provenance
beside their code; the other computer's original authored source remains unavailable.
The unchanged deployment `6aa9b6f0d8faf6177db8fd97` remains the tabbed comparison
reference. The current application release and protected files are recorded in
`deployment/homepage-baseline.json`. On a fresh clone, run
`node scripts/capture-deployed-reference.mjs` before using either preview server.
The ignored capture lives in `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/`.

Run `npm --prefix app run build:marketing` and
`node scripts/serve-homepage-preview.mjs` to review current source at port 4174.
Run `node scripts/serve-deployed-reference.mjs` for the unchanged reference at
port 4173. The ordinary production build preserves every application/public file
recorded in `deployment/homepage-baseline.json` byte-for-byte,
including `/application.html` and its navigation bridge. Keep the live-application
guard enforced and verify the baseline again before another release.

Deliberate full-site application releases use `node scripts/build-astro-release.mjs`.
`--preserve-marketing <manifest-path>` retains freshly verified Players/Coaches
documents while updating the application and isolated feedback entries; their
runtime assets must already be in the protected baseline.
`build-application-release.mjs` delegates to that build by default; its historical
`--marketing-snapshot` mode retains verified marketing bytes for compatible older
releases. Follow the web handoff
for preparation, preview, verification and baseline reconciliation; keep local
snapshots and generated output outside Git.

Not-yet-ported legacy pages and their scripts live in `legacy/` (see its README); served URLs are unchanged.

Homepage work primarily belongs in `app/src/pages/home/`; Coaches source is in
`app/src/pages/coaches/`. Astro document entries live in `app/astro/pages/` with
shared metadata in `app/astro/layouts/Document.astro`. Root `index.html` and
`coaches/index.html` remain Vite compatibility entries. Both public audiences
share `MarketingHeader.tsx`.
Use the latest applicable release notes,
preserve existing routes and data contracts, and treat mobile source as reference-only.

Update the context guide as the source discrepancy is resolved and new project
decisions are confirmed. Do not infer current offers or production behavior from
older experiment pages or historical test receipts. Preserve historical receipts
as records of their releases.
