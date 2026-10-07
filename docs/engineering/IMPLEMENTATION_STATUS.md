# Pipeline implementation status

October 7, 2026. This tracks the 42 approved components; approved does not mean
implemented, enabled, or verified on hosted infrastructure. All work is local to
isolated worktrees. No production deployment or paid reviewer is enabled.

## Decisions and operating rules

The full decision record is [APPROVED_PLAN_20261007.md](APPROVED_PLAN_20261007.md).
The user additionally approved the two mobile suite-discovery documentation
corrections, the website contract-test relocation and associated secure workflow
preparation, the stray-brace repair, the explicit gateway staging configuration
proposal, and safe local Linux runtime provisioning. These approvals do not
authorize paid cloud activation or unrelated replacements of older material.

Agents use GPT-6-Sol with medium effort and commit each coherent writing batch
before the next batch or rewrite. The orchestrator reviews changes and automatically
presents new proposals to the user. Only affected work waits at approval points;
independent approved work continues. There is no claim that agents run permanently
between assignments or that archived future scope is being implemented.

## Component tracker

| Item | Status | Evidence or remaining work |
| --- | --- | --- |
| 1 Repositories | Retained | Three repositories; exact partner-revision CI not yet enabled. |
| 2 Stack | Retained | Existing providers; Redis remains future scope. |
| 3 Isolation | In use | Separate website/backend/mobile pipeline worktrees. |
| 4 Commits | In use | Coherent checkpoints retained, including corrective commits. |
| 5 Guidance | Partial | Approval ledger and additive preparation docs; old workflow claims need reconciliation. |
| 6 Baseline | Partial | Website and emulator results recorded below; backend Linux and native execution unresolved. |
| 7 Coverage review | Partial | Specific native/rules/gateway batches documented; wider user-facing coverage review remains. |
| 8 Scheduling | Partial | PR/main/manual/merge-group candidate exists; expensive schedules not enabled. |
| 9 Aggregate gate | Candidate tested locally | Failure/skip/cancel guards present; hosted required-check evidence outstanding. |
| 10 Workflow security | Under review | Existing restrictions retained; source-workflow hardening and hosted controls outstanding. |
| 11 Dependencies | Partial | Local isolated dependencies restored; tested Linux locking remains. |
| 12 Astro/lint | Implemented locally | Astro checks pass; lint added to PR unit lane, existing warnings retained. |
| 13 Browser | Partial | Seven guest smoke checks pass on Astro output; authenticated journeys pending. |
| 14 Functions/tooling | Baseline verified | 1,083 pass with three historical fixture skips; integration additions pending. |
| 15 Gateway | Partial | Focused suites pass; full macOS suite/replay blocked by SciPy binary failure. |
| 16 Processing | Inventory prepared | Client-side native coverage prioritized; no new legacy server suite. |
| 17 Rules | Baseline verified | 1,232 emulator tests across 11 suites and 40 publisher tests pass locally. |
| 18 Cross-repo | In progress | Trusted manual source candidate; active PR handoff/required gate still incomplete. |
| 19 Compatibility | Partial | Backend matrix and existing tests mapped; cross-client release checks remain. |
| 20 Native CI | Preparation in progress | Runner/fixture/model prerequisites documented; no native CI build evidence. |
| 21 Device acceptance | Existing protocol retained | Protocol mapped; new device acceptance not performed. |
| 22 Live evaluations | Pending preparation | No paid model runs enabled. |
| 23 Exceptions | Partial | Known skips and environment failures visible; owned resolution register remains. |
| 24 Merge protections | Pending remote review | No server-side ruleset activation. |
| 25 Code owners | Pending names | No placeholder or invented owners installed. |
| 26 Scanning | Pending preparation | Tool support/cost/blocking policy not yet established. |
| 27 Reviewer | Specification only | Advisory policy exists; runnable reviewer not yet implemented. |
| 28 Reviewer limits | Specification only | Provider/model/budget unselected; offline contract tests remain. |
| 29 Staging | Preparation in progress | Gateway configuration guard approved; no project provisioned. |
| 30 Deployment identity | Design only | OIDC/IAM configuration and activation still require reviewed specifics. |
| 31 Website release | Partial | Guarded publisher retained; full hosted publishing configuration review remains. |
| 32 Gateway release | Retained and documented | Canonical script preserved; Linux evidence outstanding. |
| 33 Functions/index/data | Partial | Release-order interfaces documented; detailed platform rollout preparation remains. |
| 34 iOS release | Retained | Native preparation references physical acceptance and TestFlight gates. |
| 35 Receipts/recovery | Partial | Offline structural receipt validator tested; evidence verification/rehearsal not completed. |
| 36 Production/drift | Design only | Existing alarm preserved; new checks and routing not activated. |
| 37 Operations | Partial | Recovery design underway; restore/alert delivery not verified. |
| 38 Speed/cost | Partial | Local runtimes captured; hosted runner/cost baseline absent. |
| 39 Queue/previews | Deferred | Archived in future register. |
| 40 Autonomous work | Deferred | Archived, including personalized account-specific skills. |
| 41 Extra mechanisms | Deferred | Archived with concerns and reconsideration conditions. |
| 42 Documentation | Partial | Approval/future register saved; stray-brace repair committed; final reconciliation remains. |

## Evidence checkpoints

- Website `461c17a`: Astro browser adaptation; 1,660 frontend tests, 1,083 Node
  passes/three fixture skips, seven guest browser checks, Svelte and builds pass.
- Website `aed7d4e`: lint added to CI; zero lint errors and 204 visible warnings.
- Website `f6c4046`: manual trusted-source workflow candidate; six policy tests
  pass. This is not a working automatic cross-repository PR gate. Subsequent
  orchestrator review requested source-ancestor and trusted-ref hardening.
- Website `f3b23ab`: approved workflow-text repair; no publisher behavior changes.
- Backend `0b7109c`: full gateway baseline has 2,312 passes, 56 failures, 37
  errors and two emulator skips; malformed macOS SciPy import reproduced.
  These are failures, not waived release evidence.
- Backend `2c0e37e`: compatibility/recovery matrix; separate focused batch
  passed 129 tests with network blocked.
- Backend `41bf20b` / `f01bc8f`: offline receipt validator and documentation;
  six new plus three existing unit checks pass. Structural validity is not
  verification of deployed artifacts or approval authenticity.
- Mobile `609f3a2`: native validation preparation; native tests remain unrun.
- Mobile `e65203e`: approved suite-discovery README correction.
- Mobile `8f7c762`: isolated Java 21 emulator evidence, 1,232 passes with zero
  skips/failures, and 40 publishing-tool passes. No production access.

The original parity-test move (`67c04c0`) was corrected by `68be703` before
activation of the replacement lane. The older assertion remains in the server
suite; a clean hosted checkout still needs partner-source delivery to pass it.
Local success with a reviewed partner-path override is not hosted CI evidence.
