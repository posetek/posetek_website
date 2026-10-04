# Team testing performance

Status (2026-10-03): the user approved callable reachability, the binding is active,
and genuine authenticated requests have returned HTTP 200. The local dashboard
uses live Firebase data. The completeness/station-timing follow-up is prepared;
see the current receipt for deployment verification. Older Netlify drafts are
superseded and must not be promoted over concurrent production changes.

## Admin workflow

Device performance links to `/admin/device-performance/team-sessions`. Select a
recent testing event to open `/admin/device-performance/team-sessions/{eventId}`.
The page retains all three stations, assigned and previously observed phone IDs,
phone models, all rostered players and the event-specific rep targets (including
participant overrides). Live snapshots refresh every 30 seconds while visible,
after the previous request completes. A failed refresh retains a labeled stale
snapshot. The 50 most recently created events are listed; saved links open older events.

The shared time chart defaults to All timing (filled processing points, hollow legacy total-run points), and switches between processing duration, total-run duration,
thermal state at run end, sampled peak memory, frame reads and model calls.
Drill/source filters apply to this chart and the run table. Each point opens the
matching table page. Station colors remain consistent; phone changes do not move
historical runs onto the currently assigned phone. Stages are available per run.

Throughput and failures remain event-wide across all live-capture drills/versions.
The throughput graph is a cumulative step chart per station. An accepted protocol rep counts once, at its earliest prepared terminal timestamp.
Prepared partial measurement results consume a protocol slot and increase this
operational throughput. Failed, cancelled, unfinished and reprocessing runs do not.
Valid-result and all-processed unique completions remain separate report fields.
Missing rep IDs or completion times are excluded and reported as coverage gaps.
The reps/min figure uses the displayed event time window, including rotation and
other gaps; it is not CPU utilization or an estimate of pure compute throughput.

Progress/synced counts are separate from diagnostics: unique rep IDs in station
progress are checked against the event's committed-rep records. They are not
placed on the phone processing timeline because committed timestamps can change
on later Firestore rep updates. Planned work comes from the same `effectiveStations`
helper used by the operational testing-event backend. Each player has a row across
all three stations, showing completed/planned work, synced counts and per-player elapsed time.

Station cards show average time per completed player, median/range and sample
coverage. The measured interval begins at the first reported capture attempt
(including capture interruptions) and ends at the earliest prepared completion of
the last accepted rep. Every accepted rep needs terminal evidence and the player
must have completed the station; incomplete coverage stays unavailable. Pauses
between reps remain included. Station entry, initial setup and queue waiting are
not recorded and cannot be reconstructed from progress.updatedAt.

Each station card lists every drill's average completed processing duration,
including valid and partial results, with sample counts and quality counts.
Failed-run duration remains separate. Source revision, installation, configuration,
frame format and timing definition remain separate groups. Phone links open the
full default 90-day history, not only the selected event's date. Station recording
UUIDs map to execution installation UUIDs only through exact attempt identities.

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

The October 3 completeness audit reconciled all 315 existing Storage manifests
with their exact derived source generations. They contain 310 processing runs,
269 attributed to nine installation identities (six recent phones plus three
historical identities), and 41 inspectable unattributed runs. Of 412 Firebase
attempt indexes, 97 older records have no current manifest, retained deleted
manifest, or summary. They remain explicitly listed as missing diagnostic evidence.
Two sampled corresponding athlete reps retain athletic results but no processor
telemetry; athletic drill time is never substituted for processing duration.

The current four-player event contains 83 attempt indexes, 81 processing runs,
80 accepted/synced protocol reps, 52 valid measurement results and 29 partials.
All 81 have processing, memory, thermal and terminal-time evidence. Per-station
run counts are 12/29/40; protocol counts are 12/28/40. Station 2 includes one extra
processed attempt. All 12 player/station intervals have complete timing. One
Station 2 interval includes a long pause, so its mean and median differ markedly.

Focused checks cover backend aggregation, identity, missing evidence, default
history, partial timing, per-player intervals and frontend charts/cards. Chromium
checks include all metric tabs, point-to-row navigation and 1440/1024/390/320 widths.
See the completeness release receipt for exact command results and live version.
The existing synthetic preview is isolated and labeled; it is never a live-data
fallback. No new TestFlight build, rules or production player-data writes are needed.
