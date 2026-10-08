# Development and validation

Use this with the [handbook](README.md) and [website workflow](WORKFLOW.md).
Commands run from the website repository root unless noted. Use Node 22.23.3,
Python 3.12 for policy tests, committed npm lockfiles, and a separate worktree
per change. Record the exact SHA and test output for the changed revision. A
test count from an earlier revision is evidence about that revision only.

## Daily change path

1. State the observable behavior, affected client/writer/reader, and behavior
   that must survive. Reproduce bugs before changing them.
2. Make the smallest coherent source and regression-test batch. Keep existing
   tests meaningful; never exchange them for a count target. Commit that batch
   before moving to another rewrite.
3. Run focused checks first, then the matching standing CI lane. Record real
   skips and missing prerequisites rather than substituting a mock or disabling
   a failing gate.
4. Open a PR with affected components, partner SHAs, validation, known gaps,
   compatibility order, and recovery route. A PR passing local checks still
   needs hosted evidence. The current author-merge and review policy is in
   [security and review](SECURITY_AND_REVIEW.md).

## Website standing CI

The candidate [CI workflow](../../.github/workflows/ci.yml) runs for PRs,
`main`, merge groups, and manual dispatch without path filters. Five lanes
must all succeed for aggregate `ci`; missing, skipped, failed, or cancelled
lanes fail the aggregate. Its current jobs are:

| Lane | What to run locally | What it protects |
| --- | --- | --- |
| Policy | `python -m pip install -r ci/requirements.txt`; `python -m unittest discover -s ci -p 'test_*.py'` | Workflow, review input/report, contract artifact/source, and dependency policy invariants; offline mocked tests, not remote controls. |
| Dependencies | `python3 ci/run_dependency_audit.py app --baseline ci/dependency-exceptions/app.json` and same command for `functions` and `legacy` with their files | Production high/critical advisory identity and dependency path, severity increases, exception expiry, malformed report, scanner errors. Registry access is required. |
| Unit | `npm --prefix app ci --ignore-scripts --no-audit --no-fund`; `npm --prefix app test`; `npm --prefix app run lint` | Frontend behavior and lint. Preexisting warnings remain visible; don't silently bulk fix. |
| Server | `npm --prefix functions ci --ignore-scripts --no-audit --no-fund`; `node --test functions/*.test.js scripts/*.test.cjs scripts/*.test.mjs`; `node --test ci/verify-mobile-contract-artifact.test.cjs` | Functions, scripts, release/guard behavior, and artifact verifier logic without a private partner checkout. Three historical private-fixture skips are tracked in [exceptions](EXCEPTIONS.md). |
| Build and browser | `npm --prefix app run check:svelte`; `npm --prefix app run build`; `npm --prefix app run build:marketing`; `node --test ci/check-static-firestore-transport.test.mjs`; `node scripts/check-static-firestore-transport.mjs`; `node --test scripts/browser-smoke.mjs` | Type/Svelte/Astro output, static-browser gRPC assumption, and guest Chromium navigation on the generated `app/astro-dist`. Install local Playwright Chromium only if authorized and absent. |

`scripts/browser-smoke.mjs` uses a disposable loopback preview, distinct guest
contexts, and blocks external HTTP/WebSocket requests. It proves guest flows,
not authenticated journeys or production assembly. The static Firestore
transport guard is essential while the narrowly excepted gRPC advisory is
present; an SSR/adapter change requires renewed assessment.

## Explicit integration batches

These are outside ordinary public PR `ci` because they need a private source,
local emulators, or native hardware. Run them only with the stated inputs; do
not turn missing input into a green skip.

| Batch | Source and command | Protected behavior and current limit |
| --- | --- | --- |
| Canonical mobile contract parity | Set `POSETEK_MOBILE_REPO` to the reviewed lowercase `posetek-mobile-app` checkout and record `git -C "$POSETEK_MOBILE_REPO" rev-parse HEAD`; run `node --test functions/device-performance-parity.integration.cjs`. | Dedicated assertion compares the website/server contract to canonical mobile schema and synthetic fixtures. Missing source fails. The [source artifact workflow candidate](../../ci/mobile-contract-pr-job.yml) is inactive and its ordinary PR consumer is mutable. |
| Canonical rules | Set `RULES_PATH` and `STORAGE_RULES_PATH` to reviewed mobile `firebase/firestore.rules` and `firebase/storage.rules`, select a free `RULES_PORT_OFFSET`, and run `node scripts/run-rules-tests.mjs`. | Authorization suites run against the private canonical rule bytes and verify they did not change mid-run. Requires Java/Firebase emulators; no public rule artifact. |
| Authenticated browser journey | With cached Java 21, Firebase binaries, Chromium, installed local dependencies, and exact `POSETEK_MOBILE_REPO`, run `node scripts/authenticated-emulator-smoke.mjs`. | Synthetic signup and four local Auth/Firestore/Functions/Storage emulators; exact demo project and loopback ports; no cloud credentials or live service. The harness asserts its fixed local port set is free. This is local trusted-code evidence, not a public PR gate. |
| Production assembly | Follow [release and operations](RELEASE_AND_OPERATIONS.md); use the current captured live baseline and production build scripts. | Preserves existing deployed files and proves intended additions/changes. A plain Astro build is insufficient and historic file counts must not be hard-coded. |

For local rules work, the canonical mobile checkout lives at
`/Users/happiness/src/posetek/.posetek_worktrees/posetek-mobile-app/engineering-pipeline`.
The four-emulator harness requires its exact sibling path. Choose an unused
rules offset only after checking local listeners; never kill another runner's
process to make a test pass. The [mobile build and testing guide](https://github.com/posetek/posetek-mobile-app/blob/main/docs/BUILD_AND_TESTING.md)
owns mobile-specific native and emulator detail. The [backend baseline](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/BACKEND_BASELINE_20261007.md)
owns backend suites and exact recorded results.

## Diagnosing a red lane

- First check the exact SHA, Node/Python version, lockfile and dependency
  installation. A stale `node_modules` tree can fail to load a package already
  committed in the lockfile; refresh from the lockfile, not with an upgrade.
- Browser smoke requires the current Astro output and local Chromium. Inspect
  the generated route and the blocked-network assertion before editing tests.
- For rules/emulator failures, check exact private rule paths, Java runtime,
  emulator cache, and port availability. A missing private source is a failed
  prerequisite, not authorization to copy rules into the public website.
- For dependency failures, read every reported advisory path and the matching
  exception file. Scanner error, new high/critical, increased severity, or
  expired exception is a red gate. Do not run `npm audit fix` blindly.
- For a hosted mismatch, inspect the check conclusion and uploaded logs. The
  [2026-10-07 handoff](VERIFICATION_HANDOFF_20261007.md) is local historical
  evidence; it cannot certify a newer hosted run.
