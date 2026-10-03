# Phone processing dashboard

Status: implemented and locally verified; production release verification in progress (2026-10-03).

The admin overview starts with one condensed table: installation UUID, phone type,
per-drill successful average time, largest sampled memory footprint, total frame
reads/model calls and outcomes. Selecting an installation opens a table below with
one row per drill. Detailed analytics opens that phone's session selector,
chronological run/memory charts and expandable stage measurements. The phone table
is not filtered by the shared organization/team selector. A reinstall can create
a new installation ID; equal models do not imply the same physical phone.

## Existing TestFlight data, backend-only summaries

Existing builds already upload `processing_attempts/{reporterUid}/{attemptId}/manifest.json`
and an authoritative schema-2 `processingAttempts/{attemptId}` index. This feature
reads that pipeline. A new native/TestFlight build is not required to summarize
available measurements. Older builds do not report all memory/thermal values.
The separate native `devicePerformance*` facts pipeline remains disabled in
ordinary builds and is not a prerequisite for this dashboard. Its existing source
is preserved behind the historical advanced routes, without a public navigation
link until that pipeline is operational.

`observeDeviceProcessingManifest` validates the bucket, identity/index agreement,
size and optional SHA-256, downloads the exact finalized generation, and upserts
only two server-owned roots:

| Collection | Document key | Contents |
| --- | --- | --- |
| `devicePerformanceDiagnostics` | attempt UUID | Versioned normalized runs; source path/generation; capture/session/install identity; received timestamps |
| `devicePerformanceInventory` | installation UUID | Persistent phone model/OS and first/last capture/receipt times, including phones with no current-period measurements |

Repeated/older generations cannot overwrite newer summaries. Deleted old
generations are acknowledged as superseded. Permanent invalid manifests are
rejected; missing indexes and transient failures retry. Import does not modify
original diagnostics, player reps, sessions, videos or native configuration.

`getDeviceProcessingV1` requires a non-anonymous, verified `@posetek.net` account.
Canonical Firestore rules deny direct client reads/writes to both roots, including
admins. Only the callable exposes summaries. No rules deployment is needed.

## Contract and comparisons

Request: `startDate`, `endDate` (local YYYY-MM-DD, maximum 90 days), `timeZone`,
optional installation UUID, drill, algorithm (`current`, `all`, or explicit hash),
configuration, session hash, opaque cursor, or focused run UUID.
Response schema 1 contains period/current-baseline metadata, coverage, all known
phones, comparable drill cohorts, session choices, at most 100 run-detail rows and
at most 2,000 chronological chart points. Complete-query bounds fail visibly rather
than silently returning partial averages. Cursors bind filters and data revision.
Selecting a chart point retrieves its detail page even beyond the first 100 rows.

Successful live runs determine duration/frame/call averages. Partial, failed,
cancelled and interrupted runs remain visible and counted. Drill, source/policy,
Debug/Release, frame format and timing definition form separate cohorts. The
selected phone has one drill row; distinct cohorts are separately labeled within
its cells. Missing measurements are null/unavailable, never zero. P90 is shown
only with at least 20 measured successes. Stages retain nested-versus-main timing:
nested model creation overlaps extraction and must not be added a second time.

`Processing` is the explicit processor duration. `Total run` is the separately
reported wall duration, with older start/end timing as fallback. These definitions
are never pooled. Frame reads include repeat passes and are not unique frames;
model calls describe actual inference workload. Peak memory is sampled app
footprint, not CPU/GPU load or a continuously sampled maximum. Session charts show
one point per run; uploads do not supply a continuous within-run memory trace.

Current algorithm is explicitly pinned in `functions/device-processing.js` to
source `e279f408f3d0b012a5aab25d66dc373269b85de2`, build 1.1 (31), with exact
sprint/COD/dribbling sampling schedules. Update the pin after reviewing a release;
never infer it from the largest build number. Historical phones remain listed
when they have no measurements for the current algorithm.

## Import and verification

`scripts/device-processing-backfill.cjs` defaults to a read-only plan over at most
seven days. It validates every exact object generation against its current index.
The apply command requires that reviewed plan and the identical adapter source
hash; writes only the two summary roots. Gcloud credentials stay in memory.

```
node scripts/device-processing-backfill.cjs --from 2026-10-01T07:00:00Z --until 2026-10-04T07:00:00Z --output /private/tmp/processing-plan.json
node scripts/device-processing-backfill.cjs --apply --plan /private/tmp/processing-plan.json --output /private/tmp/processing-import.json
```

Verified locally: 15 backend tests, 132 performance/frontend tests plus 28 merged feedback/navigation tests,
TypeScript, canonical-rule emulator (60 client-denial assertions), and Chromium
at 1440/1024/390/320 widths. Phone selection, detail navigation and chart-to-run
opening passed; no page errors or document-width overflow. Private source-data
checks normalized 133 cached manifests without errors. The fresh October 1–3
import plan contains 65 authoritative manifests, 64 runs, five installation IDs.

Backend functions are deployed and 65 reviewed manifests were imported. Readback
reconciles all eight current-source iPhone observations. Callable public-invoker
permission awaits explicit user approval after automatic review rejected that
IAM change. Pending: deployed callable/auth and new-upload observer acceptance,
production website artifact/browser validation. Unknown executing installations
are counted in coverage and never pooled into a fictional phone average.
The 8 new iPhone observations verify reported data only, not a controlled hardware
benchmark or a physical-device regression suite.
