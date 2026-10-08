# Security, review, and spending

The [handbook](README.md) routes daily and release work. This page distinguishes
code that is prepared, locally tested, remotely configured, and actually
enforced. The [read-only GitHub controls audit](GITHUB_CONTROLS_AUDIT.md)
captured remote settings on 2026-10-07; recheck those settings before relying
on them. Local workflow tests cannot establish branch protection.

## PR trust and review

The website is public; backend and mobile are private. Repository-authored CI
and its policy tests are mutable by a PR author and remain ordinary code
review evidence. The website's aggregate `ci` checks policy, production
dependencies, unit/lint, server, and build/browser lanes. Its
[PR #42 hosted run](https://github.com/posetek/posetek_website/actions/runs/37746753545)
passed; required-check settings and continued enforcement still need separate
verification. On the current
GitHub Free organization, private backend/mobile merge protection is a team
convention rather than an enforced rule. GitHub Team is explicitly deferred;
its future purchase and configuration are in [deferred purchases](FUTURE_PURCHASES.md).

The approved target allows authors to merge their own PRs after passing CI
and **completed** advisory AI review of the latest reviewable revision.
Findings do not automatically veto a merge. Partial, unavailable, failed, or
budget-exhausted review does not count as completed; a designated owner
emergency bypass must be recorded. Independent human approval is not a current
requirement. No reviewer provider is active merely because the offline
coordinator and [report contract](REVIEWER_REPORT_CONTRACT.md) pass mocked
tests. The trusted reviewer coordinator is prepared in the private
[backend repository](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/REVIEWER_IMPLEMENTATION_20261007.md);
it must run from reviewed trusted code with an appropriately scoped GitHub App
identity and environment/branch controls before receiving credentials. It has
no code-edit, shell, merge, approve, or deployment authority.

## Shared Claude budget

The approved ceilings are **USD 5 per UTC day across all three repositories**
and **USD 1 per attempt**, including failures. Initial enforcement reserves the
full USD 1 for each attempt in a durable shared ledger, so at most five attempts
can start on a day under that conservative design. The exact Claude Sonnet
model/version and price snapshot must be pinned before activation. Successful
reviews of an unchanged scope are not charged again merely because the date
changes. No API key, paid call, billing activation, or reviewer check
publication is established by local mocked tests. Follow the
[activation checklist](ACTIVATION_CHECKLIST.md); configure the company-owned
provider key last and never put it in source, logs, chat, or PR artifacts.

## Private source and credential boundaries

The mobile repository is the sole canonical source of Firestore and Storage
rules. Keep those rule bytes private. Local trusted-code emulator tests can
read them; public website PR code and public artifacts cannot. The separately
prepared mobile contract producer allows a human-reviewed full 40-character
mobile SHA on trusted `main` and stages only the approved schema and synthetic
fixture allowlist. Its environment and hosted artifact delivery are not
activated. Treat a future source payload as public disclosure: review exact
files before release. The website [ordinary PR artifact consumer](../../ci/mobile-contract-pr-job.yml)
is intentionally a candidate, mutable by PR code and not a privileged
attestation. A separate tamper-resistant privileged verifier was deferred;
do not claim canonical partner parity as part of standing `ci`. See
[development and validation](DEVELOPMENT_AND_VALIDATION.md) for the explicit
local integration command.

Keep source retrieval and any secret-bearing steps in trusted jobs with
main-only policy and protected environments. Never run arbitrary PR code with
private rules, the mobile source token, a GitHub App private key, or the Claude
key. Read-only token scope reduces damage but does not make PR-authored code
trusted. A workflow `if` condition alone is not a secret boundary if the
workflow can be edited on an unprotected branch.

## Dependency gate and exceptions

The local [dependency policy](../../ci/DEPENDENCY_POLICY_CANDIDATE.md) audits
the three committed production npm graphs: app, active Functions, and legacy
upload processor. It prints high/critical advisory paths, blocks new paths,
severity increases, malformed or missing scanner evidence, and expired
exceptions. It does not edit a lockfile or auto-merge an upgrade. Hosted
behavior is unverified until the integrated workflow runs.

Exact-path, seven-day exceptions expire **2026-10-14**. The designated
maintainer `taiyyoson` is named in the files under delegated orchestrator
assessment; this is not a claim of separate human risk acceptance. The app
exception concerns Firestore's pinned Node gRPC transport, which is absent
from the inspected static browser output; the required static-build guard
must remain and an SSR/adapter change voids the assessment. Active Functions
and legacy each retain a `node-forge` advisory path through `firebase-admin`:
the inspected use parses a trusted service-account private key and does not
call the vulnerable signature-verification API. These are contingent
assessments, not fixes. Reassess before expiry and on any dependency path,
input, hosting, or SDK change; do not silently renew or broaden them. The
[exception registry](EXCEPTIONS.md) separately tracks historical test skips
and incomplete verification.

## Review before activation

1. Integrate reviewed source and observe real hosted checks on the intended
   revision; verify check names and conclusions. Do not infer enforcement from
   YAML or from a successful local fixture.
2. Check actual GitHub plan, branch/environment controls, source artifact
   permissions, scoped identities, budget-ledger durability, and current
   production advisory graph. The [controls audit](GITHUB_CONTROLS_AUDIT.md)
   is a dated starting point, not a substitute for a current read.
3. Confirm the intended hosting integration and source-preservation build
   before any source push that could publish. Require an exact SHA, artifact
   digest, expected release diff, and rollback path for promotion.
4. Enable provider credentials only after those boundaries are verified and
   one bounded synthetic live review is approved and observable. A red or
   inconclusive provider run must remain red; never publish a false green.
