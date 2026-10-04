# Phone processing dashboard

Status (2026-10-03): live callable reachability approved and enabled; authenticated requests succeed. Local dashboard completeness and station-timing follow-up verified with deployed callable v5. See the [verification receipt](../deployment/DEVICE_PROCESSING_COMPLETENESS.json). Older website drafts are superseded.

The admin overview starts with one condensed table: installation UUID, phone type,
per-drill completed-processing average time, largest sampled memory footprint, total frame
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
configuration, session hash, opaque cursor, or focused run UUID. Defaults are the
last 90 days and all recorded algorithms. Explicit algorithm filters show an
exclusion notice. Unattributed runs are available with `unattributed:true` instead
of an installation UUID; each run is inspectable, without a combined phone average.
Response schema 1 contains period/current-baseline metadata, coverage, all known
phones, comparable drill cohorts, session choices, at most 100 run-detail rows and
at most 2,000 chronological chart points. Complete-query bounds fail visibly rather
than silently returning partial averages. Cursors bind filters and data revision.
Selecting a chart point retrieves its detail page even beyond the first 100 rows.

Completed live processing (valid and partial measurement outcomes) determines
duration/frame/call averages. Failed durations and valid-only durations are
separate distributions; cancelled/interrupted runs remain visible and counted. Drill, source/policy,
Debug/Release, frame format and timing definition form separate cohorts. The
selected phone has one drill row; distinct cohorts are separately labeled within
its cells. Missing measurements are null/unavailable, never zero. P90 is shown
only with at least 20 completed measurements. Stages retain nested-versus-main timing:
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
seven days, or all bounded indexed attempts with `--all-indexed`. Add
`--only-missing` to inspect summary gaps. It validates every exact object generation against its current index.
The apply command requires that reviewed plan and the identical adapter source
hash; writes only the two summary roots. Gcloud credentials stay in memory.

```
node scripts/device-processing-backfill.cjs --from 2026-10-01T07:00:00Z --until 2026-10-04T07:00:00Z --output /private/tmp/processing-plan.json
node scripts/device-processing-backfill.cjs --apply --plan /private/tmp/processing-plan.json --output /private/tmp/processing-import.json
```

All 315 available manifests reconcile with their exact summary generations and
310 runs. All six recent phones are visible by default, alongside older installation
identities. All known-phone charts/detail pages and the 41 unattributed runs were
reconciled by run ID. The report also joins period indexes and explicitly lists
97 historical attempts without diagnostic summaries; their manifests are absent
from current and retained-deleted Storage objects. No measurements are fabricated.

The user explicitly approved `allUsers` / `roles/cloudfunctions.invoker` for the
single reporting callable after the earlier automatic rejection. This transport
setting is active; the handler still requires verified nonanonymous PoseTek admin
authentication. Genuine authenticated requests returned HTTP 200, while unsigned
requests receive Firebase JSON 401 with the proper CORS response.

The local dashboard at `http://127.0.0.1:4175/admin/device-performance` reads live
Firebase and refreshes every 30 seconds while visible. No preview query is needed.
Synthetic design previews remain DEV-only, never a fallback. No new TestFlight
build is required. Source changes are committed through the feature-branch merge
workflow; no remote push is authorized. This follow-up does not promote an older
Netlify draft over the concurrently updated production website.

## Team sessions (2026-10-03)

The event-level dashboard is linked from Device performance. It uses the same
callable and normalizer (derived summary version 2), with exact team-event,
station, player and logical-rep joins. See [team session performance](TEAM_SESSION_PERFORMANCE.md)
for metrics, throughput semantics, limits and verification.
