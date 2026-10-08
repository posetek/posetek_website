# Pipeline candidate validation — September 26, 2026

Historical snapshot. Later approved decisions and implementation supersede the
pending lint, reviewer, dependency, and approval statements below. Do not use
these counts as current pass criteria. Start at the
[engineering handbook](README.md), then consult the
[implementation status](IMPLEMENTATION_STATUS.md) and
[2026-10-07 handoff](VERIFICATION_HANDOFF_20261007.md) for later evidence.

Local evidence, not a hosted Actions run or a release. Primary checkouts and other
instances' worktrees were not edited. Candidate branches are isolated:

| Repository | Worktree | Starting commit |
| --- | --- | --- |
| Website | `posetek_website-engineering-pipeline` | `21c82c1` |
| Backend | `posetek-backend-engineering-pipeline` | `caa896f` |
| Mobile | `posetek-mobile-engineering-pipeline` | `1b9a2ae` |

Every branch is named `worktree-engineering-pipeline` in its own repository.
No commit is pushed, no PR opened, no production deployment/rules publish, no
GitHub protections changed, and no paid reviewer enabled. `gh` is unauthenticated.
The backend's remote still names `Athelytics/python-video-processor`, while newer
website records mention `posetek/posetek-backend`; remote identity/tip must be
reconciled before publishing the backend candidate. Current local source takes
precedence over historical test counts in release notes.

## Results

| Check | Local result | Scope |
| --- | --- | --- |
| Website Vitest | 99 files / 1,212 tests passed | Existing application logic/component/source assertions |
| Website Node suites | 437 passed, 3 skipped, 0 failed | Functions and deployment/tooling fixtures |
| TypeScript + application build | Passed | Not the protected whole-site production artifact |
| Svelte | 0 errors / 0 warnings | Svelte islands |
| Marketing build | Passed | Existing large-chunk warning remains |
| New Chromium smoke | 4 passed | Sign-in routes, account dialog, guest admin redirect, privacy reload |
| Gateway pytest | 1,797 passed | After adding the live-network prohibition |
| Gateway replay | All profiles passed | Authored deterministic tapes; zero real provider calls |
| Legacy processors | Python syntax passed | No GPU/model/video behavior claim |
| Mobile publishing tools | 40 tests passed | Mocked unit tests; no production access |
| Mobile rules | 1,055 passed, 0 skipped | Real client SDK against disposable Firestore/Storage emulators |
| Website rules integration | All 7 suites / 910 assertions passed | Exact canonical mobile worktree rules; isolated emulator ports |
| Mobile syntax | 261 tracked Swift files parsed | No application build, XCTest or device evidence |
| CI policy | 3 tests per repo passed | Workflow parsing, hostile mutations, actual aggregate success/failure paths |

Website lint is an unresolved adoption decision: five pre-existing errors all
refer to the non-hook callback named `useSelection` in
`app/src/pages/athlete-portal/player/use-personal-workouts.ts`. Its body calls
state setters; it is not a React hook. A local callback rename should remove
these false positives without a lint waiver. The user was asked to choose a lint
baseline, immediate blocking, or cleanup; no option has been silently applied.
The current CI candidate therefore **does not yet gate lint**. Resolve before
calling the full quality gate ready. Existing warnings also remain visible.

The three Node skips are existing private-evidence cases:

- `private full projection and scoped API reconcile approved history including linked failures`
- `private live calibration failures from different session documents never invalidate current success`
- `private historical audit reproduces all approved qualifications and roster totals`

These require synthetic committed reproductions or a separately controlled evidence
lane; they are not covered by a clean-clone pass. No skips were added or assertions
weakened. This exception is flagged in the decision register.

## Environment and interpretation

Node 22.23.3; gateway/Python tooling 3.12. Website and Functions dependencies were
installed from lockfiles in the isolated worktree. Python dependencies were
installed into a temporary virtual environment; a cross-platform lock is still
outstanding. CI uses Java 21; the local emulator run used installed OpenJDK 27.
Local emulator ports were 18180/19299/14409/14509, separate from shared defaults.
No app build, Pods install or simulator operation was performed.

The initial website run failed because the primary checkout had incomplete
dependencies; the default Python had no pytest. Clean isolated installs resolved
those setup failures. Loopback tests needed ordinary sandbox escalation. Browser
font stylesheet requests are fulfilled with empty local CSS; other external HTTP
and all WebSockets are blocked. Aborting font CSS instead caused lazy page startup
to stall, so this was fixed in the harness without changing product code.

## Unverified and pending

- Hosted Ubuntu/macOS Actions execution, runner image compatibility and required
  check enforcement; bootstrap CI must be green before enabling protections.
- Hosted cross-repository source retrieval and rules integration (local suites passed).
- Full native build/XCTest, golden media/models, device acceptance and distribution.
- Linux runtime dependency locking, dependency/security scan policy and owners.
- Separate staging, authenticated end-to-end journeys, load/performance limits,
  backup/restore and rollback rehearsals, operational alert delivery.
- Reviewer provider/model, hard spend cap, secure implementation/activation.
- User disposition of all pending items in [DECISIONS.md](DECISIONS.md).
