# PoseTek Coach and Admin Dashboard Handoff


## October 6 local Overview presentation decision

Kai requested removal of the **Worth reviewing** section and an always-visible
Coach Overview roster. The local source and synthetic preview show the roster
without a disclosure control. Kai also removed the Age and Estimated active use
columns from this roster; the underlying reporting data and other views retain
their existing contracts. Every roster row opens its player detail view; links, buttons and form controls
inside the row keep their own actions. Snapshot player links, visible reporting filters,
search, pagination, signup actions and Add player remain available. The label
**No workout status** is retained; Kai requested removal of the explanatory
sentence from the snapshot. The category still does not prove no workout occurred.
This supersedes the candidate's review-action and collapsed-roster presentation;
October 5 production receipts remain historical evidence, not changed releases.
The source candidate is on `codex/kai-work` after rebasing onto current `main`;
the production release and preservation baseline are unchanged. Review and merge
status are tracked in the pull request.

Post-rebase validation: frontend 1,745/1,745; backend 954 passed with three
existing private-history skips; script suites 55/55; all 12 canonical Firestore
and Storage rules suites passed. Svelte reported zero errors or warnings;
TypeScript, Astro marketing build and repository lint with warnings suppressed
completed successfully. The contract parity tests used a temporary read-only
checkout of the canonical mobile repository. No mobile files were changed.

Prepared for Kai by Dylan Keller. Original current-state review dated October 3, 2026.

## Coach Overview follow-up (October 5, 2026)

Kai's coach Overview is live in website `6ac38fde67d690075984e58b`, source
`7b1aa186`, published October 5, 2026 at 4:55:11 AM PDT. It leads with a dated Team snapshot of the
filtered reporting population, testing activity and workout activity. The roster
starts collapsed and retains its open state through loading, retries, search,
pagination, date changes and refresh. Another account or team starts collapsed.
Roster columns, signup actions, Add player and player detail remain available.

Included/filtered population counts, removable active-filter chips and Clear all
filters remain visible on the compact Overview. Worth reviewing preserves other
reporting filters and clears roster name search, so a positive-count review opens
the population represented by that count. Zero-count review buttons are disabled.
Name search still narrows roster rows alone, rather than totals or comparison
cohorts.

The workout category is **No workout status**. Its snapshot row says **with no
available workout status in this period**: missing records, unrecognized endings
and workouts ending outside this period can fall here. This status can coexist
with recorded workout activity; it does not prove that no workout occurred.

The prior coach Overview summary charts and breakdowns are removed from that tab;
Testing, Workouts, Active use, Community, player detail and admin/manager reporting
retain their views. Weekly qualified-performance lines connect available results
across empty weeks. The explanation and chart data table identify weeks with no
qualified result; the connecting line does not supply measurements for those
weeks or demonstrate individual improvement.

See [the coach Overview release handoff](COACH_OVERVIEW_RELEASE.md) for provenance,
release boundaries and verification, and [the verified publication receipt](../deployment/COACH_OVERVIEW_PRODUCTION.json).
The roster-first Overview below records the original October 3 review.

## Purpose and expected outcome

Kai, we want coaches to understand where their players stand and which areas deserve attention with as little effort as possible. We also want PoseTek admins to oversee several clubs, understand their data and resolve exceptions without navigating a congested workspace.

The dashboards already contain substantial reporting, player detail and operational tools. Your starting task is to establish that the displayed information is correct, then propose a simpler experience around the decisions coaches and admins actually need to make. The questions below provide direction and leave room for your creative judgment.

At the original October 3 review, the website release was `6ac17bc21377cbeaea114800`, published October 3, 2026 at 3:12:14 PM PDT. The source review used `eb6215a`. The companion Word handoff includes desktop screen captures from that review; credentials, signup codes and identifiable player screenshots are excluded from this repository document.

## Coach workspace at the October 3 review (historical Overview)

Coaches sign in at `/signin` and use Team Insights at `/insights`. Organization coaches see their currently assigned teams; independent coaches see their authorized roster. Current canonical membership and player ownership determine access, rather than a coach name or legacy roster mirror.

The visual design uses a deep-green canvas, green cards, pale text, muted labels and lime accents. Branding and Sign out sit above the team heading, scope/date controls and a horizontal tab row. Rounded cards, compact badges and explanatory disclosures repeat throughout the workspace.

Overview starts with the roster. Columns show Player, recorded Age, Testing status and coverage out of six exercises, Workouts completed, Estimated active use and Signup actions. Search and pagination help find players. Existing signup links and codes can be copied without rotation; missing invitations retain their generation action. Add player remains available.

Below the roster are summary tiles for Players, Fully tested, Workouts completed and Estimated active use, then participation, testing coverage, division, age and engagement breakdowns. Category selections filter the reporting population and appear as removable filter chips. Name search only narrows displayed roster results; it does not change report totals or comparison cohorts.

| Coach area | Functionality at the October 3 review |
| --- | --- |
| Overview | Roster first, player search, signup actions, summary tiles and reporting breakdowns. |
| Testing | Six-test coverage, qualified results, distinct attempts, weekly activity, recording audit, separate failure reports and qualified performance charts. |
| Workouts | Recorded starts/endings, timer and estimated duration, player status, all workout outcomes, prescription coverage, blocks and sets recorded. |
| Active use | Estimated athlete engagement, returning players, collection coverage, website/iOS/overlap and feature breakdowns. |
| Community | Embedded Activity, Find people and Sharing settings within existing social permissions. |

The default reporting period is eight weeks through today in Los Angeles time. Presets offer 4, 8, 12 and 26 weeks, with custom dates and timezone controls. Testing coverage defaults to cumulative through the selected end; Selected period only narrows it to the chosen range. Workouts, usage and weekly performance trends use the selected period.

## Coach player detail currently in place

Opening a player adds one named tab inside the same workspace. Selecting another player replaces it. Dates, search, browser history and planner return context are retained. The top of player detail shows the name, recorded age and Prescribe workouts.

The Team percentile or Roster percentile card combines a radar with readable skill tracks for Power, Speed, Agility, Ball Control and Striking. Each skill shows its own measured-player count. It compares the full eligible selected team or independent roster, unaffected by roster name search or reporting filters. It has no additional age or division adjustment.

Percentiles describe relative standing: 50 is the midpoint and 100 is the highest relative position, not a perfect test score. Missing measurements remain unavailable; a measured skill with fewer than two measured players has insufficient comparison. Provisional estimates do not enter measured cohort rankings.

Below the comparison are Program, Workout history and Stats tabs. Program is the current default. Stats retains the individual D1 benchmark comparison and drill metrics, which answer a different question from team percentile. A player can have a relatively low team percentile while being closer to the D1 reference in that skill; the comparison basis must remain visible.

Program shows the active player-readable plan. Reviewed schema-3 plans are read-only here; the planner prepares a draft and requires explicit activation. Creating a draft keeps the active plan in place. Older plan schemas retain their existing editing behavior. Workout history preserves saved prescriptions, revisions, sets, block outcomes, ending reasons, pain markers and timer/elapsed estimates. Published personal workouts are visible; unpublished proposals and private AI conversations retain their privacy boundaries.

The prominent prescription button and default Program tab are concrete design questions for Kai. A coach interested in performance information should be able to understand standing and development needs without creating or prescribing a workout.

## Admin workspace currently in place

PoseTek admins enter `/admin`. The header includes branding, an Admin badge, organization/team scope and an account menu. The horizontal navigation contains Overview, Accounts, Organizations, Planner, Technique review, Drill library, AI incidents, User issues and App feedback. Account access, Community feed and Sign out sit in the account menu.

The admin Overview embeds the reporting workspace. Its four summary tiles show Players, Fully tested, Workouts completed and Estimated active use, with miniature trends. Needs attention links to reps requiring review, unmatched failure reports and untested players. Testing coverage, players by team, recent participation, division/age/engagement charts and a paginated Players table follow. Overview, Testing, Workouts and Usage are reporting tabs within this page.

Scope moves from All organizations to an organization and then a team. Relevant links carry the context. Current global reporting includes canonical organizations and excludes independent legacy profiles, which Accounts can inspect separately. Historical records follow the player's current ownership. Confirm which organizations and test profiles should be included before interpreting global totals as customer coverage.

The header scope is not a universal filter. Accounts retains its broader hierarchy and uses context to open the selected organization. AI incidents and User issues have their own operational filters; anonymous App feedback spans organizations and cannot be attributed to a player or club. Needs attention links preserve context but do not guarantee a precisely filtered destination queue.

## Admin tools and functionality

| Area | Current capabilities and boundaries |
| --- | --- |
| Accounts | Organization/staff/team hierarchy, independent coaches, unassigned players and player drill results, workout history, profile inputs, feedback and plans. Athlete search reads the first 500 profiles and displays up to 40 matches; organization roster reads cap at 2,000, with visible limit messages. |
| Organizations | Create clubs/teams, rename teams, add or move players, import logos, invite staff and manage active access and assigned teams. Existing player identity/results are preserved when moved. |
| Planner | Evidence, optional goals, schedule, setting/resources and readiness; assessment, saved drafts, rationale, comparison and explicit reviewed activation. A generated draft is not automatically active. |
| Technique review | Saved video/pose inspection, phase frames, annotations and feedback/review tools. Missing media remains missing. |
| Drill library | Search, drill/media inspection and content authoring. Existing review, media and device acceptance holds remain binding. |
| AI incidents | Bounded incident search/grouping, reference lookup, context and triage. |
| User issues | Paged reports, account/platform/status/severity filters, device/build/source detail, supplied screenshots and status/fix/verification updates. Received reports are not a complete count of all failures. |
| App feedback | Recent responses, optional comments/duration, 90-day form-session counts and rates, QR download and manual links. It has no player/account/team/workout identifiers and is not an athlete usage metric. |
| Account access | Private staff/internal-admin activation and assisted recovery links. These managed flows state that no email was sent. Authority stays assigned through existing trusted memberships and admin checks. |

Admins can inspect athlete history and edit permitted profiles or prescriptions. They do not start or complete workouts as the athlete. Confirm current age is a deliberate refresh of an age observation; editing another field does not make stale age evidence current.

## How data reaches the dashboard

1. **Canonical sources.** Player profiles, current memberships/ownership, recorded reps, accepted revisions, assigned and personal workout logs, failure cases and Storage processing evidence provide the source facts. Athlete self-activity is collected separately.
2. **Qualification.** Effective-result and processing-evidence code establishes which metrics qualify, which revisions take precedence and how units normalize. Explicit nulls remain null; failed, duplicate, provisional, undated and future results do not inflate measured comparisons.
3. **Server projections.** Version-4 summaries and immutable daily pages publish only after completeness and invalidation-token checks. Source-change events invalidate or rebuild them.
4. **Scoped APIs.** `getClubInsightsV2` returns complete reporting totals; `getCoachPlayerComparison` derives an authorized full comparison cohort. Scope, membership, ownership and projection state are rechecked before the response.
5. **Dashboard presentation.** The frontend applies labels, filters, pagination, chart units and navigation context. Report totals cover the full filtered population, independent of the visible page or roster name search.

Missing, dirty or older projections rebuild automatically, with a limit of 25 players per request. The client retries the specific rebuild-required condition up to five times, then offers Refresh. Larger scopes may need further refreshes. Bounds fail explicitly rather than returning partial charts.

Freshness reports generation and projection rebuild timing. It is not a single transactional snapshot across Firestore and Storage: a source change can precede its asynchronous event. This is an important distinction when designing a hands-off correctness process.

## Definitions that must remain clear

| Displayed concept | Correct interpretation |
| --- | --- |
| Fully tested | Qualified evidence for all six required exercises; not simply six uploaded files. Free Record does not add coverage. |
| Documents, attempts, results | Separate counts. Proven duplicate documents do not create extra attempts or qualifying results. Linked failure reports overlap recording evidence and are not extra attempts. |
| Weekly performance | Best qualifying value across the filtered roster with sample/athlete counts. Different players can set successive weekly bests; this does not demonstrate each player's improvement. |
| Team percentile and D1 score | Relative team/roster position versus a separate benchmark index. Different comparison populations and labels must remain explicit. |
| Completed workout | The saved ending as logged. All prescribed sets recorded is separate and requires a known immutable prescription; partial/skipped work stays visible. |
| No ending record | No recorded ending, not proof the athlete is still exercising. |
| Estimated active use | Foreground athlete engagement, not attendance or physical training. Staff viewing a player does not count as that athlete's use; overlapping time counts once. |
| Not collected | Missing collection coverage, not evidence of zero effort or inactivity. Supported native build/device acceptance is a separate release requirement. |
| Age and division | Valid recorded DOB or a recent timestamped integer age; explicit division metadata. Team names, planning assumptions and names do not supply demographic evidence. |

## Data verification direction for Kai

Build repeatable checks from source facts through qualified results, projection, callable response and visible label. For each case, retain the population, date range/timezone, units, expected numerator and denominator. Prefer isolated fixtures for changes and write-dependent tests.

| Verification case | Expected acceptance |
| --- | --- |
| Fully tested and partial athletes | Correct six-exercise coverage and explicit missing exercises. |
| Duplicate, failed or provisional evidence | No inflated measured scores/counts; appropriate audit or estimate labels. |
| Accepted revision and explicit null | Matching revision takes precedence; no stale sidecar metric fills a null. |
| Undated/future evidence or stale age | Honest review/unknown states; no invented dates or ages. |
| Search, filters and pagination | Intended report population remains complete; name search/page changes do not shrink comparison cohorts. |
| Timezone/DST and workout boundaries | Correct local dates, starts before the range and endings inside it, with timer/estimate/prescription coverage reconciled. |
| Transfer, exclusion and revocation | Current ownership/inclusion enforced; open tabs and stale callbacks cannot retain access. |
| Cold rebuild or delayed processing | Truthful loading/unavailable/recovery states; no stale-looking partial total. |
| No usage or overlapping devices | Not collected remains distinct from inactivity; combined time counts overlap once. |
| Completed session with skipped work | Ending, work recorded and full-prescription completion remain distinct. |

A visual walkthrough establishes current presentation. It does not by itself establish accuracy of every production measurement, projection or club total. Reconciliation and device/capture validation remain separate acceptance work.

## Direction from Dylan

Kai, how can we ensure that this dashboard is pulling the correct information? How can we simplify the process so that checking and maintaining it is as hands-off as possible?

What coaches have expressed is that they simply want to see where their players stand and which areas they can improve. Most do not want to prescribe workouts or jump through hoops to access player data.

I believe the current coach perspective is a good starting point. The questions we need to answer are: What does a coach want to see first? Where should they see it? Is the dashboard difficult to navigate? Are we accurately representing what these players are demonstrating in their tests and activity?

From the admin perspective, can we simplify how we interpret player data? How can we oversee multiple clubs at once without the dashboard becoming congested? Can we make it easier to understand the overall picture and then focus on the club, team or player that needs attention?

These open-ended questions are meant to provide direction, not limit your creative control as you oversee this project. Use your judgment to challenge the current layout, information hierarchy and workflows. The goal is an experience that coaches and admins can understand quickly and trust.

## What we expect from the next phase

Start by mapping the shortest useful coach journey: sign in, understand player standing, identify a development area and open the supporting evidence. Determine which comparison coaches need first and what wording explains it. Validate the path with coaches before making workout prescription a primary step.

For admins, propose a concise cross-club view that makes coverage, exceptions and collection gaps easy to scan. Preserve drilldown to organization, team and player, with clear active scope and return context. Explore grouping the operational tools so they remain available without competing with player interpretation.

Consider automatic source-to-report reconciliation, explicit completeness/freshness signals and alerts only for actionable mismatches or failed refreshes. Routine healthy operation should require little manual review. Agree the reconciliation cadence, thresholds, responsible owner and recovery procedure before implementing monitoring; these are proposals, not already-live features.

Expected engineering handoff outputs are a prioritized issue list, a traceable data verification matrix, coach/admin flow proposals or prototypes, validation with representative users, and a staged implementation plan with acceptance evidence. Measure navigation effort, comprehension and reconciliation results against the current baseline; agree targets with Dylan rather than inventing them.

## Engineering entry points and release boundaries

| Area | Primary source |
| --- | --- |
| Coach shell, roster and player detail | `app/src/pages/insights/InsightsPage.tsx`, `CoachRoster.tsx`, `CoachPlayer.tsx` |
| Report presentation | `app/src/pages/insights/ExpandedReport.tsx`, `PerformanceProgress.tsx` |
| Admin shell and tools | `app/src/pages/admin/AdminPage.tsx`, `views/AdminHeader.tsx`, `views/AdminOverview.tsx`, other `views/` |
| Reporting and qualification | `functions/insights-v2.js`, `insights-v2-projection.js`, `insights-v2-qualification.js`, `effective-rep.js`, `processing-evidence.js`, `insights-axis-scoring.js` |
| Scope and comparison contracts | `docs/insights/V2_CONTRACT.md`, `docs/insights/COACH_WORKSPACE_CONTRACT.md` |
| Coach implementation | `docs/UNIFIED_COACH_WORKSPACE.md`, `docs/COACH_WORKFLOW.md` for plan/history semantics |
| Current release and feedback | `deployment/APP_FEEDBACK_PRODUCTION.json`, `deployment/homepage-baseline.json`, `docs/APP_FEEDBACK.md` |

Read `AGENTS.md`, `POSETEK_PROJECT_CONTEXT.md` and `README.md` first. Older coach navigation and release receipts are historical where superseded by current contracts. `AdminHome.tsx` is not the current admin entry.

Website reporting, frontend and related functions belong in this repository. The agent gateway lives only in `python-video-processor/Services/agent-gateway` and releases only through its canonical script from pushed main. Firestore/Storage rules live only in `PoseTek-mobile-app/firebase/` and publish only through that repository's operation. Native releases and held content/device approvals have separate owners and acceptance gates.

Ordinary production builds preserve the protected application baseline. Deliberate application releases use `node scripts/build-astro-release.mjs`, verified preview and promotion of the exact reviewed artifact, followed by baseline reconciliation. Preserve approved marketing assets, routes, current permissions, private drafts/conversations, historical workout records and the 80 held drills. Commit approved source and handoff changes to the shared website repository; keep generated artifacts, captures, dependencies, credentials and private records out of Git.

Use fixture accounts and historical synthetic logs for write-dependent acceptance. Creating current workout endings or sessions can trigger live notifications. Documentation review does not authorize prescription, activation, account changes, source-record repairs or deployment.
