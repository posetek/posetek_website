# Pipeline activation handoff — credentials last

This is the sequence after local implementation and simulated-service validation.
It does not authorize a production deployment, a purchase, or secret disclosure.
Mocked GitHub/Anthropic runs are not hosted or live-model end-to-end evidence.

## 1. Integrate reviewed source without unintended publishing

- Keep the three pipeline worktrees and checkpoint commits intact.
- Before pushing or merging, verify existing Netlify Git publishing behavior; a
  repository update must not accidentally publish application changes.
- Integrate the prepared CI/reviewer changes through the intended PR process and
  confirm actual hosted runs. No local test result substitutes for these runs.
- Ordinary website PR tests are independent of a private mobile checkout. The
  separate canonical-contract integration command must receive the reviewed source
  artifact and fail when it is missing. Canonical Firebase rules remain private;
  their authenticated integration lane runs only against trusted reviewed code.

## 2. Establish the GitHub trust boundary

- The reviewer coordinator is prepared in the private backend repository. Use a
  trusted main revision, pinned actions, explicitly scoped GitHub App credentials,
  and protected environment/branch restrictions before giving it any credentials.
- Never put the private App key or Claude key into repository-wide secrets simply
  to work around unavailable environment protection. A YAML `if` check alone is
  not protection against someone editing the workflow on another branch.
- GitHub Team is a deferred purchase. Private environment secrets/branch
  restrictions and merge enforcement require supported plan features; private
  environment reviewer approvals are a separate feature/plan question. Do not
  claim the current Free organization provides those controls.
- Initialize the dedicated durable budget-ledger ref with the documented schema
  and scoped identity. Verify compare-and-swap writes and cross-repository review
  access using synthetic fixtures before provider activation. Never use local
  per-run state as the shared daily budget.
- Require the exact AI completion check from its trusted publisher when protection
  becomes available. Findings remain advisory; authors can merge after CI and
  complete current-revision review. Partial/failed/budget-exhausted review blocks.
- Keep owner emergency merge bypass recorded and separate from spending authority.

## 3. Validate dependencies and runtime prerequisites

- Run production dependency audits from committed lockfiles; keep exact findings
  visible. Narrow delegated exceptions expire October 14, 2026 and are not fixes.
  Reassess before expiry and when the dependency graph or assessed runtime changes.
- Native input presence and synthetic wrapper tests are not native acceptance.
  Exact-path inspection found models and matching installed Pods manifests in the
  primary mobile checkout, although absent from the linked worktree. The primary
  app IMG_8111.mov is empty, the golden static_jump.mov is missing, and the harness
  IMG_8111.mov is missing. An owner-provisioned runner needs valid authorized clips
  and the pinned toolchain before real native/device validation.
- Gateway Linux ARM validation is recorded. Production AMD64 image qualification
  remains separate; do not deploy an ARM test artifact as if AMD64 were tested.

## 4. Add Claude access last

- Configure company-owned Anthropic access and billing securely only after the
  preceding trust and activation prerequisites. Never paste an API key into chat,
  source, a report, or a shell command transcript.
- Validate the pinned model and current price snapshot before one bounded synthetic
  live review. The approved ceilings are USD 5 per UTC day shared across all three
  repositories and USD 1 per attempt; failed/unknown attempts consume reservations.
- The conservative first implementation retains a full USD 1 reservation per
  attempt, allowing at most five attempts daily even when actual charges are less.
  Successful exact-scope reviews must not be billed again merely because a day
  passes. More efficient settlement is future optimization, not extra spend.
- Confirm actual GitHub review publication, current revision binding, failure
  visibility, budget refusal, and required-check behavior before general rollout.
- No model key has been requested or configured by the current implementation work.

See [implementation status](IMPLEMENTATION_STATUS.md),
[approved decisions](APPROVED_PLAN_20261007.md), and
[deferred purchases](FUTURE_PURCHASES.md). External prerequisites above must remain
explicit even when all credential-free implementation checks pass.
