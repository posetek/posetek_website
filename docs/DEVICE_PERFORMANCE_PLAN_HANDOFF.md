# Device performance (plan 07) handoff

**Status:** ready — implementation authorized 2026-09-29, not started. Nothing in
this repository implements it yet; no function, index, route or rules change has
been written, deployed or verified.

This is a pointer, not the plan. The canonical plan lives in the mobile
repository at
`PoseTek-mobile-app/docs/plans/PROCESSING_PERF_07_DEVICE_PERFORMANCE_OBSERVABILITY_AND_ADMIN_PLAN.md`,
indexed by `PoseTek-mobile-app/docs/plans/PROCESSING_PERFORMANCE_SERIES_INDEX.md`
(plans 01–08); execution is tracked in the mobile `docs/ROADMAP.md`. Where this
summary and the canonical plan differ, the plan wins; where either differs from
the code, the code wins.

## What plan 07 asks of this repository

- **Ingestion:** `ingestDevicePerformanceV1` in `functions/device-performance-ingestion.js`,
  exported explicitly from `functions/index.js`. It validates schema, bounds and the
  authenticated original reporter; an install ID is never authorization.
- **Projection:** `functions/device-performance-projection.js` builds complete,
  versioned reporting pages from the latest attempt/run/upload-group facts.
- **Read API:** `functions/device-performance.js` with `getDevicePerformanceV1`,
  `getDevicePerformanceDetailV1`, `getDevicePerformanceAttemptV1` and
  `setDevicePerformanceLabelV1`, admin-only through the verified `@posetek.net` predicate.
- **Admin routes:** lazy `/admin/device-performance` and
  `/admin/device-performance/:installId`, rendered by `DevicePerformance.tsx` and
  `DevicePerformanceDetail.tsx` with an attempt drawer. This adds an eighth admin tab;
  the navigation test currently asserts seven.
- **Indexes:** only the required transfer/detail composites, in `firestore.indexes.json`.
- **Rules tests:** the proposed server-only `devicePerformance*` roots deny every direct
  client read and write; assert that with `node scripts/run-rules-tests.mjs` against the
  canonical mobile `firebase/` rules.

## Binding measurement definitions (plan 07 §3)

- **Time to result:** movie finalized → durable local result accepted.
- **Processing time:** admission granted → processor operation returned.
- **Ready for next rep:** capture stop requested → next gate/capture ready.
- **Cloud save time:** result job enqueued → required artifacts and Firestore commit acknowledged.
- **Waiting to upload:** logical upload queued → first actual transfer start.
- **Upload duration:** one Storage task / PUT invocation start → terminal callback.
- **Effective upload speed:** successful payload bytes ÷ that invocation's elapsed seconds (MB/s).
- **Save confirmed after recording:** movie finalized → required cloud commit, same clock only.
- **Processing failure rate:** failed ÷ (valid + partial + invalid + failed) terminal runs.
- **Usable-result yield:** attempts with an accepted primary metric ÷ finalized retained attempts.
- **Typical / Slow:** median / p90 of pooled observations; **Limited data** below 20 samples.

Missing observations are null with a reason, never zero.

## Release order

After separate implementation and release authorization:

1. Backend ingestion/reporting functions and required indexes.
2. Canonical rules publish from the mobile repository, only if rules changed.
3. Pilot phone build.
4. Admin draft preview.
5. Authorized website promotion and app distribution.

## Rules ownership

This repository never publishes rules. Firestore and Storage rules live only in
`PoseTek-mobile-app/firebase/` and are published only by
`python firebase/operations.py publish` there (see `AGENTS.md` § Firebase rules).
The website deploys named functions and indexes only; application releases use
`scripts/build-application-release.mjs`. No gateway change is needed.

## Expected validation during implementation

`node --test functions/device-performance*.test.js`,
`node app/node_modules/typescript/bin/tsc -b app`, focused
`npm --prefix app test -- …` and `node scripts/run-rules-tests.mjs`; the canonical
`npm --prefix firebase test` in the mobile repository if rules change. Confirm the
script names on the implementation tree before running them.
