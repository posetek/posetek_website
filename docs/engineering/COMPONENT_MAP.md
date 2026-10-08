# The complete pipeline map

This is the navigation and readiness map for all 42 approved components. Start
with [the handbook](README.md); use [the rollout ledger](MAIN_ROLLOUT.md) for exact
merged revisions and hosted results. **Source on main, passing CI, enforced merge
controls, and a production release are different states.** Candidate files and
mocked tests do not establish activation.

The [approved plan](APPROVED_PLAN_20261007.md) records decisions and later
superseding authority. The [implementation history](IMPLEMENTATION_STATUS.md)
preserves earlier checkpoints. The table below points to the maintained guides
rather than duplicating every command and test assertion.

## Foundations and daily development

| # | Component and current implementation | Where to find it / remaining boundary |
| --- | --- | --- |
| 1 | Three repositories retain separate ownership and use linked PRs for coordinated changes. | [Repository map](README.md#repository-map); record partner SHAs for shared contracts. No monorepo migration. |
| 2 | Current Swift, Astro/React, Firebase and Python stack is retained. | [Project context](../../POSETEK_PROJECT_CONTEXT.md); Redis and a dedicated Firebase repository are [future candidates](APPROVED_PLAN_20261007.md#future-implementation-register), not implicit dependencies. |
| 3 | Implementation uses isolated Git worktrees with explicit ownership. | [Development path](DEVELOPMENT_AND_VALIDATION.md#daily-change-path), [integration layout](MAIN_ROLLOUT.md#starting-source-and-concurrent-work); no edits in another task's checkout. |
| 4 | Each coherent writing batch is committed before subsequent rewrites. | [Approved operating rules](APPROVED_PLAN_20261007.md); one-line descriptive messages, original checkpoint ancestry retained through merge commits. |
| 5 | Repository guidance links to this handbook and canonical local commands. | [Website workflow](WORKFLOW.md), [mobile index](https://github.com/posetek/posetek-mobile-app/blob/main/docs/ENGINEERING_PIPELINE_INDEX.md), [backend index](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/README.md). Product-specific instructions remain in their owning repository. |
| 6 | Baselines distinguish local results, clean hosted runs, platform, revision and real skips. | [Rollout evidence](MAIN_ROLLOUT.md#evidence-ledger), [historical handoff](VERIFICATION_HANDOFF_20261007.md). Earlier test counts do not certify newer commits. |
| 7 | Test coverage is explained in behavioral batches with explicit limits. | [Website validation](DEVELOPMENT_AND_VALIDATION.md), [mobile batch map](https://github.com/posetek/posetek-mobile-app/blob/main/docs/ENGINEERING_PIPELINE_INDEX.md), [backend baseline](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/BACKEND_BASELINE_20261007.md). Test count alone is not coverage. |
| 8 | CI runs automatically for every PR and main push, with merge-group and manual support. | [Website workflow source](../../.github/workflows/ci.yml); companion repos have their own workflow. Expensive native/live/provider checks remain separate, explicitly gated work. |
| 9 | Stable aggregate `ci` requires every standing job to succeed. | [CI policy tests](../../ci/test_workflow.py); failure, cancellation and unexpectedly skipped jobs fail the gate. Individual historically skipped tests are separately disclosed. |
| 10 | PR workflows use read-only permissions, immutable action references and ephemeral runners without production secrets. | [Trust boundaries](SECURITY_AND_REVIEW.md#pr-trust-and-review). Mutable repository CI is not a tamper-resistant privileged attestation. |
| 11 | Node/Python/Java versions and npm lockfiles are explicit; dependency changes are reviewed. | [Validation setup](DEVELOPMENT_AND_VALIDATION.md), [gateway lock strategy](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/GATEWAY_DEPENDENCY_LOCK_STRATEGY.md). Full tested Linux Python locking and cache optimization remain distinct follow-up work. |

## Standing tests and integration evidence

| # | Component and current implementation | Where to find it / remaining boundary |
| --- | --- | --- |
| 12 | Website CI runs frontend unit tests, lint, Svelte/type checks and Astro/marketing builds. | [Standing lanes](DEVELOPMENT_AND_VALIDATION.md#website-standing-ci); preexisting lint warnings remain visible. Production-preserving assembly is a separate release check. |
| 13 | Hosted Chromium smoke covers guest navigation; a local four-emulator journey covers signup, canonical identity binding, one-time redemption, stranger denial and refresh. | [Integration batches](DEVELOPMENT_AND_VALIDATION.md#explicit-integration-batches); local authenticated tests require explicit private source and a reviewed SHA, and are not a public PR gate. |
| 14 | Functions/tooling CI retains behavioral suites and includes legacy upload routing/repair regressions. | [Server lane](DEVELOPMENT_AND_VALIDATION.md#website-standing-ci), [exceptions](EXCEPTIONS.md). Three historical private-fixture skips remain; external partner byte parity has its own failing-on-missing-source command. |
| 15 | Gateway CI runs the unit suite and all authored deterministic replay profiles with network safeguards. | [Backend workflow](https://github.com/posetek/posetek-backend/blob/main/docs/ENGINEERING_WORKFLOW.md); optional real Firestore SDK emulator evidence is separate. Replay does not measure a live model's quality. |
| 16 | Processing coverage retains existing client-side tests and inventories legacy processors. | [Mobile native preparation](https://github.com/posetek/posetek-mobile-app/blob/main/docs/NATIVE_VALIDATION_PREPARATION.md); server processor compilation only proves syntax, not video algorithm correctness. |
| 17 | Mobile owns canonical Firebase rules, emulator discovery, exact-byte receipts and guarded publishing. | [Rules operations](https://github.com/posetek/posetek-mobile-app/blob/main/firebase/README.md), [CI preparation](https://github.com/posetek/posetek-mobile-app/blob/main/docs/RULES_CI_PREPARATION.md). No rule deployment follows from a merge. |
| 18 | Explicit cross-repo integration compares both frontend and server contracts to reviewed mobile schema/fixtures. | [Integration command](DEVELOPMENT_AND_VALIDATION.md#explicit-integration-batches), [private-source boundaries](SECURITY_AND_REVIEW.md#private-source-and-credential-boundaries). Manual trusted source workflow lacks configured credentials; automatic public PR artifact consumption and privileged attestation remain inactive/deferred. |
| 19 | Compatibility maps identify client/writer/reader contracts and additive release order. | [Compatibility and recovery](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/COMPATIBILITY_AND_RECOVERY.md). Supported historical client versions and actual staged-client acceptance still need explicit release evidence. |
| 20 | A native runner candidate, prerequisite checks and strict XCTest result handling are prepared. | [Runner handoff](https://github.com/posetek/posetek-mobile-app/blob/main/docs/NATIVE_RUNNER_HANDOFF.md). Candidate is outside active workflows; usable authorized assets, toolchain and real build/XCTest evidence are still required. |
| 21 | Existing physical-iPhone diagnostic and acceptance protocols remain canonical. | [Native preparation](https://github.com/posetek/posetek-mobile-app/blob/main/docs/NATIVE_VALIDATION_PREPARATION.md), [release operations](RELEASE_AND_OPERATIONS.md). Hosted Swift parsing is not device acceptance. |
| 22 | Synthetic live-evaluation cases, quality criteria and budget requirements are documented. | [Live evaluation preparation](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/LIVE_EVAL_PREPARATION.md). Paid evaluations are disabled; a replay pass cannot replace them. |
| 23 | Known skips, gaps and dependency exceptions have explicit closure conditions. | [Exception register](EXCEPTIONS.md), [dependency policy](SECURITY_AND_REVIEW.md#dependency-gate-and-exceptions). Narrow advisory exceptions expire 2026-10-14 and must not silently renew. |

## Governance, security and releases

| # | Component and current implementation | Where to find it / remaining boundary |
| --- | --- | --- |
| 24 | Authors may merge their own PRs after checks and completed latest-scope advisory AI review in the target workflow. | [Security/review policy](SECURITY_AND_REVIEW.md), [bootstrap exception](MAIN_ROLLOUT.md#bootstrap-review-and-deployment-boundaries). AI is not active; private enforcement needs supported plan features. No independent-human-review requirement was added. |
| 25 | Ownership is documented without inventing usernames or enforcing placeholder CODEOWNERS. | [Controls audit](GITHUB_CONTROLS_AUDIT.md), [approved plan](APPROVED_PLAN_20261007.md). Final verified maintainer mappings and any enforcement configuration remain explicit activation work. |
| 26 | Required website dependency audits inspect app, active Functions and legacy production graphs. | [Audit policy](../../ci/DEPENDENCY_POLICY_CANDIDATE.md), [security guide](SECURITY_AND_REVIEW.md#dependency-gate-and-exceptions). New or increased severity, unapproved paths, malformed evidence and expired exceptions block; this is not a claim of full secret or code scanning coverage. |
| 27 | A bounded advisory PR reviewer is implemented in the private backend with offline tests. | [Reviewer implementation](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/REVIEWER_IMPLEMENTATION_20261007.md). It may comment and publish completion evidence; it cannot approve, merge, edit code or deploy. Provider/publication activation remains held. |
| 28 | Shared durable budget reservations cap modeled provider spend at $5/day and $1/attempt across the three repositories. | [Budget and trust](SECURITY_AND_REVIEW.md#shared-claude-budget), [activation checklist](ACTIVATION_CHECKLIST.md). Five conservative reservations/day; failures consume reservations. Hosting costs are separate; credentials come last. |
| 29 | Explicit gateway environment/project/bucket validation is merged with a pre-build release check. | [Configuration migration](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/GATEWAY_CONFIG_MIGRATION.md). Source integration status is in the ledger; live configuration and isolated staging infrastructure are not provisioned. |
| 30 | Scoped deployment identity and trusted environment requirements are documented. | [Release operations](RELEASE_AND_OPERATIONS.md), [activation trust boundary](ACTIVATION_CHECKLIST.md#2-establish-the-github-trust-boundary). OIDC/IAM credentials and remote controls are not configured by these PRs. |
| 31 | Website releases retain current production preservation checks and exact-artifact promotion. | [Release operations](RELEASE_AND_OPERATIONS.md); integration uses `[skip netlify]`. A later unmarked push can build merged changes and requires release review. |
| 32 | Gateway releases retain the canonical publisher and candidate/health/promotion process. | [Release preparation](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/RELEASE_PREPARATION.md). Preflight rejects missing explicit target configuration before build; production AMD64 image qualification and actual deployment remain separate. |
| 33 | Functions, indexes and data operations have a release-order and compatibility handoff. | [Functions/data operations](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/FUNCTIONS_DATA_OPERATIONS_HANDOFF.md). Migrations and index/TTL provisioning require their own scoped execution and receipts. |
| 34 | iOS retains signing, TestFlight, device and human release checks. | [App Store checklist](https://github.com/posetek/posetek-mobile-app/blob/main/docs/brand/APP_STORE_RELEASE_CHECKLIST.md), [native runner handoff](https://github.com/posetek/posetek-mobile-app/blob/main/docs/NATIVE_RUNNER_HANDOFF.md). No signed build or distribution occurred. |
| 35 | Source/artifact/rule/approval receipt structure and recovery paths are documented and validated offline. | [Receipt validator](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/RELEASE_RECEIPT_VALIDATOR.md), [compatibility/recovery](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/COMPATIBILITY_AND_RECOVERY.md). Structural validation is not proof of a real deployment, approval or completed restore. |
| 36 | Production verification and drift-check requirements retain existing release safeguards. | [Release operations](RELEASE_AND_OPERATIONS.md), [operations handoff](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/FUNCTIONS_DATA_OPERATIONS_HANDOFF.md). New scheduled checks and alert routing are not activated. |
| 37 | Operational ownership, backup/recovery and rehearsal requirements are inventoried. | [Recovery guide](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/COMPATIBILITY_AND_RECOVERY.md). Restore drills, delivery of alerts and recovery objectives require actual operational evidence. |
| 38 | Hosted lane timings and current cost boundaries are recorded before optimization. | [Rollout observations](MAIN_ROLLOUT.md#evidence-ledger), [security/budget guide](SECURITY_AND_REVIEW.md). Sharding, caches and reduced check selection require measured benefit without losing behavioral coverage. |

## Deferred systems and documentation maintenance

| # | Component and current implementation | Where to find it / remaining boundary |
| --- | --- | --- |
| 39 | Merge queue and full-stack per-PR previews are archived for future consideration. | [Future register](APPROVED_PLAN_20261007.md#future-implementation-register); revisit real contention, isolation, quotas, cleanup and cost. |
| 40 | Autonomous ticket agents, repair/reflection loops and personalized per-account skills are deferred. | [Future register](APPROVED_PLAN_20261007.md#future-implementation-register); retain human scope, identity/privacy controls, bounded authority and budget before any activation. |
| 41 | Additional workbook mechanisms are retained with concerns and reconsideration criteria. | [Twelve-playbook adoption audit](https://github.com/posetek/posetek-mobile-app/blob/main/docs/PLAYBOOK_ADOPTION_AUDIT.md), [original decisions](DECISIONS.md), [future purchases](FUTURE_PURCHASES.md). Includes confidence gates, automatic model upgrades, production clones, blanket failure tolerance, stateful rollback, registries and extra notifications. |
| 42 | A central handbook, this complete map, companion repository indexes and dated evidence form the documentation system. | [Handbook](README.md), [rollout ledger](MAIN_ROLLOUT.md), [approved decisions](APPROVED_PLAN_20261007.md). Original workbook files and historical records are preserved. |

## How to keep this organized

- Update a component's owning guide when its behavior changes; update this map if
  its location or readiness boundary changes. Keep commands in the owning guide,
  not copied into every decision or evidence record.
- Record merge/run/release facts in the rollout or release receipt with exact SHAs
  and links. Never rewrite an earlier failure as a pass or relabel a local result
  as hosted evidence. Mark superseded records as historical and link the replacement.
- Keep future ideas in the approved plan's future register and adoption audit.
  Activate one through a scoped decision and implementation, not by deleting the
  entry or treating its archived proposal as current instructions.
- Keep secrets, private rules, athlete data and private artifacts out of this public
  handbook. Link private operational documentation rather than copying sensitive
  source. Broken private links may indicate missing access, not missing documents.
- When adding a guide, link it from the handbook or its companion index and verify
  its relative paths. Avoid introducing another competing top-level workflow.
