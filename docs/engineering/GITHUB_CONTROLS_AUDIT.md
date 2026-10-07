# GitHub controls audit and activation prerequisites

Read-only API inspection on October 7, 2026. No repository settings, visibility,
billing, credentials, branch protection, or environment protections were changed.

## Verified remote identities and settings

| Repository | Visibility | Main protection | Other observed controls |
| --- | --- | --- | --- |
| posetek/posetek_website | Public | No rulesets; branch protection endpoint reports unprotected | Actions enabled; all actions allowed; organization-level SHA pinning not required; default workflow token read-only; workflow PR approval disabled |
| posetek/posetek-backend | Private | Ruleset and branch-protection APIs return 403 with plan-upgrade requirement | Same observed Actions permissions as website |
| posetek/posetek-mobile-app | Private | Ruleset and branch-protection APIs return 403 with plan-upgrade requirement | Same observed Actions permissions as website |

The organization API reports the `free` plan. The older website and backend remote
names redirect to the canonical identities above; local remote URLs were not
rewritten. A plan error is not an inventory of hidden rules, but does block the
protection rollout through the inspected interfaces.

Website and mobile have an existing `copilot` environment with no protection rules
and administrator bypass enabled. Backend has no environments. The proposed
`mobile-contract-source` environment does not exist yet. Existing environments
are unrelated to approval of a new secret-bearing source workflow.

## Prepared protection settings

After successful hosted runs on the actual PR revisions and private-repository
plan support, prepare main protection with:

- Required PR and at least one independent human approval.
- Dismiss stale approvals, resolve review conversations, and require current CI.
- Required `ci` check bound to its observed trusted GitHub Actions source, not an
  arbitrary integration with the same check name.
- No force pushes or branch deletion; preserve merge commits and intermediate
  checkpoint history rather than requiring linear/squashed history.
- Real CODEOWNERS assignments only after the user supplies handles/teams.
- Explicit administrator and emergency-bypass policy before activation; no
  autonomous bot bypass or reviewer approval authority.

The current main workflows pin actions in code, despite the repository policy
not enforcing SHA pins globally. Hardening repository-wide action policy is a
separate concrete security change to review; it could affect other existing jobs.

## Cross-repository source environment

The source producer must execute trusted policy from main under a protected
environment with a human reviewer and main-only deployment-branch restrictions.
The read-only mobile App key belongs only to that environment. Never configure a
repository-wide key and assume the YAML environment declaration protects it.

Website is public and mobile is private. Artifact publication therefore requires
explicit review of data disclosure as well as code-execution isolation. Current
contract schema/fixtures are checked against the existing website pin, but that
does not authorize disclosure of arbitrary future private JSON. The prepared
workflow must copy only reviewed contract data; no native sources, rules, models,
private recordings, credentials, or other repository files.

The producer and consumer are preparation candidates. Existing local parity
success with a partner-path override is not a working hosted PR gate. Complete
artifact provenance and required-check verification before enabling enforcement.

## Decisions remaining

1. Organization plan upgrade for private-repository protection; keep repositories
   private. GitHub Team is the relevant organization plan to evaluate, rather
   than interpreting the API's generic Pro message as a personal-account fix.
2. Real code owners and independent reviewers; PR authors cannot satisfy their
   own required approval.
3. Emergency access, source-environment approvers, GitHub App identity and reviewed
   artifact-disclosure policy.
4. Concrete hosted-run evidence and branch-protection activation approval.

GitHub documents protected branches on private repositories with paid plans and
supports binding required checks to an expected app. See
[protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
and [current plan pricing](https://github.com/pricing). Team's public price is
listed at USD 4 per user per month with first-12-month terms on the pricing page;
seat count, renewal terms, taxes and actual checkout total must be reviewed before
any purchase. This audit does not authorize a billing change.
