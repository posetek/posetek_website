# Pipeline implementation status

Updated October 8, 2026. This tracks the 42 approved components; approved does not mean
implemented, enabled, or verified on hosted infrastructure. Website standing CI
has reached `main` and passed its hosted PR run; the test-only runtime bootstrap
remains staged. No production deployment or paid reviewer is enabled.

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
| 5 Guidance | Partial | Approval ledger and central handbook added; staged integration and older historical wording remain explicit. |
| 6 Baseline | Partial | Website/emulator and Linux ARM gateway results recorded; AMD64 and native execution unresolved. |
| 7 Coverage review | Partial | Specific native/rules/gateway batches documented; wider user-facing coverage review remains. |
| 8 Scheduling | Partial | PR/main/manual/merge-group candidate exists; expensive schedules not enabled. |
| 9 Aggregate gate | Hosted CI passed | Website PR #42 aggregate and all five prerequisite lanes succeeded; server-enforced required-check settings remain separate. |
| 10 Workflow security | Under review | Existing restrictions retained; source-workflow hardening and hosted controls outstanding. |
| 11 Dependencies | Partial | Local isolated dependencies restored; tested Linux locking remains. |
| 12 Astro/lint | Hosted CI passed | Astro/build and lint ran in website PR #42; existing warnings remain visible. |
| 13 Browser | Partial | Seven guest checks plus local signup/redemption/privacy/refresh emulator journey pass; no hosted authenticated gate. |
| 14 Functions/tooling | Baseline verified locally | Ordinary server suite is independent of the private mobile checkout; three historical private-fixture skips remain. Explicit parity command is separate. |
| 15 Gateway | Partial | Linux ARM 2,428 passed/3 explained skips and 19 replay profiles pass; separate real Firestore SDK cases 2/2 pass. |
| 16 Processing | Inventory prepared | Client-side native coverage prioritized; no new legacy server suite. |
| 17 Rules | Baseline verified | 1,232 emulator tests across 11 suites and 40 publisher tests pass locally. |
| 18 Cross-repo | In progress | Trusted manual source candidate; active PR handoff/required gate still incomplete. |
| 19 Compatibility | Partial | Backend matrix and existing tests mapped; cross-client release checks remain. |
| 20 Native CI | Preparation verified locally | Runner handoff and five prerequisite tests; missing models/clips/Pods prevent native evidence. |
| 21 Device acceptance | Existing protocol retained | Protocol mapped; new device acceptance not performed. |
| 22 Live evaluations | Pending preparation | Six-case disabled proposal and quality/budget requirements prepared; no paid runs. |
| 23 Exceptions | Register prepared | EXCEPTIONS.md records exact gaps and closure evidence; permanent maintainer assignments remain. |
| 24 Merge protections | Remote audit complete | Public website unprotected; private repository APIs require paid plan. No settings activated. |
| 25 Code owners | Pending names | No placeholder or invented owners installed. |
| 26 Scanning | Hosted CI passed | Website dependency lane passed on PR #42 across app, Functions and legacy. Exact-path delegated exceptions expire 2026-10-14; findings remain visible. Remote required-check enforcement remains separate. |
| 27 Reviewer | Backend coordinator prepared, disabled | Offline report and mocked coordinator tests pass; provider credentials, publication and hosted enforcement are not active. |
| 28 Reviewer limits | Prepared, not activated | Bounded review and durable shared budget coordinator implemented in backend; Sonnet API and $5/day shared/$1 attempt approved, exact model/provider activation pending. |
| 29 Staging | Guard implemented locally | Explicit environment/project/buckets and startup preflight tested; migration inputs required before release. No project provisioned. |
| 30 Deployment identity | Design only | OIDC/IAM configuration and activation still require reviewed specifics. |
| 31 Website release | Partial | Guarded publisher retained; full hosted publishing configuration review remains. |
| 32 Gateway release | Retained and documented | Canonical script preserved; Linux ARM image tested, production AMD64 remains unverified. |
| 33 Functions/index/data | Partial | Release-order interfaces documented; detailed platform rollout preparation remains. |
| 34 iOS release | Retained | Native preparation references physical acceptance and TestFlight gates. |
| 35 Receipts/recovery | Partial | Offline structural receipt validator tested; evidence verification/rehearsal not completed. |
| 36 Production/drift | Design only | Existing alarm preserved; new checks and routing not activated. |
| 37 Operations | Partial | Recovery design underway; restore/alert delivery not verified. |
| 38 Speed/cost | Partial | Local runtimes captured; hosted runner/cost baseline absent. |
| 39 Queue/previews | Deferred | Archived in future register. |
| 40 Autonomous work | Deferred | Archived, including personalized account-specific skills. |
| 41 Extra mechanisms | Deferred | Archived with concerns and reconsideration conditions. |
| 42 Documentation | Integrated, updates ongoing | Central handbook, full 12-file mobile adoption audit and future register are on `main`; release/activation evidence must continue to be updated. |

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
