# Approved pipeline plan — October 7, 2026

The user reviewed all 42 components individually in the pipeline chat and approved
the final item on October 7. Approval authorizes the scope below, subject to the
explicit implementation checkpoints. It does not mean implementation is complete
or hosted checks, branch protections, paid reviewers, staging, or CD are enabled.
Earlier candidate documents retain their historical status until reconciled.

## Subsequent configuration decisions

See [FUTURE_PURCHASES.md](FUTURE_PURCHASES.md) for the latest approved reviewer,
spending, author-merge, and emergency-bypass decisions. They supersede earlier
independent-human-approval requirements below. GitHub Team is explicitly deferred
as a future purchase; private enforcement remains unavailable on the current plan.
The original component review remains preserved below as its historical record.

## Specific implementation approval: authenticated website tests

The user explicitly approved updating the existing website Firebase initialization
with a test-only mode for local Auth, Firestore, Storage, and Functions emulators.
Use synthetic accounts/data and a demo project; preserve production initialization,
reject incomplete/nonlocal test configuration, and prevent test mode in production
artifacts. This authorizes the previously proposed `app/src/lib/firebase.ts`
adaptation and focused regression/browser coverage. It does not authorize live
service calls, deployment, or unrelated older-code replacements.

## Specific implementation approval: gateway emulator access

The user explicitly approved a narrow network-guard exception for the two
parameterized `test_real_firestore_sdk_roundtrips_fallback_pointer_and_private_artifact`
cases (`matrix` and `size`) in the gateway suite. Permit only their exact configured
127.0.0.1 Firestore emulator port; retain outbound denial for other destinations and
tests. Add regression checks for the exception boundaries and run the disposable
emulator cases. This is not permission for general localhost access, live Firebase
connections, or unrelated security changes.

## Specific implementation approval: mobile workflow guidance

The user explicitly approved updating mobile `AGENTS.md` and
`docs/brand/APP_STORE_RELEASE_CHECKLIST.md` to describe feature branches, PRs,
passing CI, completed advisory AI review of the latest revision, and author merges.
No independent human approval is required. Preserve incremental commits, merge
history, and the no-push-without-authorization rule. Distinguish this target policy
from currently inactive hosted automation and deferred private-repository protection.
This approval does not cover the separately proposed XCTest skip-wrapper change.

## Specific implementation approval: strict native CI skips

The user explicitly approved an opt-in strict mode in mobile `scripts/validate.sh`
that lists skipped XCTest cases and fails when any selected case skips. Preserve
ordinary local behavior and the zero-result guard. Require this mode in the inactive
native CI candidate, and test actual log-handling behavior synthetically. This
approval changes the previously held wrapper proposal; it does not authorize
native execution, asset provisioning, or hosted runner activation.

## Specific implementation approval: active Functions dependency fixes

The user explicitly approved the separately proposed compatible lockfile patch for
active `functions/package-lock.json`: resolve the identified critical advisories
in protobufjs, proxy-addr, and websocket-driver. Verify current fixed versions and
existing dependency ranges, review every transitive change, and run clean install,
relevant Functions tests, and full/production dependency audits. Preserve the
manifest unless an additional change is separately reviewed. No deployment or
legacy processor dependency update is authorized by this approval.

## Specific implementation approval: legacy processor dependency fixes

The user explicitly approved investigating whether the legacy upload processor
still serves production and preparing a separate compatible dependency patch and
offline upload-routing tests. Verify live status only through authorized read-only
metadata, without invoking processors or inspecting user data. Review all transitive
changes and current advisories; propose any additional manifest/source change outside
the agreed compatible patch. Keep this batch separate from active Functions.
No deletion, retirement, deployment, or push is authorized by this approval.

## Specific decision: canonical Firebase rules remain private

The user approved retaining canonical Firestore/Storage rules in the private mobile
repository for this iteration. Prepare cross-repository integration against trusted,
reviewed code before release; do not publish rules through public website artifacts
or expose them to arbitrary public PR-authored test code. Public website PRs do not
receive the full canonical-rules integration check under this decision. Record that
coverage gap explicitly; local authorized emulator success does not establish an
automatic hosted PR gate. No new hosted workflow or release activation is authorized.

## Specific implementation approval: reviewed mobile revision input

The user approved allowing the trusted mobile contract source workflow to accept
a human-reviewed full immutable mobile commit SHA, avoiding a preliminary website
main update for each partner revision. Retain trusted main-only workflow execution,
reviewed source-environment protection, and exact source/artifact provenance. Limit
retrieval/publication to approved schema and synthetic fixture data; this does not
authorize disclosure of private Firebase rules or other mobile contents. Validate
input as data and fail on malformed revisions. Preparation is approved; hosted
activation, credentials, and environment configuration remain separate checkpoints.

## Specific decision: defer independent contract verifier

The user approved deferring the additional privileged, independent contract
verification service/check. Retain ordinary mutable PR contract tests and their
honest provenance limits for this iteration; do not add a new checks-write workflow
solely for independent contract verification. This decision is separate from and
does not defer the approved required AI-review completion check. Reconsider the
contract verifier after demonstrated need, a reviewed threat model, and explicit
approval of its additional permissions and operating burden.

## Specific implementation approval: dependency scanning policy

The user approved required checks that block newly introduced production high or
critical dependency vulnerabilities. Existing findings must remain visible with
an owner and remediation deadline; exceptions require explicit review and expiry.
Scanner errors, missing inputs, or malformed output must not appear as clean
results. No automatic upgrade merges or blanket waiver of existing findings is
authorized. Prepare and test enforcement against trusted baseline evidence;
remote required-check activation remains subject to verified hosted results and
the deferred private-repository plan upgrade. Unassigned owners/deadlines remain
unresolved, not implicit approved exceptions.

## Specific implementation approval: legacy client-processed marker contract

The user explicitly approved preserving the legacy upload handler's broad early
skip for the string metadata marker `posetekLocalProcessed=true`. Marked media
must not invoke legacy processing merely because its path is free Record or
unrelated, or its context version differs. Correct the older contradictory
`repair-guard.test.cjs` expectations to this approved contract in a separate
commit; verify marked skips and retained unmarked routing using offline tests.
This is an explicit product-behavior decision, not a dependency-driven assertion
weakening. No handler behavior change, deployment, or retirement is authorized.

## Latest execution authorization

The user grants the agents executive discretion to finish remaining implementation
and validation tasks without further routine approval, maintaining production
safety, clean maintainable code, worktree isolation, and coherent commit checkpoints.
Leave Claude API credentials until the very end. This supersedes earlier per-edit
approval checkpoints for these remaining tasks; retain specific privacy decisions,
deferred purchases, and no production deployment or billing change. Report genuine
end-to-end results and unavoidable external prerequisites without claiming mock
provider tests establish live-provider validation.

## Binding implementation conditions

- The orchestrator delegates to GPT-6-Sol with medium reasoning effort, with one
  active writer per worktree and explicit file ownership.
- Before removing or replacing code, tests, or documentation that predates this
  pipeline iteration, an agent must send the exact proposal and rationale to the
  orchestrator. The orchestrator must obtain explicit user approval before that
  removal or replacement. Calling material stale or redundant is insufficient.
- Show existing workflow security controls and obtain approval for each proposed
  security change before applying it (item 10).
- Present test coverage in reviewable batches explaining specific scenarios,
  expected behavior, and regressions protected against; distinguish existing
  coverage, proposed additions, executed results, and unverified tests.
- Commit every coherent writing batch before the next batch or a rewrite, using
  a short one-line message without category prefixes. Preserve checkpoints;
  do not amend or squash unless requested.
- Keep paid automation and live deployment disabled pending configuration and
  activation review. Hardware funds are available, including dedicated Mac
  runners and always-on reviewer infrastructure, but specific costs and activation
  remain review checkpoints.
- Preserve the original playbook and archive every deferred/omitted mechanism in
  the future implementation register, with source references and rationale.
- Continue in the existing isolated worktrees under
  `/Users/happiness/src/posetek/.posetek_worktrees/<repository>/engineering-pipeline`.
  These are Git worktrees, not Codex-managed attachments. Primary checkouts and
  other task worktrees are outside implementation scope.
- Preserve the existing uncommitted stray-brace edit in WORKFLOW.md until its
  intended replacement is confirmed. Approval of item 42 is not that confirmation.

## Component decisions

| Item | Component | Approved scope |
| --- | --- | --- |
| 1 | Repository structure | Keep three repositories; linked PRs and exact revisions for coordinated changes. |
| 2 | Technology stack | Keep current stack; Redis may be evaluated later for a concrete need. |
| 3 | Worktree isolation | Exclusive worktrees and clear ownership for implementation agents. |
| 4 | Commit checkpoints | Commit every coherent batch; preserve intermediate history. |
| 5 | Developer instructions | Reconcile guidance and local commands; older replacements require separate approval. |
| 6 | Current baseline | Record exact commits, commands, runtimes, failures, and skips against pulled code. |
| 7 | Test quality | Audit protected behaviors and gaps; explicitly explain tests in batches to the user. |
| 8 | CI scheduling | Fast required PR coverage plus expensive scheduled/release checks; review any coverage moved out of PRs. |
| 9 | Required gate | Preserve a stable gate that rejects failures, cancellations, and unexpected skips. |
| 10 | Workflow security | Show existing controls and obtain approval before applying security changes. |
| 11 | Reproducibility | Validate runtimes, tested Python locking, and lockfile-keyed dependency caches. |
| 12 | Website build/lint | Adapt to Astro and verify lint; separately approve removal of older steps. |
| 13 | Browser coverage | Adapt smoke tests and add focused authenticated emulator journeys with batch explanations. |
| 14 | Functions/tooling | Retain suites and fill permission, retry, duplicate-request, and observable-behavior gaps. |
| 15 | Gateway | Revalidate tests/replay and network safeguards; distinguish replay from live model evaluation. |
| 16 | Processing coverage | Inventory and reuse existing tests first, establish assets/runners, then present gaps before proposing additions. |
| 17 | Firebase rules | Keep mobile canonical ownership, discovery, exact-byte receipts, and guarded publishing. |
| 18 | Cross-repo integration | Exact mobile rules revision for web tests; trusted retrieval separated from PR execution. |
| 19 | Compatibility | Focused API/data/streaming/rollout checks; supported older-client versions need user decisions. |
| 20 | Native CI | Prepare dedicated Mac build/XCTest setup and review requirements/cost before enabling. |
| 21 | Physical device | Reuse app diagnostics and physical-iPhone acceptance; review scenarios/devices/thresholds first. |
| 22 | Live AI evaluation | Prepare synthetic cases, quality criteria and spend limits; paid runs remain disabled. |
| 23 | Exceptions | Explicit failure/flake/skip ownership and resolution criteria; no silent weakening. |
| 24 | Merge protection | Prepare PR/CI/human-review/stale-approval rules and emergency policy; review before activation. |
| 25 | Code ownership | Real maintainer assignments and reviewed CODEOWNERS enforcement. |
| 26 | Security scanning | Prepare updates/scans after support/cost assessment; review blocking criteria and no automatic upgrade merges. |
| 27 | Advisory reviewer | Prepare bounded per-revision findings, visible incomplete/stale results, no approve/merge/deploy/edit authority. |
| 28 | Reviewer trust/budget | Trusted policy, isolated untrusted input, validated publication, reviewed model/provider and hard limits. |
| 29 | Staging | Prepare isolated Firebase/GCP configuration with synthetic data; review costs before provisioning. |
| 30 | Deployment identity | Prepare scoped identities, environment approvals and serialized deployment; review security before applying. |
| 31 | Website release | Verify Astro against guarded exact-artifact promotion and inspect Netlify publishing before automation. |
| 32 | Gateway release | Preserve canonical publisher and tested-image candidate/promotion process. |
| 33 | Functions/indexes/data | Prepare release order, readiness, compatibility and recovery; execution disabled pending review. |
| 34 | iOS distribution | Preserve signing/TestFlight/device/human approval and traceable build evidence. |
| 35 | Release/rollback | Automated source/artifact/rules/approval records and isolated recovery rehearsals; production policy reviewed. |
| 36 | Production checks/drift | Prepare scoped synthetic checks, release-based drift and alert routing; retain current alarm until replacement approved. |
| 37 | Operations | Inventory monitoring/owners/backups/recovery targets; propose gaps and isolated drills before activation. |
| 38 | Speed/cost | Measure before optimizing; review sharding/selection proposals affecting coverage. |
| 39 | Queue/previews | Defer merge queue and full-stack per-PR previews; retain as future candidates. |
| 40 | Autonomous engineering | Defer and archive ticket agents, repair loops, main writes, model upgrades and elaborate reviewer coordination. |
| 41 | Additional mechanisms | Defer and archive confidence gates, production clones, blanket failure tolerances, stateful auto-rollback, registries and extra notifications. |
| 42 | Documentation integrity | Confirm stray-brace repair, consolidate decisions/conditions and future register; older replacements need approval. |

A dedicated Firebase backend repository is a future possibility explicitly noted
by the user; it must not change the current item 17 implementation.

## Future implementation register

This preserves ideas rather than approving later activation. Reconsider each with
evidence, a scoped proposal, costs and explicit approval; unsafe original mechanisms
may need redesigned alternatives. The source workbook remains intact at the PoseTek
root in `agentic-engineering-playbook/`. See DECISIONS.md D01–D25 for the original
detailed concerns; the completed documentation pass must cross-check all twelve
playbook files and retain any additional omissions instead of silently dropping them.

| Future candidate / original mechanism | Source | Reason deferred / reconsideration condition |
| --- | --- | --- |
| Monorepo and alternative data/platform stack | 01, 08, 09, 11; D01–D02 | Separate migration decision justified by ownership or infrastructure needs. |
| Redis | User item 2 clarification | Concrete caching, rate-limit, queue, or coordination need; no current stack change. |
| Dedicated Firebase backend repository | User item 17 clarification | Explicit later ownership/migration project; current rules remain mobile-owned. |
| Personalized skills per GitHub account, identity hooks and skill syncing | 02, 03; D03 | User wants future consideration; establish identity/privacy/maintenance design first. |
| Mandatory specialist agents and extra command orchestration | 02, 03; D03 | Keep ordinary small changes lightweight; revisit measured coordination needs. |
| Ticket-driven agents, bot identity, tracker writes, repair/reflection loops | 04, 10, 11; D04 | Need tracker choice, bounded authority, operational ownership and budget. |
| Confidence-based gates and automatic model resolution/upgrades | 04; D05 | Self-reported confidence is insufficient; evaluate calibrated evidence and reviewed upgrades. |
| Direct-to-main learning and workflow bypass | 04, 06; D06 | Prefer reviewed learning PRs; any bypass needs explicit governance. |
| Mandatory cross-provider provenance and diversity | 05; D07 | Select vendor/data policy/budget; provider diversity alone is not independent assurance. |
| Stop-when-clean, unbounded failure retries or natural-language spend grants | 05; D08 | Preserve proposal, but require current-revision evidence and enforceable limits in a redesign. |
| Review sharding, leases, watchdogs and automatic feedback loops | 05; D09 | Revisit only if bounded single-review architecture proves insufficient. |
| Formal AI approval/change-request authority | 05; D10 | Conflicts with approved advisory role; separate future governance decision. |
| On-demand-only CI and privileged status dispatchers | 06; D11 | Automatic PR feedback approved; revisit dispatch plumbing only for a demonstrated need. |
| Merge queue and altered merge conventions | 06; D12 | Measure contention; confirm repository support and preserve commit-checkpoint policy. |
| Full-stack per-PR previews, wildcard routing and preview proxy | 07, 08; D15 | Demonstrated need plus quotas, lifecycle cleanup and reviewed costs. |
| Production-data cloning and temporary access allowlists | 08; D15 | Synthetic data first; any future data proposal needs explicit privacy/access review. |
| Blanket tolerated failures, removed flakes, optional browser/release gates | 09; D17 | Keep concerns archived; prefer owned exceptions and honest failure reporting. |
| Universal coverage targets, E2E metadata catalog and early large-scale sharding | 09; D18 | Establish measured behavioral risk and runtime baseline first. |
| Prohibition on local E2E | 09, 10; D19 | Local reproduction remains valuable; revisit only a specific execution constraint. |
| Automatic rollback of stateful changes | 06, 09; D20 | Demonstrate compatibility and recovery safety before proposing automation. |
| Queue failure swallowing, cron workers, dashboards, prompt registries and extra communications | 01, 06; D21 | Separate product/operations needs; preserve retry semantics and existing systems now. |

## Delegation sequence

Wave 1: website, backend and mobile agents independently inventory and run safe
available baseline checks in their assigned worktrees. The orchestrator owns this
approval record, integration, user checkpoints, and shared documentation.

Wave 2: integration, release-preparation and reviewer work follows baseline findings
and required user approvals. No agent may treat the component-level approval as
permission to bypass a specific removal, security, cost or activation checkpoint.
