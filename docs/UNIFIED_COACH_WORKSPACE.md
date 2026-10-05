# Unified coach workspace

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
roster. The historical September 29 Overview began with the roster, followed by
the existing report; the October 5 follow-up above supersedes that presentation.
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
