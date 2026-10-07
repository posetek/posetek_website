# Unified coach workspace


## October 6 local Overview presentation decision

Kai requested removal of the **Worth reviewing** section and an always-visible
Coach Overview roster. The live and synthetic-preview source now show the roster
without a disclosure control. Kai also removed the Age and Estimated active use
columns from this roster; the underlying reporting data and other views retain
their existing contracts. Every roster row opens its player detail view; links, buttons and form controls
inside the row keep their own actions. Snapshot player links, visible reporting filters,
search, pagination, signup actions and Add player remain available. The label
**No workout status** is retained; Kai requested removal of the explanatory
sentence from the snapshot. The category still does not prove no workout occurred.
This supersedes the candidate's review-action and collapsed-roster presentation;
October 5 production receipts remain historical evidence, not changed releases.
Changes remain local pending permission to commit and push; no deployment occurs.
After this presentation change, all 1,502 frontend tests pass, TypeScript passes,
and the browser preview confirms 22 visible roster rows with no review section
or roster disclosure. The earlier rules and production-drift limits still apply.

Historical comparison presentation release: `6abb9f1e6c2c84772de67005`, source `684528b`,
published September 29, 2026 at 4:25:34 AM PDT. See the
[comparison polish receipt](../deployment/COACH_COMPARISON_POLISH_PRODUCTION.json).
The workspace foundation shipped as `6abb9834af8b9c320f64df04`, source `3e41c2a`,
with nine scoped Insights functions. See the
[production receipt](../deployment/UNIFIED_COACH_WORKSPACE_PRODUCTION.json) for
exact source, artifact, acceptance, cleanup and recovery records.

## Coach Overview follow-up (October 5, 2026)

The current website is `6ac38fde67d690075984e58b`, source `7b1aa186`, published
October 5, 2026 at 4:55:11 AM PDT. Coach Overview leads with a dated Team snapshot.
It shows the filtered reporting population and
testing/workout participation, with links to review the represented players.
The roster starts collapsed; its open state survives loading, retries, name
search, pagination, date changes and refresh. A different account or team starts
collapsed. Existing roster fields, signup actions, Add player and player links
remain available.

Overview keeps included/filtered population counts, removable active-filter chips
and Clear all filters. Review actions preserve unrelated reporting filters and
clear name search, so positive review destinations match the snapshot counts.
Zero-count actions are disabled. Name search affects roster rows, while reporting
totals and measured comparison cohorts retain their established populations.

**No workout status** means no available workout status in the selected period.
Missing records, unrecognized endings and workouts ending outside this period
can fall here, including players with recorded workout activity. The category
and filter do not assert that the player did no workout.

Coach Overview omits its former summary charts and breakdowns. Other coach tabs,
player detail and admin/manager reports retain their views. Weekly qualified
performance lines connect available results across empty weeks; the explanation
and chart data table identify weeks with no qualified result. These connecting
segments add no measurements, and different players may set successive weekly
bests.

See [the coach Overview release handoff](COACH_OVERVIEW_RELEASE.md) for source
provenance, validation and recovery, and [the verified publication receipt](../deployment/COACH_OVERVIEW_PRODUCTION.json).
The September 29 receipts
above remain historical evidence of the workspace foundation and comparison
presentation.

## Product and design contract

Team Insights is the coach workspace. Organization coaches select only their
currently assigned teams; independent coaches use their existing permitted
roster. Overview begins with a team snapshot and review cues, followed by the
collapsible roster and Add player flow. Testing, Workouts and Active use tabs
hold the detailed reports, keeping those secondary charts off the Overview.
Testing, Workouts, Active use and Community share the same shell. Opening a
player adds one named tab inside the workspace; selecting another player replaces
that tab. Browser history, selected dates, roster search and planner return links
retain their context. Presentation-only tab changes keep the current report and
player history mounted; changing account or scope invalidates stale callbacks.

The roster shows Player, recorded Age, Testing, Workouts completed, Estimated
active use and existing signup actions. Team and division remain useful report
filters but are not redundant roster columns. Existing signup links and codes
are copied without rotation; missing invitations retain their generation action.
The existing Add player flow remains available inside Overview.

Player details include measured team/roster percentiles, the existing plan and
workout history, individual Stats and published personal workouts. Missing or
insufficient comparisons are labeled, never presented as zero. Private AI
conversations and unpublished workouts remain private. Prescribe workouts opens
the existing planner with the selected player and a validated workspace return.
The coach header contains branding and Sign out; the planner contains
Organization (return to the workspace) and Sign out.

The player comparison pairs the radar with one position track per skill and a
readable percentile label. The 50 guide marks the midpoint of the percentile
scale; 100 means the highest relative position, not a perfect test score. Each
skill retains its own measured-player count. Missing results and groups with
fewer than two measured players remain unavailable, never zero. Detailed
comparison rules expand in place. Phone layouts prioritize the skill positions
before the radar. This presentation does not change scoring, cohorts or access.

Community is embedded with the established Insights colors, spacing, cards and
typography. Activity, Find people and Sharing settings retain the existing social
API and authorization. Independent coaches without a social organization see an
accurate unavailable state. Admin previews and ordinary player navigation retain
their existing boundaries. Compatibility links through `/roster`, `/dashboard`,
`/coachesview.html` and coach `/feed` converge on the workspace.

The user selected a full-site Astro migration. Astro owns the Players, Coaches
and application document builds; existing React application interactions and
Svelte demonstrations remain intact. The visual reference is the established
Team Insights theme, informed by the requested
[Astra frontend design skill](https://github.com/Enixes/astra-frontend-design)
and [Astro](https://astro.build/). This is not a redesign of public marketing or
the athlete experience.

### Coach overview snapshot

The team sentence follows the four-answer template: players improved since their
last dated test, players keeping up with training, and players who need a coach.
The snapshot shows an alphabetized list of flagged players with links to their
records and reasons in link titles. Included/filtered counts, active-filter chips
and Clear all filters remain visible on Overview. Review actions preserve unrelated
filters, clear name search and disable zero-count destinations.
“Improved” means an increase greater than two points; a change within two points
is **Same**. D1 uses qualified server-projection metrics with the athlete profile's
best-per-metric and mean-per-axis method. Comparison uses each player's latest two
local test dates.

Each roster row shows the player's D1 percentage and level, change with ▲/▼ in
points (or **Same** within two), completed sessions out of planned sessions in the
rolling 14 days, and a concise follow-up reason. Planned counts use confirmed
weekly training days when recorded; otherwise they use the plan's sessions-per-
week frequency over active plan days. Completed counts match recent logs to the
current active plan's workout slots. The summary's “keeping up” denominator is
players with a usable active-plan target; keeping up means at least half of that
target was completed.

“Needs you” reasons are: no sign-in recorded when an active plan is at least three
days old; fewer than half the planned sessions after an active plan is at least
seven days old; or a D1 drop of five points or more. These are follow-up prompts,
not diagnoses. Need-you players sort first, then names alphabetically, with
untested players last after the priority grouping. Desktop rows stay on one line;
phone rows use two lines. Existing signup actions remain in the final column. The
roster remains collapsible and starts closed as previously requested.

### Named-player one-screen summary

The player view leads with a template sentence answering current D1 standing and
level, change since the latest dated test, current plan cadence/week and any
player-specific follow-up signal. Six measured tests (shooting, sprint, vertical
jump, broad jump, agility and dribbling) use bars against the D1 100% reference;
each shows its latest score and point change from the preceding dated test. The
plan line shows sessions per week and week X of Y. The session strip shows the
six most recent completed or ended-early logs and missed sessions only when the
active plan has a confirmed weekday schedule. Plan focus, any recorded coach note
and the next scheduled test date appear together. If a note or date is absent,
the page says it is not recorded/scheduled rather than inventing one. Team
comparison and complete editable/history records remain in a secondary section
below the summary.

The report adds only aggregate scores and per-player counts/reasons. It reads
active plan summaries and recent plan logs server-side, rechecks those snapshots
in the response transaction, and never returns raw plan or workout documents.
Profile `lastLogin` is used only to show **No sign-in recorded**; it is not a
claim about current account access. The specification's noted workout skip-reason
rules issue belongs to the canonical mobile rules repository, not this website;
no rules or raw workout-history permissions change.

## Backend and source

See [the coach reporting contract](insights/COACH_WORKSPACE_CONTRACT.md) for
current membership checks, measured scoring, age sources and projection version 4.
The release extends the guarded [Expanded Insights deployment](../deployments/expanded-insights/README.md)
with `getCoachPlayerComparison`. All nine scoped functions share the same prepared
source; `recordInsightUsage` retains its behavior. No gateway, canonical rules,
native UI or training-content activation is part of this adjustment.

The source includes the previously deployed workout email alerts branch, which
was ahead of GitHub main when this work began. Preserve that workflow and its
separate notification deployment codebase. Verification must not create current
workout endings or web-observed workout sessions unless notification delivery is
explicitly part of the test. Historical synthetic logs predate the activation
cutoff and are removed with all verification data.

## Build, verification and release

Use Node 22.19 or later in the Node 22 line. Install with `npm --prefix app ci`.
`npm --prefix app run dev:astro` starts the migrated framework; Vite remains a
compatible development option for application previews. Generated Astro output
is ignored at `app/astro-dist`.

An ordinary `node scripts/build-production.mjs` build retains the production
application baseline. A deliberate full-site release uses
`node scripts/build-astro-release.mjs`; it verifies the live baseline, adds
content-addressed assets and replaces only the three declared entry documents.
Existing unrelated files remain checksum protected. Review `production-dist`,
deploy an explicit PoseTek-site draft, verify it, then promote that exact draft
without rebuilding. Reconcile the baseline only from verified production
inventory. Never rely on a checkout's default Netlify site association.

Required acceptance covers organization and independent sign-in, assigned-team
boundaries, search/pagination, missing ages, player comparison and workout reads,
planner return context, Community panels/deep links, legacy aliases, history and
mobile layouts. Public marketing, athlete navigation, signup, staff activation
and admin routes need smoke coverage after the framework migration. Live checks
use isolated temporary accounts with journaled cleanup. The production receipt
records the completed checks and their limits.

## Recovery

Retain the reviewed Netlify predecessor and scoped function source/IAM backups.
Restore only an audited release through the existing guarded workflows; never
revert user records or projections as a source-code rollback. Old report clients
remain compatible with the additive scope and comparison API. The canonical
rules, notifications, gateway and native releases have separate owners and
receipts.


## Local test repair and verification (October 6, 2026)

This remains an unpublished candidate on `codex/kai-work`. The test repair retains
its D1/training summaries and restores the confirmed review destinations, visible
population filters, recorded-age column, and account/team-bound roster disclosure.
“No workout status” remains distinct from recorded activity. Snapshot render tests
use a router because player names now link to the player view.

The shared Firestore fake retains `in`, bulk reads and transaction read-before-write
checks while supporting timestamp/date range comparisons. Overview regression
fixtures cover active versus draft plans, unique assigned workout slots, confirmed
weekdays, local test dates, missing/duplicate/failed results and follow-up thresholds.
Roster cursor fingerprints include training snapshots and performance summaries;
a changed plan target or sign-in-based follow-up ordering requires a fresh page.

Validation: 1,504 frontend tests; 701 backend passes with three existing private
fixture skips; 132 release-tool tests; TypeScript; Svelte (zero errors/warnings);
and the local Astro build. Tests use local fixtures, with no production writes.
The run used Node 25.9.0; release guidance still requires Node 22.19+ in the Node 22
line. Firebase functions dependencies were installed from the existing lockfile.

Two verification limits remain explicit: the canonical mobile rules checkout is
absent, so `run-rules-tests.mjs` cannot start; and the network-enabled ordinary
production build detects live application drift from `homepage-baseline.json`
and stops. No baseline reconciliation, guard bypass, rule change or deployment
was performed. Local test success does not establish release readiness. Commit
and push require Kai's approval for this candidate.
