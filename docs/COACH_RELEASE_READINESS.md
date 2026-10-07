# Coach release readiness

## Current release boundary

The current production website remains `6ac5ac30bb13dae95443c2b4`, the verified
admin hierarchy release. Read [its handoff](ADMIN_HIERARCHY_REPORTING.md) and
[production receipt](../deployment/ADMIN_HIERARCHY_REPORTING_PRODUCTION.json).
The integrated coach follow-up and current alignment work are source candidates;
this document does not claim a new website or backend deployment.

The exact reviewed candidate is
[`6ac689898fa88638f4bfc99f`](https://6ac689898fa88638f4bfc99f--posetek.netlify.app/insights),
runtime source `9a9124abaf4f3faa61bbae695b83123d076aec93`, in
[PR #38](https://github.com/posetek/posetek_website/pull/38). Read
[the candidate evidence](../deployment/COACH_RELEASE_READINESS_CANDIDATE.json).
Its complete 1,825-file artifact matches 1,826 provider records; 1,809 unrelated
predecessor provider records remain exact. Only the application document and
generated provider metadata change among predecessor records, with fifteen
runtime assets added. The protected production baseline is unchanged.

The open preview chat independently accepted this exact source, phone/desktop
layouts, roster/player agreement, keyboard interaction and filter/history returns.
Its public hosted review verified sign-in return destinations, marketing, stable
icons and isolated feedback bytes/dependencies without submissions. Owned signed-in
hosted acceptance passed 24 checks with thirteen captures and no unexpected or
console errors or application writes. It verifies assigned-coach UI sign-in,
independent/player authenticated sessions, scope denials, existing signup copying,
prescription selection/return and settled Activity/People/Sharing panels. Both
delayed cleanup audits found zero owned documents or Auth accounts; private
verification credentials were removed.

These hosted checks used the current legacy backend. Its absent new summaries
correctly display unavailable states; this is not live acceptance of the new
additive contract. The nine-function package is prepared and its actual SDK
discovery passes. Fresh final readback preserved all 124 regional function records
and all nine scoped IAM policies. Dylan's preview review, scoped backend deployment
and live additive-response acceptance precede exact-artifact website promotion.

The coach workspace continues to use Team Insights as its reporting home, with
Overview, Testing, Workouts and Community in the shared shell. The follow-up keeps
the Overview roster open, removes its separate Worth reviewing section, omits Age
and Estimated active use columns from that roster, and makes player rows open
player details while preserving each nested link, button and form control.
Signup links/codes, search, reporting filters, pagination, Add player, prescribing,
team comparisons and complete player records remain available. See
[Kai's handoff](KAI_DASHBOARD_HANDOFF.md) and
[the coach workspace contract](insights/COACH_WORKSPACE_CONTRACT.md).

The readiness pass aligns missing-response presentation, scoring explanations
and the deployable function bundle. `insights-overview.js` is now included in the
prescribed fifteen-file immutable source package. Preparation and verification
reject an incomplete local dependency closure. The copied-source SDK integration
test discovers exactly the nine functions and verifies their pinned runtime and
trigger definitions. No source profile, measured result, plan or workout history
is repaired by this readiness work.

## Reporting definitions

Overall D1 standing uses **cumulative best qualified measurements through the
selected reporting end**, capped at report generation time. It uses the unchanged
athlete-profile benchmark specification: best qualifying value per metric,
normalized by that metric's reference and direction, then the mean of available
metrics per axis and the mean of measured axes. The reporting start does not
discard an earlier best measurement from this standing. This is a benchmark
percentage, distinct from the player's percentile within a team or roster.

Change since the last test uses a different time basis: each player's latest two
local test dates, in the selected reporting timezone, through the same end.
Each date's score uses only qualified measurements on that date. Subtract the
previous date's score from the latest date's score and report the rounded point
change. A change within two points displays Same; improvement counts require
more than two points. Missing a second scored date leaves change unavailable.
Per-test trend summaries use the same latest-two-date principle. Failed,
unqualified, duplicate, provisional, undated or future observations do not become
measured scoring facts.

Training answers **how the current active plan is progressing in the last
14 days at report generation time**. It is not a historical total tied to the
selected reporting start/end. Planned sessions use the current plan's timezone,
start date and a rolling fourteen-calendar-date window, clipped to days since the
plan started. A usable confirmed weekday schedule counts those actual weekdays;
otherwise a usable sessions-per-week frequency estimates the target over active
plan days. Invalid timezone/start/frequency evidence leaves the target unavailable.

Done sessions count distinct current-plan workout slots with valid completed
endings in the rolling fourteen-day absolute-time window through generation time.
Foreign plans, adhoc workouts, malformed identifiers, early endings and future
endings do not inflate that count; authored workout slots also constrain matches
when present on the plan. The team keeping-up denominator is
players with a usable positive planned target. Keeping up means completing at
least half that target. No active plan or an unavailable target is distinct from
a valid target with zero completed sessions.

Follow-up reasons retain their defined thresholds: no recorded `lastLogin` when
an active plan is at least three days old; fewer than half of planned sessions
when that plan is at least seven days old; or a rounded D1 drop of five points or
more. These are recorded-data review prompts. Missing sign-in evidence does not
prove an account cannot sign in or identify a verified person.

## Missing information and compatibility

The additive `overview` object, per-player `performance`, player-name lists and
per-test trend summaries may be absent while an older backend is serving. Display
an unavailable state for the absent summary. Do not substitute zero totals, None
or no follow-up needed. An available empty list may display None; an absent list
must remain unavailable. Existing period-based participation, testing, workout
and usage data retain their own reporting definitions.

A missing score, unavailable change, unrecorded age, insufficient comparison,
missing active plan and missing collection coverage remain separate states.
Missing measurements do not become zero. Team percentile requires at least two
measured players on the relevant axis and does not expose peer raw results.
Unknown training/calendar evidence does not become a promise of zero planned
sessions. The earlier No workout status category does not prove no workout
occurred; an available activity status takes precedence.

## Validation and release gates

The focused readiness validation has passed 24 immutable-package tests, including
actual copied-bundle Firebase SDK discovery, 30 shared-publisher regressions and
39 focused Insights tests. These are local checks, not production acceptance.
Full frontend/backend, canonical rules, parity, TypeScript/Astro and release-guard
checks belong to the combined source's final acceptance record. Earlier reports
of unavailable Firebase CLI or a mobile contract discrepancy must be reconciled
explicitly rather than treated as successful checks.

October 7 combined-source validation: 1,863 frontend tests, 67 focused Insights
tests, 55 release guards and 1,043 canonical rules assertions passed. TypeScript,
Svelte (zero errors/warnings), scoped quiet lint and the guarded Astro application
build passed. The build verifies all 1,808 protected predecessor files and retains
1,807 exactly in the candidate, changing only the application document and adding
15 runtime assets; marketing and isolated feedback remain byte-identical.

The full functions suite records 991 passes, one failure and three existing
optional private-history skips. The failure is in
`legacy-upload-processor/repair-guard.test.cjs:164`: unchanged legacy upload routing
also fails alone, with both source and test identical to baseline `571bdbd`.
That processor is outside this nine-function publication. It is not represented
as a passing check or included in the release scope.

The standalone parity review is closed against canonical mobile `a2928a0`.
All ten other source hashes and the web benchmark remain identical. The gateway
contract document adds 310 voice-only lines: three changelog rows and section 17.
Existing sections 1–16 are unchanged. Web/Insights source does not send the new
voice route or voice-context fields; default-disabled gateway-first native voice
gates remain intact. Only the reviewed document hash, mobile commit and review
date in `mobile-parity.json` are updated following that semantic review. The
eleven-source parity check now passes; this approves no native/voice release.

Read-only preparation captured all 124 regional functions and the exact source,
configuration and IAM of the nine scoped functions. Fifteen immutable source
files, complete local dependency closure, isolated dependency installation and
copied-bundle SDK discovery passed. The short-lived operator credential was
removed. This capture supports readiness; a fresh inventory/IAM check and live
acceptance are still required at deployment.

1. Reconcile current GitHub main, actual production and the open Kai preview
   chat before freezing source. Preserve teammate changes and their independent
   release gates. Commit and push the reviewed website/function source without
   generated builds, captures, dependencies, credentials or private evidence.
2. Use a fresh ignored preparation and the
   [prescribed expanded-insights publisher](../deployments/expanded-insights/README.md).
   Deploy the exact nine-function scope together. Verify all source bytes,
   prepared dependency closure, runtime limits, trigger resources/retries,
   callable transport labels and IAM, and unrelated-function preservation.
   The new additive responses must pass live synthetic acceptance before the
   matching website is promoted. No project-wide function deployment is allowed.
3. Build the guarded Astro application with freshly verified marketing
   preservation, isolated feedback and stable icon bytes. Review a fresh hosted
   candidate at 360/390/430px and desktop. Verify keyboard/focus behavior, player
   rows and nested actions, signup copying, scope/date/search/pagination returns,
   current-plan summaries and unavailable responses with owned synthetic data.
4. Verify admin, manager, assigned-team and independent-coach authorization,
   transfer/revocation denials, complete roster/cohort calculations and current
   server readback. Never widen scope to conceal missing data. Keep feedback,
   workout generation/start and live notification delivery outside verification
   writes unless separately required and explicitly isolated.
5. Promote the exact reviewed artifact, then verify production again. Clean all
   owned temporary Auth accounts, profiles, memberships, invitations/indexes,
   projections, synthetic history/storage and asynchronous deletion records.
   Perform delayed independent zero-residue readback, reconcile the preservation
   baseline, run its ordinary build guard and merge source plus confirmed release
   records into GitHub main.

Rules and Storage policies remain owned by the canonical mobile repository;
the gateway remains owned by the canonical backend repository. This website
adjustment does not deploy either, change native UI, approve the eighty held
drills or remove device/content/replay/diagnostics acceptance gates. Existing
active plans, coach assignments, private drafts/conversations and real athlete
evidence remain preserved. A production receipt must record actual versions and
acceptance before these candidate changes can be described as live.
