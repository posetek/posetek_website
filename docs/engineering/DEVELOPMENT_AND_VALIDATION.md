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

The merged [CI workflow](../../.github/workflows/ci.yml) runs for PRs,
`main`, merge groups, and manual dispatch without path filters. Five lanes
must all succeed for aggregate `ci`; missing, skipped, failed, or cancelled
lanes fail the aggregate. [PR #42](https://github.com/posetek/posetek_website/pull/42)
passed all six hosted check conclusions, including aggregate `ci`; remote
branch-protection enforcement remains separate. Its current jobs are:

| Lane | What to run locally | What it protects |
| --- | --- | --- |
| Policy | `python -m pip install -r ci/requirements.txt`; `python -m unittest discover -s ci -p 'test_*.py'` | Workflow, review input/report, contract artifact/source, and dependency policy invariants; offline mocked tests, not remote controls. |
| Dependencies | `python3 ci/run_dependency_audit.py app --baseline ci/dependency-exceptions/app.json` and same command for `functions` and `legacy` with their files | Production high/critical advisory identity and dependency path, severity increases, exception expiry, malformed report, scanner errors. Registry access is required. |
| Unit | `npm --prefix app ci --ignore-scripts --no-audit --no-fund`; `npm --prefix app test`; `npm --prefix app run lint` | Frontend behavior and lint. Preexisting warnings remain visible; don't silently bulk fix. |
| Server | `npm --prefix functions ci --ignore-scripts --no-audit --no-fund`; `node --test functions/*.test.js scripts/*.test.cjs scripts/*.test.mjs`; `node --test functions/legacy-upload-processor/*.test.cjs`; `node --test ci/verify-mobile-contract-artifact.test.cjs` | Functions, legacy upload marker/routing guard, scripts, release/guard behavior, and artifact verifier logic without a private partner checkout. Three historical private-fixture skips are tracked in [exceptions](EXCEPTIONS.md). |
| Build and browser | `npm --prefix app run check:svelte`; `npm --prefix app run build`; `npm --prefix app run build:marketing`; `node --test ci/check-static-firestore-transport.test.mjs`; `node scripts/check-static-firestore-transport.mjs`; `node --test scripts/browser-smoke.mjs` | Type/Svelte/Astro output, static-browser gRPC assumption, and guest Chromium navigation on the generated `app/astro-dist`. Install local Playwright Chromium only if authorized and absent. |

`scripts/browser-smoke.mjs` uses a disposable loopback preview, distinct guest
contexts, and blocks external HTTP/WebSocket requests. It proves guest flows,
not authenticated journeys or production assembly. The static Firestore
transport guard is essential while the narrowly excepted gRPC advisory is
present; an SSR/adapter change requires renewed assessment.

For a fresh local browser setup, install the Chromium version matching the
committed Playwright dependency before running the smoke test:

```sh
node app/node_modules/playwright/cli.js install chromium
node --test scripts/browser-smoke.mjs
```

The hosted Ubuntu workflow uses `install --with-deps chromium` to install its
system libraries as well. Run the preceding app install/build commands first;
a browser binary from another Playwright version is not interchangeable.

## Explicit integration batches

These are outside ordinary public PR `ci` because they need a private source,
local emulators, or native hardware. Run them only with the stated inputs; do
not turn missing input into a green skip.

| Batch | Source and command | Protected behavior and current limit |
| --- | --- | --- |
| Canonical mobile contract parity | Set `POSETEK_MOBILE_REPO` to the reviewed lowercase `posetek-mobile-app` checkout and record `git -C "$POSETEK_MOBILE_REPO" rev-parse HEAD`; run `node --test functions/device-performance-parity.integration.cjs`. | Two dedicated assertions compare both server and frontend pinned schema/fixture bytes to canonical mobile source. Missing source fails. The local pinned README digest table still guards frontend bytes; private source README prose is deliberately excluded from the artifact. The [source artifact workflow candidate](../../ci/mobile-contract-pr-job.yml) is inactive and its ordinary PR consumer is mutable. |
| Canonical rules | Set `RULES_PATH` and `STORAGE_RULES_PATH` to reviewed mobile `firebase/firestore.rules` and `firebase/storage.rules`, select a free `RULES_PORT_OFFSET`, and run `node scripts/run-rules-tests.mjs`. | Authorization suites run against the private canonical rule bytes and verify they did not change mid-run. Requires Java/Firebase emulators; no public rule artifact. |
| Authenticated browser journey | With cached Java 21, Firebase binaries, Chromium, installed local dependencies, explicit absolute `POSETEK_MOBILE_REPO`, and reviewed full lowercase `POSETEK_MOBILE_SHA`, run `node scripts/authenticated-emulator-smoke.mjs`. | Synthetic signup and four local Auth/Firestore/Functions/Storage emulators; exact demo project and loopback ports; no cloud credentials or live service. The harness checks canonical mobile Git origin, exact HEAD and private rule bytes against that commit, plus free local ports before launch. This is local trusted-code evidence, not a public PR gate. |
| Production assembly | Follow [release and operations](RELEASE_AND_OPERATIONS.md); use the current captured live baseline and production build scripts. | Preserves existing deployed files and proves intended additions/changes. A plain Astro build is insufficient and historic file counts must not be hard-coded. |

For local rules work, supply an absolute path to a reviewed checkout of the
canonical private mobile repository and record its full commit SHA. The
four-emulator harness refuses a missing, short, different or dirty source and
requires the `posetek/posetek-mobile-app` Git origin; it does not search for
rules or use a website copy. Its present local runner also requires cached
emulator binaries under `/private/tmp/`, a Java 21 `JAVA_HOME` path containing
`jdk-21`, and cached Playwright Chromium. These are explicit local prerequisites,
not a portable hosted lane. Choose an unused rules offset only after checking
local listeners; never kill another runner's process to make a test pass. The
[mobile build and testing guide](https://github.com/posetek/posetek-mobile-app/blob/main/docs/BUILD_AND_TESTING.md)
owns mobile-specific native and emulator detail. The [backend baseline](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/BACKEND_BASELINE_20261007.md)
owns backend suites and exact recorded results.

### Reproducing the local authenticated journey

This is the documented macOS validation setup, not a cloud deployment command.
Prepare the app and Functions dependencies from their lockfiles, install a
compatible Firebase CLI on `PATH`, and provision Java 21 plus the Firebase
Firestore/Storage emulator cache. Replace the mobile path and SHA below with
the checkout and full commit you reviewed. The cache paths match the recorded
local validation; their existence is a prerequisite, not guaranteed on a new
machine.

```sh
export JAVA_HOME='/private/tmp/posetek-mobile-java21/jdk-21.0.12.1+1/Contents/Home'
export FIREBASE_EMULATORS_PATH='/private/tmp/posetek-mobile-emulators'
export PLAYWRIGHT_BROWSERS_PATH='/private/tmp/posetek-website-playwright-browsers'
export POSETEK_MOBILE_REPO='/absolute/path/to/reviewed/posetek-mobile-app'
export POSETEK_MOBILE_SHA='REPLACE_WITH_REVIEWED_FULL_LOWERCASE_COMMIT_SHA'
command -v firebase
"$JAVA_HOME/bin/java" -version
node app/node_modules/playwright/cli.js install chromium
node scripts/authenticated-emulator-smoke.mjs
```

The current harness requires a `JAVA_HOME` containing `jdk-21`, an emulator
cache below `/private/tmp/`, and nonempty `PLAYWRIGHT_BROWSERS_PATH`. It checks
these fixed loopback ports before starting: Auth `19199`, Firestore `18189`,
Functions `15101`, Storage `19399`, emulator hub `14400`, logging `14500`,
WebSocket `14150`, and Astro `14321`. `RULES_PORT_OFFSET` affects the separate
rules runner, **not** this journey. If a port belongs to another task, wait or
coordinate ownership; do not kill that task's process. Port configurability
and a portable hosted authenticated lane remain future improvements.

The harness passes a restricted environment to its child processes rather than
local cloud credentials. It uses a demo project, blocks browser requests to live
services and removes its temporary Functions wrapper. Do not supply production
credentials or publish private rule bytes to reproduce this test.

## Diagnosing a red lane

For the separate canonical-rules runner, use the same reviewed mobile checkout,
an installed Firebase CLI and Java 21. After selecting an unused port offset,
the command is:

```sh
export RULES_PATH="$POSETEK_MOBILE_REPO/firebase/firestore.rules"
export STORAGE_RULES_PATH="$POSETEK_MOBILE_REPO/firebase/storage.rules"
export FIREBASE_BIN='/absolute/path/to/firebase'
export RULES_PORT_OFFSET='1000'
node scripts/run-rules-tests.mjs
```

`1000` is an example offset to check for availability, not a reserved range.
`FIREBASE_BIN` may be omitted when `firebase` is already on `PATH`. Preserve
the reviewed `JAVA_HOME`/Java runtime and canonical rule files; the runner checks
rule hashes before and after execution. See [rules suite documentation](../../app/rules-tests/README.md)
for named-suite selection and its exact port behavior.

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
