# Pipeline main integration

This is the current integration ledger for the engineering handbook and pipeline.
Start at [the handbook](README.md) for navigation, or the [42-item approved plan](APPROVED_PLAN_20261007.md)
for scope and decisions. Historical verification records remain intact and do
not certify subsequent revisions.

## Stages and acceptance

| Stage | Scope | Acceptance before merge | Status |
| --- | --- | --- | --- |
| 1 — Documentation | Central website handbook and backend/mobile companion guides. | Review staged scope, navigation, factual readiness labels and preservation of existing product guidance. | Merged in all three repositories; links below. |
| 2 — CI and tooling | Automatic PR/main checks, behavioral tests, developer commands, dependency policies and disabled reviewer/native/contract candidates. Website dependency patches accompany the audit gate so its baseline is reproducible. | Fresh-main integration, local policy tests, hosted CI on the PR revision, inspection of failures and skipped lanes. | Merged in all three repositories after green hosted PR checks. |
| 3 — Runtime safety | Gateway environment validation and release preflight; website test-only emulator bootstrap. | Focused behavior tests, complete affected standing checks, review of release prerequisites and unchanged production configuration. | Merged after green hosted PR checks; production activation remains separate. |
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
The local backend `origin` URL was normalized to that verified canonical repository
during integration; linked primary files and branches were not switched or edited.

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
| Website documentation | [#41](https://github.com/posetek/posetek_website/pull/41) | `e52cf41a0214d8a910db72e861c108ad80231fe0` | Documentation scope, navigation and whitespace checked; no existing hosted CI; Netlify skipped. |
| Backend documentation | [#10](https://github.com/posetek/posetek-backend/pull/10) | `baa5056568f09eb76a9bab36435b77ed4ab99ae9` | Documentation scope, local links, JSON and whitespace checked; no existing hosted CI. |
| Mobile documentation | [#36](https://github.com/posetek/posetek-mobile-app/pull/36) | `38b53f123c4aff64dafcc50f8ab313b31c0c8004` | Nine documentation paths, navigation and whitespace checked; no existing hosted CI. |
| Website CI/tooling | [#42](https://github.com/posetek/posetek_website/pull/42) | `c21cee5737c35f2ca77952031c5405d305745661` | [PR run 37746753545](https://github.com/posetek/posetek_website/actions/runs/37746753545): all six jobs passed. Build 1m42s, unit/lint 45s, server 47s, dependency audit 29s, policy 7s, aggregate 3s. Netlify skipped. |
| Backend CI/tooling | [#11](https://github.com/posetek/posetek-backend/pull/11) | `46bae9df8a3cea3497889b784f2c6285181c59e8` | [PR run 37746126865](https://github.com/posetek/posetek-backend/actions/runs/37746126865): all four jobs passed; 2,416 gateway tests passed/2 emulator cases skipped without the optional emulator; 19 authored replay cases passed. Gateway lane 9m21s (pytest 462.40s). |
| Mobile CI/tooling | [#37](https://github.com/posetek/posetek-mobile-app/pull/37) | `c15d56094119189edd352d623a4f53bdb67c8fcf` | [PR run 37746363445](https://github.com/posetek/posetek-mobile-app/actions/runs/37746363445) and [main run 37746815933](https://github.com/posetek/posetek-mobile-app/actions/runs/37746815933) passed all five jobs. Rules 1,232 passed/zero skips; PR rules lane 2m4s, Swift syntax 45s, operations 11s, policy 14s, aggregate 4s. No native build. |

| Website authenticated validation | [#43](https://github.com/posetek/posetek_website/pull/43) | `61f8b0c19fecc01f91c389643c6741ccf6b01836` | [PR run 37747539136](https://github.com/posetek/posetek_website/actions/runs/37747539136) and [main run 37747963151](https://github.com/posetek/posetek_website/actions/runs/37747963151) passed all six jobs. Test-only Firebase bootstrap, pinned private-rule source guard and authenticated harness are merged; local four-emulator journey passed separately. Netlify skipped. |
| Backend runtime safety | [#12](https://github.com/posetek/posetek-backend/pull/12) | `2107f6ce6cfc6014c2093bd88a0f88538ec22173` | [PR run 37747584674](https://github.com/posetek/posetek-backend/actions/runs/37747584674) passed all four jobs: 2,440 gateway tests passed/2 optional emulator skips, 19 replay cases passed, 67 CI-policy tests passed. Gateway lane 5m27s (pytest 253.17s). [Post-merge run](https://github.com/posetek/posetek-backend/actions/runs/37748280686) tracks the exact merge. No deployment or live service configuration change. |
| Mobile evidence documentation | [#38](https://github.com/posetek/posetek-mobile-app/pull/38) | `0c2fa439d811a1bc3d6ccdcfe6fb63cc2376855f` | [PR run 37747307295](https://github.com/posetek/posetek-mobile-app/actions/runs/37747307295) and [main run 37747690106](https://github.com/posetek/posetek-mobile-app/actions/runs/37747690106) passed all five jobs; rules 1,232 passed/zero skips. Companion guides distinguish active checks from native/reviewer activation still held. |

Hosted integration exposed two previously local assumptions: the website frontend
parity assertion needed private sibling source, and the Mac runner did not include
`rg`. Both were fixed before merge. Website frontend and server byte parity now
run together in the explicit integration command, which fails without reviewed
source; ordinary frontend tests remain self-contained. The existing Swift wrapper's
fallback handles the hosted Mac. Legacy upload routing/repair tests were also
added to the required website server lane. No failing assertion was replaced with
a successful skip.

The durations above are first hosted observations, not performance SLOs or billing
predictions. They include runner setup where stated and vary with platform/load.
The two optional backend emulator cases also passed separately in local trusted
emulator validation recorded in the historical handoff. That separate result does
not turn their hosted skips into hosted emulator coverage.

See [activation checklist](ACTIVATION_CHECKLIST.md), [security and review](SECURITY_AND_REVIEW.md)
and [release and operations](RELEASE_AND_OPERATIONS.md) for deferred activation,
cost, ownership, missing prerequisites and future implementation details.

## Remaining activation boundaries

All 42 items are navigable in the [component map](COMPONENT_MAP.md). Source
integration does not close the following operational requirements:

- AI reviewer: supported trusted hosting and protected identity, scoped GitHub App
  access, durable ledger initialization, current model/price validation and actual
  publication evidence. Claude credentials remain last; GitHub Team is deferred.
- Dependency risk: three exact-path exception files expire 2026-10-14. Review
  upstream fixes and runtime reachability before expiry; never silently renew.
- Native/device: authorized usable assets, qualified Mac toolchain and actual
  build/XCTest/physical-device acceptance. Swift parsing remains syntax-only.
- Cross-repository: trusted schema/fixture source delivery and its ordinary PR
  consumer are not active partner attestations. Canonical rules stay private.
- Staging and release: provision isolated infrastructure, qualify production AMD64
  images and reviewed gateway environment variables, configure deployment identity,
  and execute the owning release procedures only with release authorization.
- Operations: actual restore drills, alert routing, supported client acceptance,
  live-model quality evaluation and measured recurring costs remain distinct from
  source-level tests and preparation documents.

The current integration preserved original checkpoint commits and original
playbook material. Historical records remain evidence of their dated state;
the map, current guides and this ledger identify subsequent changes.
