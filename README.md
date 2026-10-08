# PoseTek website

<!-- player-account-recovery-current:start -->
## Current player account recovery release

Website `6ac73b9c8091f2ef117b22bf`, runtime source `293acca795c4baddf279a23e9792404f97336326`, was published October 8, 2026 at 12:03:50 AM PDT. Players can request tracked sign-in help. Active organization managers can assist their own enabled password-based players after identity confirmation and sign-in within five minutes; PoseTek retains global/staff recovery. Administrators share a private one-time 30-minute link directly, and players choose their own password. Shared, Password updated and Sign-in confirmed remain separate evidence. Requests expire through 90-day TTL. The same recovered account supports existing website and mobile password sign-in; native UI and release gates are unchanged.

The exact draft passed hosted and production synthetic acceptance. Ten scoped functions are verified, 120 unrelated functions are unchanged, required indexes/TTL are ready, and the reconciled 1,872-file baseline passed its ordinary preservation build. Marketing, isolated feedback, stable P icons and teammate navigation remain preserved. All seven owned synthetic accounts were removed; delayed independent readback found zero owned, descendant or scoped-query documents with verification browser and copied owner credential files removed. Read [the recovery handoff](docs/PLAYER_ACCOUNT_RECOVERY.md), [production evidence](deployment/PLAYER_ACCOUNT_RECOVERY_PRODUCTION.json), [scoped operations](deployments/account-recovery/README.md) and [PR #40](https://github.com/posetek/posetek_website/pull/40).
<!-- player-account-recovery-current:end -->

<!-- organization-navigation-current:start -->
## Historical organization manager navigation release

Website `6ac6c5c6cebb1cb580004fae`, runtime source `0a7fe6d`, was published October 7, 2026 at 3:28:24 PM PDT. Kai's PR #39 retains organization navigation across manager Organization, Insights, Planner and Community. Planner links follow the currently verified selection while preserving unsaved intake and draft state. Existing admin/coach access and the preceding coach release are retained.

All 1,856 artifact files match 1,857 provider records; 1,824 predecessor records remain exact and 31 runtime assets are added. Approved marketing, isolated feedback and P icon bytes are preserved. The reconciled baseline protects 1,854 files. Frontend validation covers 1,870 unique tests, TypeScript, 55 release guards, hosted manager navigation and 360/390/430px menus. The temporary account, five owned documents and deletion tombstone are removed; independent delayed readback found zero residue and no credential file. All 124 function versions/configurations are unchanged. Backend, rules, indexes, gateway, catalog and native were not deployed.

Read [the organization navigation handoff](docs/ORGANIZATION_NAVIGATION_RELEASE.md), [production evidence](deployment/ORGANIZATION_NAVIGATION_PRODUCTION.json) and [PR #39](https://github.com/posetek/posetek_website/pull/39). The earlier release records below remain historical checkpoints.
<!-- organization-navigation-current:end -->


<!-- coach-release-alignment-current:start -->
## Historical combined coach and admin-menu release

Website `6ac6a6bd448852167e52d189`, runtime source `69e51f5`, was published October 7, 2026 at 1:14:12 PM PDT from the exact reviewed candidate. Kai's always-visible coach roster and player summary now share authoritative cumulative D1 standing through the selected end, latest-two-local-test-date change and current fourteen-day plan progress. Missing summaries remain unavailable. Signup copying, scope/filter/history returns, player records and prescribing remain connected. The admin header groups Overview, Coaching hub and System & User Insights while retaining the existing tools and hierarchy.

All 1,825 artifact files match 1,826 provider records; 1,809 predecessor provider records remain exact and 15 runtime assets are added. The nine scoped Expanded Insights functions from `4ceba70` passed immutable source, configuration, IAM and dependency-closure verification; all 115 unrelated functions remain unchanged. Verified versions are getClubInsightsV2 version 7, getCoachPlayerComparison version 4, recordInsightUsage version 6, all six projectInsight writers version 7. Owned additive candidate and production acceptance passed 35 and 35 checks, with 13 and 13 captures. The reconciled baseline protects 1,823 files and passed the ordinary preservation build.

Owned active accounts/documents, current and noncurrent storage objects and notification outboxes are absent after delayed independent cleanup; verification credentials were removed. Deleted run-owned synthetic JSON generations remain recoverable under the unchanged seven-day bucket soft-delete policy until automatic expiry; zero active/current/noncurrent objects is verified, not physical erasure of retained soft-deleted generations.

Marketing, isolated feedback, stable P icons, real athlete evidence, active plans, coach assignments and private drafts/conversations are preserved. Rules, indexes, gateway, catalog and native were not deployed. The eighty held drills and their device/content acceptance hold, default-disabled gateway-first native voice, diagnostics, historical replay and other native release gates remain unchanged. Read [the coach handoff](docs/COACH_RELEASE_READINESS.md), [menu handoff](docs/ADMIN_SECTION_MENU.md), [production evidence](deployment/COACH_RELEASE_ALIGNMENT_PRODUCTION.json) and [PR #38](https://github.com/posetek/posetek_website/pull/38). The earlier admin hierarchy release and candidate receipts below remain historical checkpoints.
<!-- coach-release-alignment-current:end -->


Shared source repository: [dk242/posetek_website](https://github.com/dk242/posetek_website).
Public website: [posetek.net](https://posetek.net).

<!-- admin-hierarchy-current:start -->
## Historical admin hierarchy and complete reporting release (October 6, 2026)

Website `6ac5ac30bb13dae95443c2b4`, source `3f03565`, was published October 6, 2026 at 7:24:56 PM PDT from the exact reviewed candidate. People & organizations now follows Organizations → Team → People. Selecting an organization shows its aggregate graphs and team directory; a team, explicit All teams or Unassigned destination opens people. Overview, Testing, Workouts and Usage keep their complete cards, graphs, explanations and evidence tables above the roster. Read [the hierarchy handoff](docs/ADMIN_HIERARCHY_REPORTING.md) and [production evidence](deployment/ADMIN_HIERARCHY_REPORTING_PRODUCTION.json).

The exact candidate and production passed 43 and 43 live synthetic browser checks. All 1,810 artifact files match 1,811 provider records. The nine already-live Insights function definitions and IAM were checked read-only and remain unchanged; this pass deployed no backend. All owned accounts and records were removed, with delayed independent zero-residue readback. The reconciled baseline protects 1,808 files and passed the ordinary preservation build. Marketing, isolated feedback, P icons, Kai's coach workspace, signup codes, Device/team routes and separate native/content/replay/diagnostics gates are preserved. No rules, indexes, gateway, catalog or native deployment is included. Source and confirmed records are in [PR #36](https://github.com/posetek/posetek_website/pull/36).

At that historical release checkpoint, the later GitHub main commit `11cff549ec959487a9b3ff831976bc7be12af6a5` merged PR #35 after this admin artifact was promoted. Its separate coach/frontend/backend source is preserved but remains unpublished. Production continues to use the verified admin runtime `3f03565`; no combined application or backend release is implied by the source merge. A future combined release must first include `insights-overview.js` in the prescribed backend bundle and verify the additive summary contract, so absent summaries cannot be displayed as zero or no follow-up. Preserve the coach candidate's remaining rules/parity and production acceptance gates. The ordinary build still preserves the 1,808-file live baseline.
<!-- admin-hierarchy-current:end -->


## Historical admin metrics and roster release

Website `6ac5a02e62dff64d89f511e0`, source `5907d44`, was published October 6, 2026 at 6:38:19 PM PDT. People & organizations now combines scoped reporting with the account roster. Summary cards and each player show testing, completed workouts and estimated active use alongside existing signup code/link actions. Players retains Overview, Testing, Workouts and Usage within the same workspace; player details retain the selected reporting period. Read [the workspace handoff](docs/ADMIN_WORKSPACE_METRICS.md) and [production evidence](deployment/ADMIN_WORKSPACE_METRICS_PRODUCTION.json).

The exact candidate and production passed 32 and 32 live synthetic browser checks respectively. All 1,785 artifact files match 1,786 provider records. The nine website-owned Expanded Insights functions passed source/configuration/IAM and unrelated-function preservation checks, plus 12 live access/lookup checks. Temporary accounts and records were removed; delayed independent readback found zero residue. The reconciled baseline protects 1,783 files. Marketing, feedback isolation, stable P icons, Kai's coach workspace, invitation codes, Device/team routes and separate native/content/replay/diagnostics gates are preserved. No rules, gateway, catalog or native deployment is included. Source and confirmed records are in [PR #34](https://github.com/posetek/posetek_website/pull/34).

The preceding admin directory release was `6ac5905069994ecfbad5e391`, source `afb52a0`, on October 6 at 5:26:55 PM PDT. Its [receipt](deployment/ADMIN_DIRECTORY_PRODUCTION.json) remains historical evidence.

Before the preceding directory release, actual production was `6ac5324b4ab5d8f3d69e6fdc`, ahead of
the supplied notes. Its original marketing and isolated feedback documents,
stable icons and unrelated assets are preserved. The earlier ordinary Git build
`6ac3d1c930af650008d83718` and [marketing snapshot receipt](deployment/MARKETING_SNAPSHOT_20261005.json)
remain historical records. Device performance and team-session routes are
retained; their separate backend/native acceptance gates are unchanged.

The preceding feedback attribution release is `6ac395bfba35bceed566d26c`, source `5792b63`, published
October 5, 2026 at 5:23:26 AM PDT. New signed-in feedback includes a server-verified
account snapshot after a clear notice before the questions. Signed-out shared
links and earlier anonymous responses remain anonymous. See [the feedback handoff](docs/APP_FEEDBACK.md)
and [attribution receipt](deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json).
That release protected 1,638 file paths, retained in the current baseline with
subsequent application and feedback entry updates recorded in later releases.

Kai's preceding coach Overview release is preserved. It leads with a dated Team
snapshot, count-matching review links, visible filters and a collapsed roster
that retains its open state through fetches. See [the release handoff](docs/COACH_OVERVIEW_RELEASE.md)
and [verified production receipt](deployment/COACH_OVERVIEW_PRODUCTION.json).
Reporting/access contracts, approved marketing and stable P icons are preserved.
The attribution update releases only the two scoped feedback functions; rules,
gateway, native, training records and held content are unchanged.

The historical icon-only release `6ac1abf790c8c0037928b52a` was published October 3,
2026 at 6:31:53 PM PDT and protected 1,539 baseline files. Browser tabs and search
favicon metadata retain the approved lime PoseTek P. See [the icon handoff](docs/SITE_ICONS.md)
and [its production receipt](deployment/SITE_ICONS_PRODUCTION.json). Google controls
when the refreshed icon appears in search results.

For the current coach/admin interface and the next engineering direction, read
[Kai's dashboard handoff](docs/KAI_DASHBOARD_HANDOFF.md). It covers navigation,
functionality, metric definitions and verification cases, followed by Dylan's
open-ended brief for simpler coach use and admin oversight across clubs.

Optional app feedback uses public `/feedback` and verified PoseTek-admin review
at `/admin/feedback`, including a locally generated QR code and copyable share
links. Assigned and personal workouts invite only after an acknowledged completed
save with recorded work, at most once every seven days in the same browser;
results feedback remains optional and available separately. The verified feedback
introduction release was `6ac17bc21377cbeaea114800`, published October 3, 2026 at 3:12:14 PM PDT.
The exact candidate passed 20 hosted browser checks across nine screenshots with
zero feedback writes before promotion. See [the feedback handoff](docs/APP_FEEDBACK.md)
and [attribution production evidence](deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json) for feedback behavior,
backend evidence and integrity checks. Current website publication is recorded in
[the hierarchy reporting receipt](deployment/ADMIN_HIERARCHY_REPORTING_PRODUCTION.json). The website owns the two scoped feedback
functions; the canonical mobile repository owns and publishes their client-denial
rules. The [12-player comprehension pilot](docs/APP_FEEDBACK_PILOT.md) remains outstanding, and native
invitations require a separate mobile release.

The preceding October 2–3 notification coverage correction was published as
application deployment `6ac06e0d420f2b6b34129fb5`. Its provider and served-content
verification checked all 1,485 files, preserving the then-current marketing, protected files and
platform configuration. The website now assigns fresh request references to supported
social attempts; compatible backend observations retain both sources, while
conflicting actions or known targets remain distinct. Ten user-issue functions
at version 8, six tracker functions at version 5 and fourteen individually scoped
social endpoints passed exact source/configuration/IAM checks. Read
[the current handoff](docs/NOTIFICATION_COVERAGE_CORRECTION.md) and
[correction receipt](deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
for release and current workbook evidence. Baseline adoption at that checkpoint
passed with 1,482 protected application/public files; that deployment/count is
historical after the feedback release. The historical
revision-121 results below do not establish the latest source coverage.

Dylan alone is the approved recipient; Nolan and Taiyo retain shared workbook editing.
Native Crashlytics export is configured On for the registered iOS app, but the
owning-Mac/iPhone/TestFlight genuine crash acceptance gate remains held. At the
preceding checkpoint, approval
of the new Microsoft mailbox identity-conversion connection passed its separate
read-only acceptance; the version-six tracker source is verified, while the
identity settings cutover and retained-alias publication were still pending. The
[historical verification checkpoint](deployment/OUTLOOK_IDENTITY_AUTOMATION_PROGRESS.json)
records revision 266 and the capacity repair awaiting deployment and physical
cloud workbook verification. It does not claim a fully refreshed tracker.
Power Automate event intake and automatic cloud recovery operate independently
of this chat. Codex and Dylan's computer are not required for ongoing capture,
email delivery or shared-workbook updates. No automatic outreach or historical
Resend replay is included.

The October 4 validation now physically accepts **revision 365**: **789 actions,
3,228 occurrences, 2,384 original email rows and four daily/status rows**. All
**690 saved human records** remain attached to stable Action IDs. Guarded mailbox
identity activation completed at **15:28:02.319 UTC**; the **17:09:52.135 UTC**
post-identity proof verified all 3,228 exact sources with zero incomplete source
authority. The older count of 34 described incomplete source authority, not 34
unknown contacts. Unknown operators and unverified contacts remain explicit.
Native publication, capture and recovery holds are restored. The final006 send
attempt was refused at **17:15:41.837 UTC**, without apply, a send intent or a send;
overall acceptance is false and genuine Dylan-only delivery remains open.
Scoped Insights metadata supports 15 settled v4 rebuilds, with seven stale current
manifests (including six v2), 428 missing current manifests and 17 ordinary
unfinished testing markers still explicit. Read the
[current validation handoff](docs/NOTIFICATION_PRODUCTION_VALIDATION.md) and
[receipt](deployment/NOTIFICATION_PRODUCTION_VALIDATION_20261003.json) for the
dated source cutoffs, log review and remaining native and coach-workflow limits.

Guided personal workouts were published as deployment `6abeaf5702a9c9983c7a41b9`, source
`8956871`, published October 1, 2026 at 12:18:33 PM PDT. Players choose focus,
location, available time and readiness one step at a time; age is confirmed only
when needed. Code-only assessment and shared deterministic composition produce
eligible sessions while conversations, AI revisions, Publish and Start remain
connected. Admin evidence storage and age eligibility are repaired. Read
[the handoff](docs/RELIABLE_PLAYER_WORKOUTS.md) and
[the availability receipt](deployment/WORKOUT_AVAILABILITY_PRODUCTION.json).
Completed testing and active plans are optional. Empty assessments show the
actual library limitation, and interrupted checks recover the same accepted job.
The current Speed/Agility age ranges exclude age 21; widening authored age
envelopes is a separate content change. The initial guided release remains
recorded in [its receipt](deployment/RELIABLE_PLAYER_WORKOUTS_PRODUCTION.json).
Unavailable catalog combinations require visible adjustments; the 80 held drills
and native release gates remain unchanged.

User crash/bug reporting, the protected issue inbox and email operations are
documented in [User issue alerts](docs/USER_ISSUE_ALERTS.md). Native rollout and
Crashlytics export verification have separate acceptance gates.

The preceding October 2 refinement made **`dylank@posetek.net` the only recipient** of new
issue, status, daily-summary and workout notifications and both separate PoseTek
Google Cloud alert policies. Nolan and Taiyo retain editing access to the shared
Excel workbook in **PoseTek > Technology > Website > User Issue Tracker > PoseTek
Issue Tracker.xlsx**. Historical consumed recipient sets and receipts are preserved;
the older Resend backlog is not replayed. Dylan handles outreach manually.

The scoped deployments verified ten user-issue functions at version 5, three
Microsoft email functions at version 2 and six tracker functions at version 2,
preserving unrelated resources, IAM and schedules. Exact-UID contact enrichment
covered 101 occurrences across seven Auth accounts: three verified emails, four
unverified emails and no Auth display names. The fixed initial review retained
995 service/anonymous records without a recorded Auth UID as unknown. The tracker
keeps actor and target athlete separate and preserves stable IDs, evidence and the
team's triage notes.

The Power Automate shared tracker is event driven, with an accepted Dylan-only
delegated mailbox reader and independent cloud source catch-up. Fresh cloud
evidence matched revision 87 to
the exact frozen batch, allowing its existing receipt to be acknowledged without
an Excel rewrite; the first ordinary retry returned revision 88. All eleven
approved recent amendments delivered to Dylan alone with their original payloads
and frozen claim digests preserved. Their structured identity fields describe nine
diagnostic upload messages and two service failures with unknown operators. Final
fresh cloud acceptance verifies revision 121 with 289 actions, 1,104 instances,
402 email rows and two daily records. The fixed `23:32:01.540Z` queue audit had zero
pending tickets. All 180 saved human
records, 882 historical links, formulas and the full 121-receipt chain passed.
Independent revision-121 identity acceptance verified all 101 contact annotations
(77 historical and 24 newer), all eleven Internet-Message-ID joins, and real
diagnostic upload and staff actions involving a different athlete. Nolan and
Taiyo's **Can edit** access was freshly confirmed at 23:24 UTC; the revised guide
passed cloud readback.

Publication metadata recovery reconciled 141 lagging existing windows in eight
transactions without Excel, Flow, email, seed or capture-field changes. Outlook
and backend each completed and published all 159 windows through the fixed
October 2, 4:28 PM PDT cutoff: respectively `2026-10-02T23:28:04.127Z` and
`2026-10-02T23:28:04.120Z`. Two newly queued arrival tickets appeared in the later
`23:34:18.201Z` readback. The normal native queue resumed **RUNNING**, verified at
23:36 UTC with unchanged configuration. This establishes catch-up through those checkpoints,
not coverage of later arrivals or completion of the independent outstanding-delivery
scan. Current sending and
coverage must come from the [refinement receipt](deployment/NOTIFICATION_REFINEMENT_PRODUCTION.json),
not an older flow badge or setup result. Never replace or reseed the native master.
Read [the refinement handoff](docs/NOTIFICATION_OUTREACH_REFINEMENT.md),
[the tracker handoff](docs/ISSUE_TRACKER_EVENT_FLOW.md) and
[the Microsoft package](deployments/microsoft-email/README.md).

The October 1 [recipient rollout](deployment/USER_ISSUE_RECIPIENTS_PRODUCTION.json),
initial October 2 [Microsoft migration](deployment/MICROSOFT_EMAIL_PRODUCTION.json)
and [tracker activation](deployment/ISSUE_TRACKER_EVENT_PRODUCTION.json) remain
dated historical receipts. The earlier three-recipient setup pilot and revision-eight
workbook readback do not establish the refinement's current delivery or coverage.

The unified coach workspace and Astro build are documented in
[the implementation handoff](docs/UNIFIED_COACH_WORKSPACE.md). Team Insights owns
the coach roster, progress, player details and embedded Community. Astro builds
the three public/application entries while retaining existing React and Svelte
interactions. Use `node scripts/build-astro-release.mjs` for a deliberate
application release; ordinary builds retain the protected live application.

The preceding coach percentile presentation release is deployment `6abb9f1e6c2c84772de67005`, source
`684528b`, published September 29, 2026 at 4:25:34 AM PDT. The card pairs a compact
radar with readable skill positions, measured-player counts and concise scale
explanations. Phone layouts show skill positions first. Scoring and access are
unchanged. All 1,342 artifact files match production inventory; the baseline
protects 1,340 application/public files. See
[the presentation release receipt](deployment/COACH_COMPARISON_POLISH_PRODUCTION.json)
and [PR #14](https://github.com/posetek/posetek_website/pull/14).

The preceding workspace and Astro release is recorded in
[its production receipt](deployment/UNIFIED_COACH_WORKSPACE_PRODUCTION.json).

The original workout-alert rollout activated for all players on September 28, 2026 at
4:06:30 PM PDT. Saved outcomes go to `dylank@posetek.net`; web-observed sessions
also qualify for an inactivity notice after 30 minutes, processed every five
minutes. Emails include the player, recorded time/progress and a protected link
to the exact workout history. Native-only sessions have saved-ending coverage.
There was no historical backfill. At that rollout, all seven scoped functions, the verified
Resend sender and signed delivery webhook are live. Three synthetic emails
received delivery receipts, and the final quiet email was confirmed in Outlook
Inbox. Test records were removed before a fresh all-player activation cutoff.
The subsequent Microsoft migration replaced Resend for new alerts; the dated
Resend receipt remains historical evidence.

The preceding workout-alert website checkpoint used source `d814225` and deployment
`6abadd8abff0a78fde2fbe28`; its baseline protected 1,207 application/public files.
The preservation build,
22 release checks, 30 production routes and all 1,049 JS/CSS assets passed.
See the [production receipt](deployment/WORKOUT_NOTIFICATIONS_PRODUCTION.json),
[notification handoff](docs/WORKOUT_NOTIFICATIONS.md) and
[scoped release guide](deployments/workout-notifications/README.md).
Source and handoff changes are shared in
[PR #11](https://github.com/posetek/posetek_website/pull/11).

The following release summaries describe earlier checkpoints.

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

Use Node.js 22.19 or later in the Node 22 release line and npm 10. Run from the
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
| Astro public entry and metadata | `app/astro/pages/index.astro`, `app/astro/layouts/Document.astro` |
| Coaches page, fictional examples, and development journey | `app/src/pages/coaches/` |
| Astro Coaches entry | `app/astro/pages/coaches/index.astro` |
| Astro application entry and bootstrap | `app/astro/pages/application.astro`, `app/src/astro/ApplicationRoot.tsx` |
| Isolated public feedback form and admin review | `app/astro/pages/feedback.astro`, `app/src/pages/feedback/`, `app/src/pages/admin/views/AppFeedback.tsx` |
| Feedback backend scope and delivery contract | `functions/app-feedback.js`, `deployments/app-feedback/`, [docs/APP_FEEDBACK.md](docs/APP_FEEDBACK.md) |
| Shared public audience navigation | `app/src/pages/home/MarketingHeader.tsx` |
| Application routes and screens | `app/src/App.tsx`, `app/src/pages/` |
| Backend functions | `functions/` |
| Feed frontend, API contracts and provenance | `app/src/pages/feed/` |
| Feed backend and provenance | `functions/social.js`, `functions/social-projection.js`, `functions/SOCIAL_RECOVERY.md` |
| Production assembly and verification | `scripts/`, `deployment/` |
| Player behavior and data contracts | [docs/PLAYER_EXPERIENCE.md](docs/PLAYER_EXPERIENCE.md) |

For the complete migrated site, run `npm --prefix app run dev:astro`.
`npm --prefix app run dev` remains a compatible Vite application preview; its
legacy entry documents are retained for that purpose. Mobile source remains a
reference for shared behavior.

The admin dashboard source now has a development-only synthetic preview at
`/admin?preview=1`. See [the admin dashboard cleanup handoff](docs/admin/DASHBOARD_CLEANUP.md)
for the shared admin/Insights design system, responsive screenshot command, and
release boundary.

With the Astro development server, `/feedback?preview=1` previews the isolated
form without production requests. `/admin/feedback?preview=1` uses synthetic
responses in development only. See [the feedback handoff](docs/APP_FEEDBACK.md)
for the real read-only admin view, share links and outstanding player pilot.

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

For a change limited to browser/search icons, use the guarded
[website icon workflow](docs/SITE_ICONS.md). It preserves existing page bodies
and runtime assets while changing only document-head icon links and the four
declared icon files. Ordinary builds continue to verify the protected baseline.

```powershell
node scripts/build-production.mjs
```

This builds `production-dist/`, verifies the live application against
`deployment/homepage-baseline.json`, and preserves every application/public file
recorded in that baseline. A fresh build downloads and
checksums baseline assets and uses matching tracked HTML where the host rewrites
served pages; internet access is required. The build stops if the live application
has drifted. Reconcile a reviewed baseline instead of bypassing the guard.

For legacy HTML rewritten by the host, verified `localPath` entries recover the
original source bytes. Git line-ending conversion is supported in both directions
only when the reconstructed file matches the pinned checksum and size exactly.
The builder does not change or normalize the protected baseline hashes.

`netlify.toml` uses this production command and publishes `production-dist/`.
The repository root, `marketing-dist/`, and the ordinary application `dist/`
are not the complete homepage release artifact. Application source changes are
not automatically included in this preservation-based homepage build.

For the approved application update, use the separate guarded builder:

```powershell
node scripts/build-application-release.mjs --preserve-marketing .netlify/approved-marketing/manifest.json
```

The default builder delegates to `scripts/build-astro-release.mjs`. It first
verifies and assembles the protected site, then composes the declared Astro
documents and hashed assets. `--preserve-marketing` freshly verifies the approved
Players and Coaches snapshot and retains its original HTML; only the application
and isolated feedback entries change. Without that option, the declared marketing
documents are rebuilt too. The deployable directory remains `production-dist/`;
unrelated protected files retain their verified bytes. The build rejects drift
and asset collisions and writes `.netlify/application-release-build.json`. Follow
[the feedback release handoff](docs/APP_FEEDBACK.md#release-and-recovery) and the
[application release and validation steps](docs/VACAVILLE_WEBSITE_UPDATE.md#deliberate-application-release),
review the exact draft output, and reconcile the preservation baseline after a
verified release. This command does not itself deploy the website or backend.

The historical Vite `--marketing-snapshot <manifest-path>` mode pins a complete,
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
