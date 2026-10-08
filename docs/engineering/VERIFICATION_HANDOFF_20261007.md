# Credential-free implementation verification

All implementation batches are committed in the three isolated engineering-pipeline
worktrees. Nothing was pushed, deployed, purchased, or enabled on hosted services.
Claude credentials were left until last. This report separates executed local and
mocked-service tests from external activation and real-device requirements.

## Final source checkpoints

- Website implementation: `3cf767bd708d1d60410eff57b23996cc457e15c0` (this subsequent
  documentation checkpoint only reconciles status and approved configuration).
- Backend: `734e806695e384087603a620adccca73a2971f7b`.
- Mobile: `0c234996cb1d2d42b8f33107d4f5a3518f66c390`.

## Executed checks

| Area | Result and scope |
| --- | --- |
| Frontend | 1,666 tests across 143 files pass in final root run; Astro and marketing builds and static transport preflight pass. |
| Ordinary server | 1,085 pass, three preserved private-history fixture skips, without a mobile checkout. |
| Canonical device contract | Explicit integration command passes against reviewed mobile SHA `3cd973fe0f532a7956f7a439eeba99173b80ecbb`; missing source fails. |
| Authenticated browser | Local Auth/Firestore/Functions/Storage demo journey passes signup, one-time invitation claim, canonical identity, stranger denial and refresh. |
| Dependency policy | Fresh production audits for app/Functions/legacy pass the policy with exact visible, time-limited exceptions; zero critical findings in recorded patched audits. |
| Website policy | 40/40 Python tests; 5 Node artifact-verifier and 3 rules-runner tests pass. Synthetic malformed-input tests intentionally print rejection messages. |
| Gateway Linux | 2,428 pass/3 explained skips and 19/19 replay profiles on recorded ARM production-image overlay. No provider calls. |
| Gateway Firestore | Both actual SDK emulator cases pass (2/2, 0.41 seconds); isolated local Java process stopped afterward. |
| Backend policy/reviewer | 63/63 tests pass, including 46 reviewer tests using mocked GitHub and Anthropic transports. |
| Reviewer negative live API check | Read-only GitHub resolver correctly rejects existing draft website PR 19 before fetching diff or contacting a provider. No GitHub writes. |
| Mobile policy | 20/20 Python tests pass, including actual wrapper log handling and inactive native candidate checks; no native execution claimed. |

The reviewer mock flow exercises resolution, raw diff consistency, shared ledger
CAS reservation, provider bounds, advisory publication and completion. Regression
coverage includes stale base/head, duplicate/concurrent requests, budget denial,
UTC rollover, malformed/partial responses, publication failure, and next-day
successful-scope deduplication. Independent agent review found and corrected
credential-boundary, repository-identity, scope-race and input-validation bugs.

## Remaining external prerequisites

- Private backend coordinator needs a protected main-only environment secret
  boundary and scoped GitHub App credentials. GitHub Team is explicitly deferred;
  do not bypass the limitation using unprotected repository-wide secrets.
- Hosted CI/source artifact handoff and required-check enforcement still need
  actual GitHub runs and configuration. Private rule tests stay on trusted code.
- Configure the company Anthropic account/key last, then perform one bounded
  synthetic live-provider/GitHub-publication smoke before enabling general review.
- The first budget implementation reserves a full USD 1 per attempt, at most five
  daily; the USD 5 envelope covers modeled Anthropic charges, not Actions billing.
  Inspect runner cost separately before enabling scheduled polling.
- Real native build/device validation needs valid missing/empty video fixtures and
  owner-provisioned execution. Primary models/Pods exist, but that is not build proof.
- Production AMD64 gateway qualification is distinct from the successful ARM run.
- Exact dependency exceptions expire October 14, 2026; assess fixes and runtime
  assumptions before expiry. They are not permanent waivers or fixed vulnerabilities.

See [activation checklist](ACTIVATION_CHECKLIST.md) for the ordered handoff and
[implementation status](IMPLEMENTATION_STATUS.md) for all 42 components. The local
Lima VM created for gateway testing has been stopped; its evidence/images remain
available. No other chat's worktrees or processes were modified.
