# Team testing performance

Status (2026-10-03): backend deployed and source-verified; 238 manifests imported
into summary version 2. The website draft `6ac1911a5b925767ec7362b8` is built and
verified, with 1,596 provider inventory records and zero artifact mismatches.
Production is unchanged. The existing callable invoker approval and authenticated
browser acceptance remain pending; this page does not bypass them. Exact evidence
and the remaining release step: [release receipt](../deployment/TEAM_SESSION_PERFORMANCE_DRAFT.json).

## Admin workflow

Device performance links to `/admin/device-performance/team-sessions`. Select a
recent testing event to open `/admin/device-performance/team-sessions/{eventId}`.
The page retains all three stations, assigned and previously observed phone IDs,
phone models, all rostered players and the event-specific rep targets (including
participant overrides). Live snapshots refresh every 30 seconds while visible,
after the previous request completes. A failed refresh retains a labeled stale
snapshot. The 50 most recently created events are listed; saved links open older events.

The shared time chart switches between processing duration, total-run duration,
thermal state at run end, sampled peak memory, frame reads and model calls.
Drill/source filters apply to this chart and the run table. Each point opens the
matching table page. Station colors remain consistent; phone changes do not move
historical runs onto the currently assigned phone. Stages are available per run.

Throughput and failures remain event-wide across all live-capture drills/versions.
The throughput graph is a cumulative step chart per station. A successful logical
rep counts once, at its earliest valid reported terminal timestamp. Partial,
failed, cancelled, unfinished and reprocessing runs do not increase throughput.
Missing rep IDs or completion times are excluded and reported as coverage gaps.
The reps/min figure uses the displayed event time window, including rotation and
other gaps; it is not CPU utilization or an estimate of pure compute throughput.

Progress/synced counts are separate from diagnostics: unique rep IDs in station
progress are checked against the event's committed-rep records. They are not
placed on the phone processing timeline because committed timestamps can change
on later Firestore rep updates. Planned work comes from the same `effectiveStations`
helper used by the operational testing-event backend. Each player has a row across
all three stations, showing completed/planned work and synced counts.

A missing terminal outcome is pending, not a proven crash. Only `interruptedAt`
marks an interrupted processing run. Failure markers use terminal time where
available, otherwise the labeled run-start time. Capture interruptions use their
capture-start time, explicitly labeled; their actual interruption time is unavailable.
Unknown installation IDs, unprocessed attempts, stale summaries, missing metrics
and reprocessing are shown in reporting coverage. Phone clocks drive run timing;
future/unreliable run dates are not plotted. Thermal state is ordinal, not degrees.
Memory is one sampled peak per run. Lines are observation guides; gaps are not
continuous measurements. CPU load, battery temperature and queue-wait time are
not available from the current payloads.

## Data and access

The existing `getDeviceProcessingV1` callable accepts `{view:"teamSessions"}` for
the list and `{view:"teamSessions",eventId}` for one event. Its verified,
nonanonymous `@posetek.net` administrator guard is unchanged. It reads:

- `testingEvents/{eventId}` and its participants, stations, progress and committedReps.
- `processingAttempts` indexed by exact `testingEventId` (single-field query).
- `devicePerformanceDiagnostics/{attemptId}` with reporter/player/path checks.

No phone-name, date-proximity or session-number heuristic joins players together.
The attempt index supplies exact event/station/rep membership even for older
summaries. Normalizer summary version 2 additionally preserves these identities
and `terminalAt`, checking manifest identities against the index. Same-generation
imports upgrade version 1 once; older object generations can never overwrite a
newer one. Original uploads, athlete results, event progress and assignments are
read-only for this feature. No new native build, rules, indexes or endpoint is needed.

Reads are bounded at 30 participants, 3 stations, 90 progress rows, 900 committed
reps, 1,500 attempts, 2,000 runs, 32 MiB decoded summaries and 2 MiB response size.
Oversized events fail explicitly; totals and charts are never silently truncated.
The run table pages locally by 50 without changing event totals. All production
reads stay authenticated; DEV-only synthetic preview data never substitutes for
an API failure. Organization/team navigation selectors do not filter this admin
operational report; the selected testing event defines the roster.

## Verification

- Backend: 29 focused tests passed (18 diagnostic adapter + 11 team reports).
- Frontend/navigation: 18 focused tests passed.
- TypeScript project build passed.
- All 133 cached real manifests normalized with the extended identity checks.
- Read-only report queries against five actual Firebase events passed, including
  a four-player event with incoming runs and an older four-player rotation.
  This verifies report logic/data shape, not browser callable reachability.
- Chromium: navigation from Device performance, 3 phone cards, 4 players, six
  metric switches, drill filtering, chart-to-table pagination, failure-to-row
  navigation and 1440/1024/390/320 widths passed; no page errors/outer overflow.
  Desktop/mobile screenshots visually reviewed.

Deployed callable version 4 and observer version 2 passed exact 16-file source
verification each; all 122 other functions are unchanged. Observer source is
`5d4185b`, callable and website source `dabd60c`; their normalizer bytes are identical.
The observer does not execute the later report-only reliability guard. The import
accepted all 238 manifests (235 runs, eight known installations), modifying only
derived summaries/inventory. Post-migration reads found no diagnostic coverage gaps
in the active four-player event; the older four-player rotation has 64 reported
runs and retains unavailable memory/processing-only timing from its older builds.
Hosted unauthenticated and preview-bypass gates passed, as did feedback header
checks. No genuine authenticated callable/browser acceptance has been claimed.

Production web acceptance and promotion remain pending the existing explicit
invoker approval. Do not claim the DEV synthetic preview is the live event view.
The local preview is `/admin/device-performance/team-sessions/demo-team-rotation?preview=1`.
