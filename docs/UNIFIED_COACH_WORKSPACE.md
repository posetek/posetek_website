# Unified coach workspace

## Product and design contract

Team Insights is the coach workspace. Organization coaches select only their
currently assigned teams; independent coaches use their existing permitted
roster. Overview begins with the roster, followed by the existing report.
Testing, Workouts, Active use and Community share the same shell. Opening a
player adds one named tab inside the workspace; selecting another player replaces
that tab. Browser history, selected dates, roster search and planner return links
retain their context.

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
records actual checks and any limits; this document does not claim deployment.

## Recovery

Retain the reviewed Netlify predecessor and scoped function source/IAM backups.
Restore only an audited release through the existing guarded workflows; never
revert user records or projections as a source-code rollback. Old report clients
remain compatible with the additive scope and comparison API. The canonical
rules, notifications, gateway and native releases have separate owners and
receipts.
