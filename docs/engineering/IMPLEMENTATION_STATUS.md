# Pipeline implementation status

Updated October 8, 2026. Documentation, standing CI and the prepared runtime
safeguards are merged across the three repositories. Hosted PR checks passed
before each code merge. [The rollout ledger](MAIN_ROLLOUT.md) records exact
source and post-merge evidence; [the component map](COMPONENT_MAP.md) provides
navigation for every item. No production deployment, new staging infrastructure,
paid reviewer or remote merge protection is enabled by this integration.

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
| 5 Guidance | Integrated | Central handbook, complete component map and companion indexes cover current commands, decisions and historical guidance. |
| 6 Baseline | Hosted and local evidence recorded | Three repositories passed hosted PR CI; local authenticated emulators and Linux ARM image results are distinct. Production AMD64 image qualification/native execution remain unresolved. |
| 7 Coverage review | Batches documented | Website, gateway, rules and native maps explain protected behaviors and gaps; counts alone are not coverage. |
| 8 Scheduling | Active | Every PR/main push runs CI in all three repositories; merge-group/manual triggers included. Expensive native/live schedules remain disabled. |
| 9 Aggregate gate | Hosted CI passed | All three repositories passed every standing lane and aggregate ci; server-enforced required-check settings remain separate. |
| 10 Workflow security | Source guards active | Read-only secret-free ephemeral PR jobs and action pins are active. Privileged source/reviewer credentials and hosted protection remain separate activation. |
| 11 Dependencies | Partial | Local isolated dependencies restored; tested Linux locking remains. |
| 12 Astro/lint | Hosted CI passed | Astro/build and lint ran in website PR #42; existing warnings remain visible. |
| 13 Browser | Partial | Seven guest checks plus local signup/redemption/privacy/refresh emulator journey pass; no hosted authenticated gate. |
| 14 Functions/tooling | Hosted CI passed | Ordinary server tests plus legacy routing/repair run on PRs without private mobile source; three historical fixture skips remain. Explicit frontend/server parity is separate. |
| 15 Gateway | Hosted CI passed | Runtime stage: 2,440 passed/2 optional emulator skips, 19 replay cases passed. Separate local real SDK emulator cases 2/2 passed; no live model evaluation. |
| 16 Processing | Inventory prepared | Client-side native coverage prioritized; no new legacy server suite. |
| 17 Rules | Hosted CI passed | 1,232 emulator tests across 11 suites and 40 publisher tests pass; receipt artifact uploaded. No rules deployment. |
| 18 Cross-repo | In progress | Trusted manual source candidate; active PR handoff/required gate still incomplete. |
| 19 Compatibility | Partial | Backend matrix and existing tests mapped; cross-client release checks remain. |
| 20 Native CI | Prepared, inactive | Prerequisites and strict result handling have synthetic tests. Worktree lacks ignored models/Pods; primary has those, but authorized usable clips remain missing/incomplete. No full native execution. |
| 21 Device acceptance | Existing protocol retained | Protocol mapped; new device acceptance not performed. |
| 22 Live evaluations | Prepared, inactive | Six-case proposal and quality/budget requirements documented; no paid runs. |
| 23 Exceptions | Register prepared | EXCEPTIONS.md records exact gaps and closure evidence; permanent maintainer assignments remain. |
| 24 Merge protections | Remote audit complete | Public website unprotected; private repository APIs require paid plan. No settings activated. |
| 25 Code owners | Pending names | No placeholder or invented owners installed. |
| 26 Scanning | Hosted CI passed | Website dependency lane passed on PR #42 across app, Functions and legacy. Exact-path delegated exceptions expire 2026-10-14; findings remain visible. Remote required-check enforcement remains separate. |
| 27 Reviewer | Backend coordinator prepared, disabled | Offline report and mocked coordinator tests pass; provider credentials, publication and hosted enforcement are not active. |
| 28 Reviewer limits | Prepared, not activated | Bounded review and durable shared budget coordinator implemented in backend; Sonnet API and $5/day shared/$1 attempt approved, exact model/provider activation pending. |
| 29 Staging | Runtime guard merged | Explicit environment/project/buckets and release preflight passed local/hosted tests. Live configuration migration and staging provisioning have not occurred. |
| 30 Deployment identity | Design only | OIDC/IAM configuration and activation still require reviewed specifics. |
| 31 Website release | Partial | Guarded publisher retained; full hosted publishing configuration review remains. |
| 32 Gateway release | Retained and documented | Canonical script preserved; Linux ARM image tested, production AMD64 remains unverified. |
| 33 Functions/index/data | Handoff prepared | Release order, compatibility, readiness and recovery requirements documented; execution and operational verification remain separate. |
| 34 iOS release | Retained | Native preparation references physical acceptance and TestFlight gates. |
| 35 Receipts/recovery | Partial | Offline structural receipt validator tested; evidence verification/rehearsal not completed. |
| 36 Production/drift | Design only | Existing alarm preserved; new checks and routing not activated. |
| 37 Operations | Partial | Recovery design underway; restore/alert delivery not verified. |
| 38 Speed/cost | First hosted timings recorded | Lane durations are in MAIN_ROLLOUT.md; no billing prediction or coverage-reducing optimization is inferred. |
| 39 Queue/previews | Deferred | Archived in future register. |
| 40 Autonomous work | Deferred | Archived, including personalized account-specific skills. |
| 41 Extra mechanisms | Deferred | Archived with concerns and reconsideration conditions. |
| 42 Documentation | Integrated | Central handbook, complete component map, companion indexes, twelve-playbook audit, approved/future registers and rollout ledger are linked; maintain evidence as changes land. |

## Historical evidence checkpoints

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
activation of a replacement lane. Later `641cec2` established a dedicated
`functions/device-performance-parity.integration.cjs` command and moved only
the canonical mobile checkout assertion out of ordinary server CI. That
command fails without source and passed locally against a reviewed mobile SHA;
its hosted artifact lane remains inactive. Ordinary server CI must not be
reported as partner parity evidence.

## Subsequent implementation checkpoints

- Website `e1ad09f` hardens source staging against ancestor symlinks and non-main
  dispatch; `d198b2f` verifies immutable source receipts and exact contract bytes.
  `8afa16b` resolves successful trusted artifacts; `8d45aaa` prepares an inactive
  PR job. Twenty offline policy tests passed before the subsequent tooling batch.
  This payload covers device schema/fixtures, not canonical Firestore/Storage rules.
- Website `b5c8e9c`: three offline rules-runner regression tests pass, covering
  invalid inputs, loopback demo invocation, suite failures and changed rule bytes.
- Website `bb6e865` and `d382a10`: advisory report shape/revision/scope validator
  and seven tests. No actual provider call or review publication exists.
- Website `d7d7f6d`: read-only remote control audit. New source environment absent;
  private protections require plan support. No live controls changed.
- Backend `776bcb9`, `6ff6746`, `425108a`, `268c19f`: approved explicit staging
  guard, production-resource checks, migration handoff and 24 passing startup tests.
  Deployment cannot proceed until required live configuration is reviewed.
- Backend `991075f`: additive Functions/index/data/operations handoff.
- Mobile `17b692c`: second approved rule-discovery README correction.
- Mobile `82234b0`: complete original-playbook adoption/future audit.
- Mobile `1c67ff2`: fail-closed multiline Xcode/model-package prerequisite scanner;
  five synthetic tests pass, actual app/harness inputs remain incomplete.

Local Linux ARM production-image build and SciPy imports succeeded at backend
`268c19fd7bed5563dcf22f1f2280993a211fb4c6`; full test/replay runs are underway.
This is neither production AMD64 evidence nor a deployed service.

## Latest approved implementation results

- Website authenticated emulator journey (`7110970`) passed signup, canonical
  identity binding, one-time code redemption, stranger denial and refresh.
- Active Functions (`049461f`) and legacy processor (`1701101`, `08f082c`)
  compatible patches remove critical findings in their captured audits; remaining
  high findings are not waived. Legacy is confirmed active; no deployment occurred.
- Approved legacy marker contract tests (`44e3fb4`) pass 13/13 with handler unchanged.
- Reviewed SHA source input (`ea095be`) passes four policy tests; private rules excluded.
- Dependency scanner runner (`a2daee9`) has 11 synthetic tests; full website Python
  policy suite passed 38 before the subsequent CI wiring change.
- Mobile strict XCTest skip/failure gates are implemented and synthetically tested;
  no Xcode/device execution occurred.
- Gateway local Firestore SDK cases passed 2/2 in 0.41 seconds using disposable
  demo-project emulator 1.22.0 at exact loopback port. The parent stopped its own
  emulator afterward. Evidence: `/private/tmp/posetek-gateway-emulator-f5ek8u92/`.

Latest user authorization permits routine implementation decisions for remaining
work without further approval, while preserving production safety and maintainable
code. Claude credentials are the final step. No paid invocation or deployment is
implied, and missing hardware, billing, or hosted verification is not completed E2E.

## Final credential-free checkpoint

See [VERIFICATION_HANDOFF_20261007.md](VERIFICATION_HANDOFF_20261007.md) for the
final source revisions and results. Reviewer implementation and independent review
are complete locally; protected hosted activation and a real provider review are
not completed. Production dependency scanning is now wired into the local website
workflow with exact expiring exceptions and static-runtime preflight. No ordinary
website server test needs a private mobile checkout; partner parity remains an
explicit separate integration requirement. Final policy suites: website 40, backend
63, mobile 20 passing; final frontend 1,666 passing.
