# Pipeline decisions — September 26, 2026

Status: implementation candidate, not an enabled production pipeline. This is the
decision register for all adaptations and omissions from the supplied 12-file
`agentic-engineering-playbook`. The playbook is reference material, not policy.
The user retains the decision on every flagged item. Pending means **not enabled**,
not rejected. No cloud resources, paid automation, branch protections or deployment
settings are changed by these files.

## Confirmed by the user in this task

- Automatic tests on PRs; human approval and human merge; advisory AI review with
  no merge or deployment authority. This supersedes mobile's old no-PR convention.
- Prepare staging and reviewer configuration/rollout; keep live deployment and
  paid automation disabled until reviewed.
- Work in separate worktrees alongside another active instance.
- Explicitly flag every proposed omission or deviation; the user decides.

## Pending decisions

| ID | Playbook | Concern / difference in PoseTek | Recommendation (not approval) |
| --- | --- | --- | --- |
| D01 | 01, 11 | Converting three repositories to a pnpm monorepo changes ownership, history, iOS tooling and release paths. | Retain repositories now; coordinate compatible changes with linked PRs and a manifest of exact commits. Revisit consolidation separately. |
| D02 | 01, 08, 09 | Postgres/Drizzle migrations, DB branching, Redis, Go proxy and two-product packages describe a different stack. Firebase has no equivalent copy-on-write database branch here. | Keep Firestore/Storage and existing providers. Use emulators and synthetic staging data; no SQL/queue/platform rewrite solely for this playbook. |
| D03 | 02, 03 | Personal identity hooks, symlink skill sync, mandatory specialist agents and approval before every edit add maintenance and friction. Mobile already has canonical AGENTS plus a CLAUDE pointer and mirrored skills. | Keep existing discovery, no personal preference trees or new hooks unless an engineer requests them. Keep small tasks lightweight. |
| D04 | 04, 10, 11 | Autonomous ticket agent, tracker writes, self-repair, reflection and a named bot identity are a separate product with operational costs. No tracker choice or budget is established. | Establish CI/review first; design the ticket agent later. No tracker accounts, ticket creation, messages or autonomous edits in this pass. |
| D05 | 04 | An agent's self-reported 80% confidence is not calibrated evidence. Latest-model resolution changes behavior without a code review. | Record uncertainty and test evidence, pin reviewer models, evaluate upgrades explicitly. No confidence-based merge gate or automatic model upgrades. |
| D06 | 04, 06 | Direct-to-main learning commits and an Actions bypass weaken the same merge protection being introduced. | Propose lessons through normal PRs. No bot bypass or automatic main writes. |
| D07 | 05 | Provider diversity can help but does not guarantee independence; mixed-authorship provenance is incomplete. The playbook itself allows same-provider cold pre-review. | Prefer a different provider when known; disclose unknown provenance; make independent human review mandatory. Decide reviewer vendor/model and budget before enablement. |
| D08 | 05 | Stop-when-clean suppresses review of new commits. Failures not consuming budget and unbounded consent grants can spend indefinitely. | Review each new reviewable head, invalidate stale verdicts, bound all attempts including failures and enforce a daily spend ceiling. No natural-language spend authorization. |
| D09 | 05 | Shards, ref leases, automatic feedback loops and CPU watchdogs are costly bespoke infrastructure for an initial reviewer. | Start one advisory review per head with PR concurrency, strict input/output limits, timeouts and visible unavailable/partial outcomes. Add complexity only after measured need. |
| D10 | 05 | Automatic APPROVE/REQUEST_CHANGES contradicts the approved advisory-only role. Treating all review-steering text as a blocking defect risks false positives in policy proposals. | Findings only; never approve, merge or deploy. Flag actual injection attempts with evidence; evaluate policy-file edits as proposals. |
| D11 | 06 | On-demand-only checks delay feedback; status dispatchers add privileged plumbing. | Automatic PR/main CI and merge_group support. User approved automatic PR tests. No slash-command or label dispatch layer now. |
| D12 | 06 | Merge queue/squash/ALLGREEN requires repository plan support and changes current merge conventions. Zero human approvals conflicts with the approved target. | Require one human approval and a current green gate; preserve merge commits initially. Enable a queue later if contention justifies it. Confirm administrators and any emergency bypass. |
| D13 | 06 | Existing Netlify Git builds may publish on push; default build preserves application bytes rather than releasing changed application source. | Inspect/disable unintended auto-publishing before enabling CD; retain deliberate draft verification and exact-artifact promotion. Do not call the ordinary app build a deployable whole-site artifact. |
| D14 | 06, 08 | Gateway already has canonical release.sh plus tested-image/no-traffic promotion; rules have one guarded publisher. Tags-only CD and branch hotfix deploys would conflict. | Wrap existing publishers after staging/IAM review; no alternate deploy path, no branch-based production bypass. Release manifest references service commits, digests, rules hashes, verification and rollback. |
| D15 | 07, 08 | Per-PR full-stack previews, wildcard DNS, copied production data and temporary DB allowlists aren't necessary for emulator-first Firebase tests. | Begin with local disposable emulators, then one separate staging GCP/Firebase project. Opt-in previews require TTL, quota and tested cleanup. No production data cloning. |
| D16 | 08 | Current rules drift alarm compares pushed main to live, coupling merge to publish. A no-traffic gateway revision still has production service credentials/data. | Propose comparing live rules to an approved release receipt, not unreleased main. No-traffic is a release candidate, not staging. Preserve current alarm until replacement is reviewed and tested. |
| D17 | 09 | Playbook tolerates known migration failures, removes flaky tests, skips browser tests without binaries, and temporarily disables its release E2E gate. These can produce misleading green results. | No blanket failure tolerances or silent skips. Track exact existing exceptions, owners and exit criteria; fix flakes and report quarantine explicitly. Never weaken an assertion to pass. |
| D18 | 09 | Global coverage targets/metadata on every E2E and eight-way shards precede a measured baseline here. | Grow behavior-based coverage at risk boundaries; record duration/failures/skips, then set coverage and performance budgets. Use stable test names before a custom coverage catalog. |
| D19 | 09, 10 | 'Don't run E2E locally' conflicts with fast reproduction. Live LLM evals are variable/costly but replay cannot measure model quality. | Run deterministic local smoke and replay in CI; separately approve synthetic live eval budgets and release criteria. Physical iPhone tests remain essential for camera/memory/thermal behavior. |
| D20 | 06, 09 | Alert-only production smoke plus human-only rollback may prolong an outage; automatic rollback of stateful changes can also be unsafe. | Define service-specific rollback criteria and reversible artifacts first. Decide which stateless failures can automatically roll back; keep state migrations human controlled. |
| D21 | 01, 06 | 'Job handlers never rethrow' could acknowledge failed work and defeat retries. HMAC cron workers, automation dashboards, ticket/release-note emails and admin-editable prompt registries are unrelated product expansions. | Keep current queue/retry semantics; audit idempotency explicitly. Defer new dashboards, generic registries and communications until requested. |
| D22 | Existing repo | Website lint has pre-existing errors; mobile native CI lacks provisioned models, pods, signing and fixture assets. Backend runtime dependencies are mostly unpinned. | Decide lint ratchet vs cleanup; establish portable native runner prerequisites; introduce tested Linux dependency locking separately. Do not claim syntax tests are native build proof. |
| D23 | Cross-repo | Website emulator tests need canonical mobile rules, but private cross-repo checkout needs credentials. gh is unauthenticated in this session. | Use a narrowly scoped GitHub App in a trusted source-fetch job and immutable partner SHAs, then test in a separate secret-free job. Never hand that App token to PR code. Keep this integration explicitly outstanding until wired. |
| D24 | Existing repo | Dependency update automation, secret/dependency scanning and real CODEOWNERS assignments are not configured; adding placeholder owners or treating every audit warning as a release gate gives false assurance. | Confirm owners and scan tooling; first inventory reachable risks, then enable reviewed update PRs and actionable blocking policy. No automatic dependency upgrades or invented owner handles. |
| D25 | Existing repo | Backend local remote still uses the former repository name and its test count differs from newer website release receipts. | Reconcile remote identity and current main before publishing; never assume local main is the currently deployed source. Record exact commits in all evidence. |

## External comparison

Reviewed against primary guidance, not a claim that all large companies use one workflow:

- [DORA continuous integration](https://dora.dev/capabilities/continuous-integration/):
  small batches and rapid automatic feedback; aim for a fast lane under ten minutes.
- [DORA deployment automation](https://dora.dev/capabilities/deployment-automation/):
  simple repeatable deployment and reusable tested packages.
- [Google SRE release engineering](https://sre.google/sre-book/release-engineering/)
  and [canarying](https://sre.google/workbook/canarying-releases/): reproducible
  releases, verification of packaged artifacts, progressive exposure and rollback.
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use):
  immutable action references, least privilege and untrusted-code separation.

Second pass conclusion: adopt the principles of tested changes, bounded automation,
visible failures, least privilege and compatibility. Every stack-specific mechanism
or extra autonomous authority above remains a user decision.
