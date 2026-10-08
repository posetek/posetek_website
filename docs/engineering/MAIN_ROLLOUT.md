# Pipeline main integration

This is the current integration ledger for the engineering handbook and pipeline.
Start at [the handbook](README.md) for navigation, or the [42-item approved plan](APPROVED_PLAN_20261007.md)
for scope and decisions. Historical verification records remain intact and do
not certify subsequent revisions.

## Stages and acceptance

| Stage | Scope | Acceptance before merge | Status |
| --- | --- | --- | --- |
| 1 — Documentation | Central website handbook and backend/mobile companion guides. | Review staged scope, navigation, factual readiness labels and preservation of existing product guidance. | Preparing documentation-only PRs. |
| 2 — CI and tooling | Automatic PR/main checks, behavioral tests, developer commands, dependency policies and disabled reviewer/native/contract candidates. | Fresh-main integration, local policy tests, hosted CI on the PR revision, inspection of failures and skipped lanes. | Pending stage 1. |
| 3 — Runtime safety | Gateway environment validation and release preflight; website test-only emulator bootstrap and compatible production dependency patches. | Focused behavior tests, complete affected standing checks, review of release prerequisites and unchanged production configuration. | Pending earlier stages. |
| Activation — separate | Provider credentials, supported protected reviewer identity, staging infrastructure, native assets, deployment identity and production releases. | Specific activation checklist evidence, supported hosting/permissions and explicit release authorization. | Held; Claude API key remains last. |

Some repositories can finish with stage 2 because they have no changed deployed
runtime. The final integration must retain all original pipeline checkpoint
commits through merge history; do not squash, amend or replace those checkpoints.
Each new coherent writing batch gets its own short, one-line commit.

## Starting source and concurrent work

| Repository | Fetched main at start | Preservation requirement |
| --- | --- | --- |
| Website | `d495f67` | Preserve the current account recovery, admin and coach work and the current production inventory. |
| Backend | `3ae6972` | Preserve gateway deployment ownership and the canonical release procedure. |
| Mobile | `c53b374` | Preserve processing/replay performance changes, fixture work and existing device validation instructions. |

Integration uses dedicated worktrees inside `.posetek_worktrees/<repository>/`.
Primary checkouts and unrelated PRs remain owned by their existing work. Fetch
again before merging; if main changes, incorporate it and repeat affected checks.
All three repositories belong to the `posetek` GitHub organization; the backend
canonical name is `posetek-backend` despite its historical local directory name.

## Bootstrap review and deployment boundaries

The approved steady-state policy requires passing CI and a completed latest-scope
AI review, with findings advisory and authors permitted to merge their own PRs.
The hosted AI coordinator is **not active during this bootstrap**. Implementation
review and passing checks must not be labeled as a completed Claude review. The
user authorized staged integration before provider-key setup; this bounded
bootstrap is recorded here rather than fabricating a reviewer check. Private
repository branch protections remain unavailable on the current organization
plan; GitHub Team purchase is deferred in [future purchases](FUTURE_PURCHASES.md).

Website branch HEAD commits, PR titles and merge messages use `[skip netlify]`
during this integration. This suppresses Netlify deployment without disabling
GitHub Actions. Never substitute `[skip ci]`. A later unmarked push can build all
merged source, so release owners must still review the complete production
artifact against the current live baseline. Do not confuse a skipped deployment
with a tested production release.

No stage here publishes Firebase rules, Functions, Cloud Run revisions, iOS
builds, production website artifacts, secrets or paid infrastructure. Gateway
release preflight deliberately blocks a later deployment if the target service
lacks explicit reviewed environment/project/bucket configuration. Operators
must follow the backend migration guide before attempting that release.

## Reading documentation during the staged rollout

Documentation lands before the implementation it describes. Links to candidate
workflow/tool paths may become resolvable only at stage 2 or 3; commands are not
available on main until their stage merges. Cross-repository links need access to
the private repository. Proposed workflow files outside `.github/workflows/`
remain inactive even after they reach main. Consult this ledger, actual source
and hosted check conclusions together, rather than inferring activation from a
document title or a historical test count.

## Merge and recovery procedure

1. Review a PR's exact head, changed files and intended stage. Record its URL and
   hosted run before merging. A green aggregate requires every standing lane.
2. Merge with a merge commit after confirming the expected head. Preserve original
   checkpoint history. Do not force-push main or bypass a failed required lane.
3. Verify the remote main SHA and its post-merge checks. Record any service-specific
   gap without claiming native, staging or provider evidence that did not run.
4. If an integrated change is defective, use a focused fix-forward PR or revert
   the specific integration merge (`git revert -m 1 <merge-sha>`) after reviewing
   later dependencies. A source revert does not undo a deployment or data change.
   Follow each canonical release recovery guide for deployed state.
5. Preserve failing logs and relevant receipts. A workflow failure should be
   repaired; deleting the lane or widening an exception is not a recovery plan.

## Evidence ledger

PRs, merge SHAs and hosted outcomes are added here as stages complete. Until a
row records a verified remote result, treat it as pending.

| Repository / stage | PR | Main merge | Validation / remaining limits |
| --- | --- | --- | --- |
| Website documentation | Pending | Pending | Central handbook and historical decisions; no code activated. |
| Backend documentation | Pending | Pending | Backend companion index and operational handoffs. |
| Mobile documentation | Pending | Pending | Mobile companion index, rules/native/playbook mapping. |

See [activation checklist](ACTIVATION_CHECKLIST.md), [security and review](SECURITY_AND_REVIEW.md)
and [release and operations](RELEASE_AND_OPERATIONS.md) for deferred activation,
cost, ownership, missing prerequisites and future implementation details.
