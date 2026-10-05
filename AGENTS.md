# PoseTek website context

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
`docs/PERSONALIZED_PLANNER_WEB_CONTRACT.md`. Gateway revision names in the release
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

## Current hosting and marketing snapshot

The ordinary Git build published `b776c32` as `6ac3d1c930af650008d83718` on
October 5, 2026 at 9:37:14 AM PDT. Application and feedback bytes still match the
attribution release below. The reconciled baseline protects 1,697 files; all
1,638 predecessor records are unchanged. The ignored local marketing snapshot
passed the application-release builder and preserves the current Players/Coaches
HTML exactly. See [the snapshot receipt](deployment/MARKETING_SNAPSHOT_20261005.json).
No new application draft or production release was uploaded by that preparation.
Keep the reviewed-draft workflow and protected baseline enforced.

## Current feedback attribution release

The latest application-changing release is `6ac395bfba35bceed566d26c`, source `5792b63`, published
October 5, 2026 at 5:23:26 AM PDT. Read [the feedback handoff](docs/APP_FEEDBACK.md)
and [production evidence](deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json).
New signed-in feedback includes a server-verified Auth account snapshot after a
prominent notice before the questions; no consent checkbox is added. Signed-out
QR/message/direct links remain anonymous, while workout/results submissions
require sign-in. Historical/v1 responses remain anonymous and are never inferred
from accounts, player records or logs. Auth snapshots identify an account, not a
verified person; never infer a player-profile link from an Auth UID.

The isolated form loads Auth only, with no Firestore, application tracking,
analytics or replay. Only account submissions send an Authorization token;
feedback JSON/URLs carry no author/account/player/team/workout identifiers.
Sessions contain no author fields but share the deduplication UUID with responses;
privileged operators can relate them. Counts remain form-session counts.
Account/privacy deletion requests include the tested exact-UID operator erasure
step in `deployments/app-feedback/erase.py`; it is not an automatic Auth-deletion
hook. The user's over-13 statement is not recorded DOB or parental-consent proof.

The exact reviewed draft passed 27 hosted and 27 production browser checks with
zero feedback writes. Inventory matches all 1,640 artifacts and 1,641 provider
records; the reconciled guard protects 1,638 files. Only application/feedback
documents and effective feedback Auth connection permissions change among prior
records, plus 53 assets. Kai's coach Overview source/history, approved marketing,
stable P icons, training records, invitation timing and canonical client denials
are preserved. Two scoped functions are source/IAM audited; live synthetic Auth
acceptance passed and owned accounts/records were removed. TTL remains active and
indexes READY. Rules, gateway, native and catalog were not deployed.

## Coach Overview release preserved by current feedback update

The coach Overview website release was `6ac38fde67d690075984e58b`, source `7b1aa186`, published
October 5, 2026 at 4:55:11 AM PDT. Read [the release handoff](docs/COACH_OVERVIEW_RELEASE.md)
and [production evidence](deployment/COACH_OVERVIEW_PRODUCTION.json). Kai's compact
Team snapshot, persistent roster disclosure and visible reporting filters are
live. Review links preserve other filters, clear name search and match positive
snapshot counts; zero-count actions are disabled. **No workout status** can
coexist with recorded activity. Weekly performance lines cross empty weeks;
their explanation and data table retain the missing-result distinction.

Verified inventory contains 1,587 website artifacts and 1,588 provider records.
The release preserves 1,540 predecessor records, changing only the application
entry and generated provider metadata while adding 46 runtime assets. Approved
Players/Coaches documents, isolated feedback and stable icon bytes are preserved.
Reporting calculations/cohorts, access, private drafts, backend functions, rules,
gateway, native and held content are unchanged. The reconciled baseline protects
1,585 files at that release; the ordinary TypeScript/Astro preservation build passed for all of
them. Keep the guard enforced; `deployment/homepage-baseline.json` records current protected files.

## Website P icons (historical introduction)

The icon-only website release was `6ac1abf790c8c0037928b52a`, published October 3, 2026 at
6:31:53 PM PDT. Read [the icon handoff](docs/SITE_ICONS.md) and
[production evidence](deployment/SITE_ICONS_PRODUCTION.json). The approved P
appears in browser and search icon metadata. Only HTML-head icon links and four
declared icon assets changed; page bodies, runtime assets, feedback isolation and
all application contracts were preserved. That release's baseline protected 1,539 files.
Keep stable icon URLs and the byte-preserving ordinary build guard. Google
controls search recrawling; the website release does not verify search display.

## Optional app feedback

Read [the feedback handoff](docs/APP_FEEDBACK.md) and
[attribution production evidence](deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json) before changing
feedback. `/feedback` is an isolated document with a minimal Auth integration and
no replay scripts; signed-out shared links require no login. `/admin/feedback`
uses the existing verified, nonanonymous PoseTek-admin guard and private read-only
callable. Only account submissions send a token; public JSON/URLs carry no
author/account/player/team/workout identifiers. The website owns `functions/app-feedback.js`
and the isolated `deployments/app-feedback/` release scope. The canonical mobile
repository owns and publishes the explicit client denials, with source tracked
in [mobile PR #35](https://github.com/posetek/posetek-mobile-app/pull/35).

Assigned and personal workouts invite only after an acknowledged completed save
with recorded work. Pain stops, early endings, failed saves, changed accounts,
hidden tabs and previews do not invite. A browser timestamp enforces a seven-day
automatic-invitation cadence; results links and admin QR/message links remain
optional and separate. Feedback never gates results or changes training records.
The original anonymous feedback release was `6ac17bc21377cbeaea114800`, published October 3, 2026
at 3:12:14 PM PDT. The exact candidate passed 20 hosted browser checks and nine
screenshots with zero feedback writes before promotion; production inventory and
artifact verification passed. Its receipt remains historical v1 acceptance evidence;
use `deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json` and `deployment/homepage-baseline.json`
for current website publication and protected-file evidence. The preceding coverage release `6ac06e0d420f2b6b34129fb5` and its
1,482-file baseline are historical checkpoints; its notification behavior is
preserved. Scoped functions are deployed and
source/IAM audited, TTL is active, indexes are ready and canonical rules are
published. The 12-player comprehension pilot across the three previously agreed
age bands remains outstanding. Native invitations require a separate mobile
release; all existing native/content acceptance gates remain in force.

The preceding guided-workout website release is `6abeaf5702a9c9983c7a41b9`, source `8956871`,
published October 1, 2026 at 12:18:33 PM PDT. Guided Training uses code-only
feasibility assessment, shared single-session composition and explicit age and
readiness confirmation. Read `deployment/WORKOUT_AVAILABILITY_PRODUCTION.json`,
`deployment/RELIABLE_PLAYER_WORKOUTS_PRODUCTION.json`
and `docs/RELIABLE_PLAYER_WORKOUTS.md` before changing these contracts. Gateway
`agent-gateway-sha-a63f1b0b7e5d` is the shared canonical release; rules source
`44e4464` intentionally excludes unrelated unreleased native testing rules.
Catalog `1.0.93` changes only five mat requirements to allow floor training;
all 80 held drafts, doses, media and review states remain preserved. The release
includes already-live issue alerts from `e8de8d7` / `6abd8f957e046e8059376091`.
The Coach proxy rejects Netlify preview origins; keep its production allowlist.
That release's protected application baseline had 1,438 files; its verified production
artifact had 1,440 files plus Netlify's generated metadata record. Preserve the
original approved Players/Coaches marketing bytes during another app release.
Testing results and active plans are not personal-workout prerequisites. The
age-21 Speed/Agility issue was authored catalog coverage, not missing tests.
Preserve current age envelopes and held content; assessment reports a truthful
blocker instead of a perpetual loading state. Adult coverage requires a separate
content/age-envelope update, not an eligibility bypass.

The preceding coach presentation release is `6abb9f1e6c2c84772de67005`, source `684528b`,
published September 29, 2026 at 4:25:34 AM PDT. This presentation follow-up makes coach
percentile cards easier to scan without changing calculations, cohorts or access.
Read `deployment/COACH_COMPARISON_POLISH_PRODUCTION.json`. Team Insights is the single coach
workspace, including roster, inline player comparisons/training and embedded
Community. Astro builds the three website documents while retaining React and
Svelte interactions. The baseline protects 1,340 application/public files; all
1,342 artifact files match the production inventory. Read
`deployment/UNIFIED_COACH_WORKSPACE_PRODUCTION.json`,
`docs/UNIFIED_COACH_WORKSPACE.md` and `docs/insights/COACH_WORKSPACE_CONTRACT.md`.
Nine scoped Insights functions are live. Preserve canonical membership/social
boundaries, private workout drafts, the existing signup codes, and the live
workout-alert workflow from `deployment/WORKOUT_NOTIFICATIONS_PRODUCTION.json`.
That alert source was merged before this release because it was already live
but ahead of GitHub main. No rules, gateway, native or catalog deployment was
included in this adjustment.

The prior email-free access website release is `6ab8679ccbfca079f8997124`, source `f9f10e0`,
published September 26, 2026 at 5:50:52 PM PDT. Email-free staff activation and
PoseTek-assisted recovery are live through eleven scoped Firebase functions.
Read `deployment/EMAIL_FREE_ACCOUNT_ACCESS_PRODUCTION.json` and
`docs/EMAIL_FREE_ACCOUNT_ACCESS.md`. The reconciled baseline protects 1,145
application/public files; all 1,177 artifact files match the reviewed draft.
Production acceptance and the ordinary preservation build passed. Seven synthetic
accounts and run-owned records were removed, including Auth deletion tombstones.
Rules, gateway, training catalog and native UI were unchanged by this release.

The preceding confirmed training resources and account-entry release is website
deployment `6ab788d1c138322f8f9b9911`, source `e571df3`, published September 26,
2026 at 2:55:16 AM PDT. The baseline protects 1,078 application/public files.
Production artifact/browser verification and the ordinary preservation guard
passed. The canonical gateway, rules and catalog version `1.0.92` are live. Read
`deployment/CONFIRMED_TRAINING_ACCESS_PRODUCTION.json`,
`docs/CONFIRMED_TRAINING_ACCESS.md`, `docs/TRAINING_ACCESS_CATALOG.md`,
`docs/ACCOUNT_ENTRY_WORKFLOW.md` and `docs/COACH_WORKFLOW.md`. All 28 equipment
choices appear in five setup categories; confirmed access constrains generation,
publication and personal Start/Resume. Preserve the 54 source-bound requirement
maps and all 80 unpublished whole-body drafts. Staff authority remains assigned
through existing invitations and canonical memberships. Previous website production
is `6ab76982d74a19707a6f9d9a`; its receipt remains historical. Native UI remains a
separate uncompiled/unreleased candidate; the user authorized the web release
independently. Preserve the whole-body acceptance hold. Backend now redirects to
`https://github.com/posetek/posetek-backend`; canonical publishing commands above
remain binding.

All temporary release-verification accounts, documents and storage objects were
removed; independent readback found zero residue, including nested messages.
Post-cleanup verification preserved the exact catalog maps, media/reviews, AI
configuration and false whole-body mobile acceptance gate.

The prior filming-reference production release is `6ab25ae36de88d184cc9b2e1`, published
September 22, 2026 at 3:48:45 AM PDT. All 80 new drills have 81 external demo
references in the private admin **Watch before filming** section. Read
`deployment/DRILL_DEMO_REFERENCES_PRODUCTION.json` and
`content/training-expansion/DEMO_REFERENCES.md`; component references list exact
adaptations and verification limits. Reference links do not approve content or
fill athlete media slots. All 208 catalog records, media and review states were
preserved by this follow-up. Whole-body training adds 80 unpublished
drafts in catalog version `1.0.91`, organized into four filming weeks of 20.
All 128 prior catalog records and 34 active plans were preserved. Read
`deployment/WHOLE_BODY_TRAINING_PRODUCTION.json`, `docs/WHOLE_BODY_TRAINING.md`
and `content/training-expansion/production-id-map.json` before training changes.
All new content and media reviews remain pending. The mobile acceptance gate
remains false; activation and workout starts involving any of the 80 new exercises
remain held until reviewed device acceptance. No reviewer or player clearance was
created. Rules for this release are now part of the canonical mobile rules
(see § Firebase rules); nothing here publishes them.
Player signup links prefill the current code;
staff can copy existing links or generate a code only when missing. Normal actions
preserve valid codes. Read `deployment/PLAYER_INVITATION_LINKS_PRODUCTION.json`
and `docs/PLAYER_INVITATION_LINKS.md`; no real recipient accounts were claimed
during verification. Evidence-linked personalized planning now
serves the current admin planner and native schema-3 generation through shared
gateway revision `agent-gateway-web-64db60701c6e`. Coaching goals are optional.
Admin plans remain drafts until activated; native generation retains its existing
permissions, schema and daily limit of one. The narrow request-rules update permits
only an optional boolean estimate preference. Read
`deployment/EVIDENCE_PLANNER_PRODUCTION.json`,
`deployment/PLANNER_INTENT_PRODUCTION.json` and
`docs/PERSONALIZED_PLANNER_METHODOLOGY.md` before planner changes.
The gateway-only description follow-up lists actual domain minutes without
claiming a lead from nearly equal totals; prescriptions and website bytes remain
unchanged by that release.
The September 16 cohort now has twelve reviewed active schema-3 plans, four
workouts each. Preserve these and their private contexts. Read
`docs/SEP16_TRAINING_PLAN_ROLLOUT.md` and
`deployment/SEP16_TRAINING_PLANS_ACTIVATED.json` before changing cohort plans;
seven age assumptions were intake-only and must not be treated as recorded DOBs.
Reviewed provisional Dribbling and Agility
estimates add explicitly labeled skill-map and optional planning context,
separate from measured results, qualification, rankings and Insights. A confirmed
Sprint-to-Agility classification correction removes the incomplete attempt from
measured Sprint results while preserving the genuine Sprint attempt. Read
`deployment/PROVISIONAL_AGILITY_PRODUCTION.json` and
`docs/PROVISIONAL_AGILITY_RECOVERY.md`; the prior Dribbling receipt remains a
historical checkpoint. The preceding testing audit adds canonical
qualified results, proven duplicate suppression, exact capture media and truthful
pose timing. Read `deployment/TESTING_AUDIT_PRODUCTION.json` and
`docs/TESTING_AUDIT_BUILD_HANDOFF.md`. That historical baseline protected 727 files.
Native candidate `e2c3736` on `codex/testing-audit-remediation` includes durable
capture retention and awaits Taiyo's Mac/iPhone/TestFlight validation; do not deploy
native repository rules. Preserve the 32-entry video archive guard in
`onvideoupload-00027-guw` and the separate historical repair journals.
Expanded Insights includes demographics,
verified testing, workout outcomes and estimated active use for admins,
organization managers and assigned coaches, preserving the account hierarchy,
reviewed personalized web planner and exact Players and
Coaches marketing bytes from `6aab9fbaa73be75422324ba4` and concurrent source
commit `38a817e`. Gateway, rules and personalized configuration are live; native
mobile generation uses the shared methodology above. Native usage is included in the new remediation
branch (the prior `codex/expanded-insights-usage` branch is historical) for Taiyo's Mac/TestFlight release;
it is unavailable until athletes install that build. Read
`deployment/EXPANDED_INSIGHTS_PRODUCTION.json` for the prior Insights receipt,
`docs/insights/EXPANDED_INSIGHTS_HANDOFF.md` for definitions, retention and recovery,
`docs/insights/V2_CONTRACT.md` for the versioned reporting interface, and
`docs/insights/INTEGRATION.md` for the earlier dashboard semantics and
scoped callable deployment, `docs/VACAVILLE_WEBSITE_UPDATE.md` for the prior web rollout,
`deployment/COACHES_PAGE_PRODUCTION.json` for the prior marketing receipt,
`deployment/COACHES_PAGE_UPDATE.md` for the tailored team service and sample data,
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md` for the requested annotations, and
`deployment/SCROLLING_HOMEPAGE_UPDATE.md` for recovery and earlier release decisions.
Continue from the source included in this repository.

The feed feature stack is available in `app/src/pages/feed/` and `functions/`.
Read `docs/FEED_SOURCE_HANDOFF.md` for setup, API contracts and provenance. The
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
