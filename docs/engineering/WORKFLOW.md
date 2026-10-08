# PoseTek engineering workflow

Status: implementation in progress under the user's
[approved 42-component plan](APPROVED_PLAN_20261007.md). See
[implementation status](IMPLEMENTATION_STATUS.md) for completed checks and gaps.
Nothing here enables a cloud deployment, paid reviewer or GitHub ruleset.
[DECISIONS.md](DECISIONS.md) preserves the original playbook adaptations and concerns;
the approved plan records their subsequent decisions and future implementation scope.

## Daily development

1. Write the intended observable behavior and preserved behavior. For a bug, first
   reproduce it. For contracts, identify both clients and every writer/reader.
2. Use a short-lived branch in a separate worktree. Do not switch, stash or reset
   another engineer's checkout. Mobile builds still require the primary owner;
   isolated worktrees may parse Swift, but cannot claim device acceptance.
3. Make a focused change and add the smallest meaningful regression coverage.
   Prefer pure tests for logic, emulator tests for authorization, browser tests for
   user flows and physical-device tests for capture/memory/thermal behavior.
4. Run the relevant local lane, then open a PR using the template. Include actual
   results and remaining gaps, linked companion PRs and compatibility/release order.
5. Automatic CI tests the PR merge commit. The `ci` job succeeds only when every
   lane succeeds; cancellation, failure and skipped lanes cannot satisfy it.
   The target policy requires completed AI review of the latest revision; findings
   are advisory. A human, including the author, may merge without another human
   approval. Partial/failed/unavailable review blocks except a recorded owner
   emergency bypass. Hosted reviewer/enforcement is not yet active.
6. Merge means integrated source. Release requires separate artifact verification,
   environment approval, promotion, smoke, rollback readiness and a receipt.

Keep changes small; avoid turning every fix into a planning ceremony. Existing
tests protect real product contracts and should not be replaced with generic
coverage-count tests. Source-text assertions alone do not prove runtime behavior.

## Current standing lanes

| Repository | PR lanes in this candidate | Important limit |
| --- | --- | --- |
| Website | Hosted PR `ci`: Vitest and lint; Functions/tooling and legacy-guard Node tests; TypeScript/Astro build; Svelte check; marketing build; guest Chromium smoke; policy and production dependency audits | [PR #42](https://github.com/posetek/posetek_website/pull/42) passed all hosted lanes. Ordinary builds do not prove the protected production artifact. Three existing private-fixture tests skip. Canonical mobile contract parity is a separate explicit integration command, not a standing public PR check. |
| Backend | Gateway pytest with live-network guard; authored replay evaluation; legacy processor syntax; workflow contract tests | Replay is not model-quality evidence. Processor syntax is not video/biomechanics coverage. Python dependencies need Linux lock work. |
| Mobile | Canonical Firestore/Storage emulator suites and hash receipt; publishing-tool unit tests; all tracked app Swift syntax; workflow contract tests | No full native build, simulator XCTest, signing or camera acceptance is claimed. |

The website's additional rule suites still need the canonical mobile checkout.
They are **not yet a required hosted lane**: private cross-repo source retrieval
must be wired without exposing its token to PR code (D23). Do not copy rule files
into this repository to remove that dependency.

All three main CI workflows have PR, main-push, merge-group and manual triggers, no path
filters, per-job read permissions, timeouts and immutable action SHAs. The gate
tests exercise its actual shell script against success, failure, cancellation,
skip and malformed/empty evidence. They also reject dangerous workflow mutations.
These tests help prevent mistakes; an author who edits tests and policy together
can change the evidence. Current author-merge policy has no independent human
approval requirement. Server-enforced controls remain an activation prerequisite.

## Local website commands

Use Node 22.23.3, Python 3.12 for policy checks, and the committed lockfiles:

```sh
npm --prefix app ci --ignore-scripts --no-audit --no-fund
npm --prefix functions ci --ignore-scripts --no-audit --no-fund
npm --prefix app test
npm --prefix app run lint
node --test functions/*.test.js scripts/*.test.cjs scripts/*.test.mjs
node --test ci/verify-mobile-contract-artifact.test.cjs
npm --prefix app run check:svelte
npm --prefix app run build
npm --prefix app run build:marketing
node --test ci/check-static-firestore-transport.test.mjs
node scripts/check-static-firestore-transport.mjs
node app/node_modules/playwright/cli.js install chromium
node --test scripts/browser-smoke.mjs
# In your Python virtual environment:
python -m pip install -r ci/requirements.txt
python -m unittest discover -s ci -p 'test_*.py'
python3 ci/run_dependency_audit.py app --baseline ci/dependency-exceptions/app.json
python3 ci/run_dependency_audit.py functions --baseline ci/dependency-exceptions/functions.json
python3 ci/run_dependency_audit.py legacy --baseline ci/dependency-exceptions/legacy.json
```

Browser smoke starts a disposable loopback server on an available port, exercises
the current `app/astro-dist` output, uses separate guest contexts and blocks external HTTP and
WebSocket requests before navigation. It does not log in, seed data, send email,
call a model or claim authenticated end-to-end coverage.

Canonical mobile contract parity for both server and frontend pinned copies is
outside ordinary server and Vitest CI. Set
`POSETEK_MOBILE_REPO` to a reviewed canonical mobile checkout, record its exact
SHA, and run `node --test functions/device-performance-parity.integration.cjs`.
Missing source fails this explicit integration command. A local override does
not complete hosted cross-repository source delivery; the manually dispatched
source workflow is only a preparation candidate until its trusted handoff and
PR gate are verified.

Rules integration, when a reviewed mobile checkout is available:

```sh
RULES_PATH=/absolute/path/to/mobile/firebase/firestore.rules \
STORAGE_RULES_PATH=/absolute/path/to/mobile/firebase/storage.rules \
FIREBASE_BIN=/absolute/path/to/mobile/firebase/node_modules/firebase-tools/lib/bin/firebase.js \
node scripts/run-rules-tests.mjs
```

The runner accepts `RULES_PORT_OFFSET=20000` to isolate ports from other local
emulator users. Choose a distinct offset per concurrent worktree; a bind failure
must not terminate somebody else's emulators. Use isolated runners for hosted
integration, with exact partner SHAs logged.

## GitHub rollout, in order

1. Review the [read-only GitHub audit](GITHUB_CONTROLS_AUDIT.md): website is public,
   backend/mobile private, and private protection requires a plan decision.
   Repository controls were inspected; no remote settings were changed. Hosting
   integration behavior still needs explicit review before any push.
2. Website CI merged after its hosted PR run passed; see the
   [rollout ledger](MAIN_ROLLOUT.md). Review backend/mobile stages separately.
   Run each workflow on GitHub; local results are not hosted-run evidence.
3. Only after green hosted runs and supported plans, protect main: require PRs,
   passing `ci`, and completed latest-revision AI review from trusted check sources.
   Authors may merge; independent human approval is not required. Keep findings
   advisory, restrict and record owner emergency bypasses, and block force pushes
   and deletion. GitHub Team is deferred; private enforcement remains a convention.
4. Assign real owners for `.github/`, agent policy, release scripts, Firebase rules
   and identity/payment code. Do not install placeholder CODEOWNERS handles.
5. Confirm whether Netlify Git publishing is enabled before pushing/merging source.
   Its ordinary build preserves the deployed application, so green Git CI alone
   neither releases new app code nor validates an intended application release.
6. Keep canonical rules private. Run their integration only against trusted reviewed
   code before release; no full canonical-rules gate on arbitrary public PR code.
   Finish native build prerequisites before requiring native gates.

Merge queue is optional and pending (D12); the merge_group trigger is prepared.
Do not enable a queue until its synthetic merge commit demonstrably receives the
required check. Keep humans responsible for merge; the author may perform it.

## Staging and release preparation

[staging.proposed.json](staging.proposed.json) is a proposal, not Terraform or an
active deployment config. Its null fields deliberately need user decisions.

Provision one separate GCP/Firebase project, separate buckets/identities/Secrets,
synthetic athletes/clubs, test payment credentials and controlled email recipients.
Never point staging at `kickai-69dd0` or copy athlete records/video into it. First
parameterize and test the frontend Firebase configuration, Functions/gateway
project references, callback URLs, App Check and CORS. A public preview URL alone
does not provide isolation. A tagged no-traffic production gateway revision still
uses production resources and cannot serve as the staging substitute.

Use OIDC with repository/ref/environment claims and least-privilege deployment
service accounts. Keep cloud credentials out of PR test jobs. Add protected
environment approval and a budget alert before enabling hosted deploys. Build and
test immutable artifacts, record digests, serialize promotions, verify health and
critical synthetic journeys, and record the last successful deployment.

Preserve existing canonical publishers until replacements are approved:

- Website: reviewed `production-dist` from the guarded builders, Netlify draft
  acceptance, promotion of that exact artifact, and baseline reconciliation.
- Gateway: `Services/agent-gateway/scripts/release.sh` from pushed main; exact image
  tests, no-traffic candidate, verification, then explicit traffic shift.
- Rules: mobile `firebase/operations.py publish`, exact-byte test receipt,
  reviewed baseline and identity audit, then deployed checks and scoped cleanup.
- iOS: primary-owner compile/XCTest, physical-iPhone capture and repeated-rep
  acceptance, TestFlight, then separately approved distribution.

A platform release receipt should name all three source SHAs, artifact digests,
rules hashes, supported client contracts, verification results, approver, timestamps,
previous serving artifacts and exact rollback actions. Old mobile clients remain
supported until an explicit minimum-version policy says otherwise. Never roll back
rules to a weaker authorization policy just to restore an old client.

The rules drift alarm currently compares pushed main with live rules. Keep it until
the proposed release-receipt comparison (D16) is reviewed; otherwise an ordinary
merge could create an alarm before a scheduled publish.

## Advisory reviewer preparation

[reviewer.proposed.json](reviewer.proposed.json) and
[the rubric](../../.github/review/CORE.md) are prepared specifications. There is no
running bot or provider key yet. The backend coordinator now implements bounded
Sonnet 5.5 review with the approved shared USD 5/day and USD 1/attempt API envelope.
Its workflow is inactive pending a protected GitHub identity/environment boundary,
ledger setup and final provider credentials. See [activation steps](ACTIVATION_CHECKLIST.md).

The intended implementation has three separate trust domains:

1. Trusted resolver reads the policy from default branch, authenticates the trigger,
   captures exact base/head SHAs and applies attempt/spend limits. Fetch PR content
   as data; do not execute checkout scripts or install its dependencies.
2. Reviewer reads the bounded content with no shell, write, merge or deploy tools.
   A provider credential cannot coexist with execution of PR-authored code.
3. Trusted publisher validates structured output, rechecks the current head and
   posts advisory findings only. Partial, stale and unavailable results are visible.

Before enablement, test malicious diffs, forged output/markers, changed policy,
forks, stale heads, duplicate delivery, cancellation, provider outage and exhausted
budgets. Failures count toward attempts. No auto-fix feedback loop or App write
scope is needed for the initial advisory reviewer. Larger diffs need explicit
partial reporting or human review, not a fabricated clean verdict.

## Next coverage, ordered by risk

1. Authenticated emulator journeys: player code redemption (existing document ID),
   staff invitation, stranger access denial, workout proposal privacy/publication,
   refresh/retry and duplicate submission. Include browser + Functions + rules.
2. Cross-service contracts: exact website/mobile/backend revisions, schema-version
   compatibility, actor/target distinction, SSE completion/error recovery.
3. Native: curated XCTest suites plus fixture assets and an explicitly provisioned
   isolated Mac runner. Real-device capture memory/thermal tests remain separate.
4. Client-side processing: inventory existing native video/golden tests and asset
   hashes first, then review missing malformed-media, cancellation and resource
   behavior. Do not expand retired server processing solely for this pipeline.
5. Operational: staged rollback rehearsal, alert delivery, backup/restore drill,
   service latency/error targets and release recovery time.

Track fast-lane duration, flake/skip rate, escaped regressions, change-failure rate
and recovery time. Expand based on observed risks; test count alone is not readiness.

Known missing-input skips and unresolved evidence are tracked in
[EXCEPTIONS.md](EXCEPTIONS.md); registration does not waive a check.
