# PoseTek website

Shared source repository: [dk242/posetek_website](https://github.com/dk242/posetek_website).
Public website: [posetek.net](https://posetek.net).

Workout email alerts are implemented and Resend setup is complete; all-player
activation awaits synthetic acceptance. See [the notification handoff](docs/WORKOUT_NOTIFICATIONS.md)
for confirmed behavior, private APIs and remaining activation requirements, and
[the scoped release guide](deployments/workout-notifications/README.md) for
independent intake, delivery and webhook deployment.
All seven scoped functions are deployed with the verified sender and signed
webhook. Two synthetic outcome emails have delivery receipts; sending is paused
while quiet/resume and mailbox acceptance finish. All-player sending is not on.
See the [provider verification receipt](deployment/WORKOUT_NOTIFICATIONS_PROVIDER_VERIFIED.json).
The website changes remain in
[draft PR #11](https://github.com/posetek/posetek_website/pull/11) and the
[verified preview](https://6abadd8abff0a78fde2fbe28--posetek.netlify.app/admin).

Email-free coach and administrator access is live on [posetek.net](https://posetek.net).
Source `f9f10e0` was published as deployment `6ab8679ccbfca079f8997124` on
September 26, 2026 at 5:50:52 PM PDT. Organization managers create private staff
activation links; recipients choose their password and then use the same sign-in
page. PoseTek admins issue internal-admin activation and assisted recovery from
**Account access** in their account menu. No email is sent by these managed flows.
See the [production receipt](deployment/EMAIL_FREE_ACCOUNT_ACCESS_PRODUCTION.json)
and [account access handoff](docs/EMAIL_FREE_ACCOUNT_ACCESS.md).
All 1,177 artifact files match the reviewed draft. The reconciled baseline protects
1,145 application/public files; production role-routing checks and the ordinary
preservation build passed. Seven temporary accounts and their run-owned records
were removed, including asynchronous deletion tombstones.

The preceding release of confirmed training resources and account entry remains live on
[posetek.net](https://posetek.net). Source `e571df3` was published as deployment
`6ab788d1c138322f8f9b9911` on September 26, 2026 at 2:55:16 AM PDT. The baseline
protects 1,078 application/public files. Production artifact/browser verification
and the ordinary preservation guard passed; the canonical gateway, rules and
source-bound catalog requirements are live.
Run-scoped cleanup and independent verification found no remaining temporary
accounts, documents or storage objects.

Athletes confirm available space, people and equipment before AI creation, review
conversational revisions, then explicitly publish. Personal Start/Resume rechecks
today's resources while preserving recorded progress. Account entry distinguishes
player codes, invited staff and the existing independent/legacy paths. Coaches
retain their assigned teams and can inspect published personal-workout outcomes.
Read the [release receipt](deployment/CONFIRMED_TRAINING_ACCESS_PRODUCTION.json),
[training-access handoff](docs/CONFIRMED_TRAINING_ACCESS.md),
[account-entry workflow](docs/ACCOUNT_ENTRY_WORKFLOW.md) and
[coach workflow](docs/COACH_WORKFLOW.md). The previous website deployment is
`6ab76982d74a19707a6f9d9a`; historical receipts describe their own release state.

Personal capabilities, canonical rules, the gateway and scoped Insights functions are live. The user explicitly authorized web release independently of native UI acceptance. The submitted App Store build is unchanged; native candidate `bc492aa` remains uncompiled/unreleased. This does not change the separate false whole-body mobile acceptance gate or approve any of the 80 unpublished drills.

This repository includes the scrolling homepage, all nine annotation updates,
the clearer pose, training and technique experience, the mobile app showcase,
and approved Figure-8 / Wall pass demo videos with interactive coach metrics.
The public [Coaches page](https://posetek.net/coaches) adds a tailored club/team
service, interactive sample profiles, and a Plan / Train / Retest walkthrough.
Both pages share persistent Players / Coaches navigation.
The filming-reference release was published September 22, 2026 at 3:48:45 AM PDT as
`6ab25ae36de88d184cc9b2e1`. It adds external demo references to the private
filming panel for all 80 new whole-body exercise drafts.
Start with [the project context](POSETEK_PROJECT_CONTEXT.md) and
[the website production receipt](deployment/DRILL_DEMO_REFERENCES_PRODUCTION.json).
Recovered homepage modules include provenance beside their source.

**Player signup links live:** Admin account and organization rosters offer
**Copy signup link** and **Copy code** for existing invitations. **Generate code**
appears only when an invitation is missing. Existing valid codes are preserved.
Links open Player signup with the
code filled in and claim the existing profile after account creation. Read
[the signup handoff](docs/PLAYER_INVITATION_LINKS.md). All 21 previously issued
codes were verified unchanged; real athlete accounts were not claimed for testing.

**Evidence-linked planning live:** the admin planner and mobile-generated plans
share the new evidence-to-priority-to-exercise methodology. Goals are optional;
every exercise explains its purpose and progress check. Admin drafts still
require explicit activation, while mobile generation keeps its existing daily
limit and active-plan behavior. Read the
[methodology and delivery contract](docs/PERSONALIZED_PLANNER_METHODOLOGY.md).
Existing plans and recording repairs are preserved. Native source-contract
validation does not replace installed-iPhone acceptance.
The [gateway description follow-up](deployment/PLANNER_INTENT_PRODUCTION.json)
is live at revision `agent-gateway-web-62c05fa8fbde`. It reports actual training
minutes with neutral wording while preserving exercise selection and workload.
The [September 16 cohort rollout](docs/SEP16_TRAINING_PLAN_ROLLOUT.md) is complete:
twelve reviewed active plans and 48 workouts, stored under the existing player
profiles for later signup. Planning-age assumptions did not change birthdays.

**Reviewed Dribbling and Agility estimates live:** authenticated skill maps show
separately labeled conditional estimates, with optional low-confidence planning
context. They add no measured results, completion counts, rankings, Insights or
shared results. A confirmed agility recording was also corrected from Sprint to
Change of Direction; its finish remains missing and the genuine Sprint result is
preserved. Read the [Agility estimate and recovery contract](docs/PROVISIONAL_AGILITY_RECOVERY.md)
and the [earlier Dribbling handoff](docs/PROVISIONAL_DRIBBLING_RECOVERY.md). Preserve
the current 32-entry archive guard in `onvideoupload-00027-guw` and all repair journals.

**Testing audit fixes live:** reviewed results, duplicate suppression, independent
metric validity and exact-attempt video/pose replay are deployed. Read the
[audit release and Mac handoff](docs/TESTING_AUDIT_BUILD_HANDOFF.md). Taiyo's native
candidate is pushed as `codex/testing-audit-remediation` at `e2c3736`; Xcode,
physical-iPhone acceptance and TestFlight remain outstanding. Historical footage
gaps are recorded separately and are not claimed as software repairs.

**Website follow-up live:** canonical account
hierarchy and reviewed personalized planning now serve
admin, staff and athlete web surfaces. The shared planner methodology described
above now also serves native mobile generation.
Expanded Insights is live for admins, organization managers and assigned coaches,
with demographic charts, verified testing, workout outcomes and prospective
estimated active use. Read the [expanded handoff](docs/insights/EXPANDED_INSIGHTS_HANDOFF.md)
for definitions, retention, release/recovery and Taiyo's separate iPhone branch.
The [V2 API contract](docs/insights/V2_CONTRACT.md) documents current-access checks,
complete totals and pagination. Native usage begins only after the new build is
compiled, tested and installed through Taiyo's Mac/TestFlight workflow. Read the
[Vacaville website handoff](docs/VACAVILLE_WEBSITE_UPDATE.md) for scope, workbook
aggregates, privacy boundaries and current validation. The release preserves the
approved Players and Coaches marketing bytes from `6aab9fbaa73be75422324ba4` and
the concurrent marketing source commit `38a817e`.

The two public drill clips and posters are committed in
`app/src/pages/home/product/media/`; ordinary builds need no Firebase access.
See [the drill and coach update](deployment/DRILL_VIDEO_COACH_UPDATE.md) for
media provenance, responsive behavior and the read-only preparation script.

**Feed source available:** the complete feed feature stack is now committed:
recovered editable React frontend, original deployed Firebase backend, typed API
contracts, rules, indexes, navigation and tests. See [the feed development
handoff](docs/FEED_SOURCE_HANDOFF.md) for setup and source locations. Run the Vite
dev server and open `/feed?preview=1` for sample content. Root `feed.html` is an
older mockup; use `app/src/pages/feed/` for iterations.

## Set up a fresh clone

Use Node.js 22.18 or later in the Node 22 release line and npm 10. Run from the
repository root unless stated otherwise:

```powershell
git clone https://github.com/dk242/posetek_website.git
cd posetek_website
npm --prefix app ci --no-audit --no-fund
node scripts/capture-deployed-reference.mjs
npm --prefix app run build:marketing
node scripts/serve-homepage-preview.mjs
```

Open http://127.0.0.1:4174 for players or http://127.0.0.1:4174/coaches for coaches.
The one-time capture downloads the pinned public
reference into the ignored `.netlify/deployed-reference/` directory. It needs
internet access but no Netlify credentials. It supplies the existing application
and static assets used by the local homepage preview. Rebuild marketing after
editing homepage source; this preview server does not provide hot reload.

For comparison, `node scripts/serve-deployed-reference.mjs` serves the unchanged
September 15 tabbed reference at http://127.0.0.1:4173. Normal marketing builds
use committed source and do not require the reference capture.

## Work in the right source

| Area | Location |
| --- | --- |
| Homepage sections, copy, styles and interactive demos | `app/src/pages/home/` |
| Public entry and metadata | `index.html` |
| Coaches page, fictional examples, and development journey | `app/src/pages/coaches/` |
| Coaches entry and metadata | `coaches/index.html`, `app/src/coaches-entry.tsx` |
| Shared public audience navigation | `app/src/pages/home/MarketingHeader.tsx` |
| Application routes and screens | `app/src/App.tsx`, `app/src/pages/` |
| Backend functions | `functions/` |
| Feed frontend, API contracts and provenance | `app/src/pages/feed/` |
| Feed backend and provenance | `functions/social.js`, `functions/social-projection.js`, `functions/SOCIAL_RECOVERY.md` |
| Production assembly and verification | `scripts/`, `deployment/` |
| Player behavior and data contracts | [docs/PLAYER_EXPERIENCE.md](docs/PLAYER_EXPERIENCE.md) |

For application development, run `npm --prefix app run dev` and use the URL Vite
prints. This serves the application source, which is a different build from the
isolated public homepage. Mobile source remains a reference for shared behavior.

The admin dashboard source now has a development-only synthetic preview at
`/admin?preview=1`. See [the admin dashboard cleanup handoff](docs/admin/DASHBOARD_CLEANUP.md)
for the shared admin/Insights design system, responsive screenshot command, and
release boundary.

## Validate homepage changes

```powershell
npm --prefix app test -- src/pages/home src/pages/coaches
node --test scripts/home-navigation.test.mjs scripts/production-baseline.test.mjs scripts/homepage-preview.test.mjs
npm --prefix app run check:svelte
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app run build:marketing
```

Review both audiences, affected interactions, and responsive layouts in the local
preview. The [coaches handoff](deployment/COACHES_PAGE_UPDATE.md) documents sample
data, service decisions, and the application preservation boundary.

## Production build

```powershell
node scripts/build-production.mjs
```

This builds `production-dist/`, verifies the live application against
`deployment/homepage-baseline.json`, and preserves every application/public file
recorded in that baseline. A fresh build downloads and
checksums baseline assets and uses matching tracked HTML where the host rewrites
served pages; internet access is required. The build stops if the live application
has drifted. Reconcile a reviewed baseline instead of bypassing the guard.

`netlify.toml` uses this production command and publishes `production-dist/`.
The repository root, `marketing-dist/`, and the ordinary application `dist/`
are not the complete homepage release artifact. Application source changes are
not automatically included in this preservation-based homepage build.

For the approved application update, use the separate guarded builder:

```powershell
node scripts/build-application-release.mjs
```

It first verifies and assembles the full preserved site, then replaces only
`production-dist/application.html` and adds the compiled application assets.
The deployable directory remains `production-dist/`; unrelated static files and
the homepage and Coaches page retain their verified bytes. It rejects drift and asset collisions
and writes `.netlify/application-release-build.json`. Follow the
[application release and validation steps](docs/VACAVILLE_WEBSITE_UPDATE.md#deliberate-application-release),
review the exact draft output, and reconcile the preservation baseline after a
verified release. This command does not itself deploy the website or backend.

The optional `--marketing-snapshot <manifest-path>` argument pins a complete,
verified marketing snapshot instead of publishing newly compiled marketing bytes.
The builder validates local hashes and current production before restoring it.
The September 17 application release used this option to retain the approved
homepage, Coaches page and 30 marketing assets. See the handoff for manifest
requirements; local snapshots and generated manifests stay outside Git.

The latest release was a manual Netlify draft promoted after validation. Preserve
that draft-review and verification workflow for future releases. A Git push may
trigger Netlify when Git builds are enabled; check the site's deployment status
when publishing source changes.

## Collaborate

Pull the latest `main` before starting and use a branch for new work. Commit
website source, required data/assets, tests, lockfile changes and updated handoff
documentation to this repository, then push the branch so others can use it.
Keep generated output, dependency folders, local captures and credentials out of
Git. Check `git status` before switching branches when local work is present.

The original authored source for parts of the September 15 deployment was not
available. The maintained recovered modules in this repository are the accepted
implementation; reconcile any later source recovery with them rather than
replacing the published behavior.
