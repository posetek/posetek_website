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

The current website release is `6abb9f1e6c2c84772de67005`, source `684528b`,
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
