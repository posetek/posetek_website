# Validation exceptions and unresolved evidence

October 7, 2026. This register exposes gaps; it does not waive checks, approve
quarantine, or turn missing evidence into a passing result. Implementation owners
below are temporary task roles. Permanent maintainer names remain unassigned and
must be confirmed before hosted rollout. Reassess each entry at the next affected
PR and before release; do not silently carry an exception forward.

| ID | Exact condition and impact | Implementation owner | Resolution evidence |
| --- | --- | --- | --- |
| WEB-01 | `functions/insights-v2-qualification.test.js`: historical audit test skips when `.netlify/vacaville-sep16-repair/completion-evidence.json` or `completion-qualification.json` is absent. | Website agent; maintainer pending | Preserve private data boundaries. Propose synthetic equivalent coverage or an authorized private-fixture lane; demonstrate assertions execute. Replacing the older test requires user approval. |
| WEB-02 | `functions/insights-v2-projection.test.js`: full historical projection test skips without the same directory's `completion-evidence.json` and `audit-input.json`. | Website agent; maintainer pending | Same treatment as WEB-01, including projection and scoped API expectations. Do not copy private historical records into this public repository. |
| WEB-03 | `functions/insights-v2-projection.test.js`: cross-session calibration test skips without `.netlify/expanded-insights-control-plane/qualification-diagnosis.json`. | Website agent; maintainer pending | Execute equivalent cross-session failure-linking behavior with approved synthetic evidence or authorized private fixtures. |
| WEB-04 | Existing device-performance parity assertion needs a canonical mobile checkout; a hosted single-repository checkout has no partner source. | Website agent and orchestrator | Trusted exact-SHA data handoff, reviewed disclosure, offline verification, hosted successful run and required-gate integration. The candidate outside `.github/workflows` is not active protection. |
| WEB-05 | Seven guest browser checks pass, but no authenticated browser-to-Functions/rules journey has run. Existing Firebase initialization targets production. | Website agent | Approved isolated test bootstrap; complete loopback emulators; synthetic accounts; exercised success, denial, retry and duplicate behavior; cleanup and external-network denial. |
| WEB-06 | Lint has zero errors and 204 existing warnings at the recorded baseline. | Website agent; maintainer pending | Classify actionable warnings and propose cleanup or a measured ratchet. No warning removal, exclusion or invented zero-warning claim. |
| WEB-07 | Raw Astro preview lacks `/marketing/home-navigation.js`, supplied by production composition. | Website agent | Test the composed release artifact and its navigation before release; guest raw-output smoke alone does not validate protected production bytes. |
| API-01 | macOS full gateway run reported 56 failures and 37 errors alongside passing tests; malformed SciPy binary import reproduced. | Backend agent and orchestrator | Record full Linux test/replay results against exact source/image and classify any remaining failures. A successful import alone does not close this entry. |
| API-02 | Two gateway emulator-only tests were skipped in the offline baseline. | Backend agent | Identify exact tests, supply an isolated emulator lane and show execution. Do not count offline success as emulator evidence. |
| IOS-01 | Native prerequisite check reports missing YOLO models, ignored fixture clips and Pods; no native build/XCTest or device acceptance performed. | Mobile agent and primary Mac owner | Authorized asset provisioning with hashes, clean native build, selected XCTest results and separate physical-iPhone acceptance. Swift parsing is not a substitute. |
| HOST-01 | No GitHub execution evidence or required-check enforcement has been established for these local changes. Private repositories currently lack plan support for requested protections. | Orchestrator; organization administrator pending | Confirm plan and owners, review configuration, obtain green hosted runs, then explicitly activate protection and verify it prevents an invalid merge. |

The three private-fixture skips are deterministic missing-input conditions, not
observed flaky tests. None of these entries creates permission to suppress a
failure. New or changed skips must appear in the PR evidence with their exact test
name, cause, responsible maintainer, review date and closure condition.

For an intermittent failure, retain the failing seed, logs, source and environment;
reproduce before changing retries. A retry must report the original failure and
all attempts. Any proposed quarantine or movement out of required PR coverage
needs a separate reviewed scope and expiry. No blanket failure allowance or
unbounded rerun-until-green policy is approved.
