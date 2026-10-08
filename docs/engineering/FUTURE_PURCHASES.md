# Deferred purchases and activation prerequisites

## GitHub Team organization upgrade

Status: **deferred / archived for a future purchase**, at the user's explicit
request. No purchase, billing change, repository visibility change, or protection
activation is authorized by this record. Keep the current GitHub Free plan.

Purpose: enable required PR/status-check protection for the private backend and
mobile repositories. The public website can use supported branch protections on
Free. Automated CI and AI review can still be prepared and run on Free, subject
to their own usage costs and separately reviewed activation.

Until the upgrade and protection rollout are complete, the private repositories'
requirement for passing CI and completed AI review is a team convention, not a
server-enforced merge restriction. Do not label those repositories protected.
A successful workflow run alone does not prevent someone from merging without it.

### Future purchase checklist

- Confirm seat count, current price, renewal terms, taxes, and the actual checkout
  total. Obtain explicit purchase approval; the earlier public pricing snapshot
  is not a quote or authorization.
- Upgrade the `posetek` organization to Team, retaining repository privacy.
- Verify hosted CI and AI-review checks on current revisions before requiring them.
- Require PRs, passing CI, and completed current-revision AI review. Authors may
  merge their own PRs; no independent human approval is required by the current
  user decision. AI findings remain advisory.
- Partial, unavailable, failed, or budget-exhausted AI reviews do not satisfy the
  review requirement. Configure a recorded emergency bypass for designated owners.
- Verify actual protection and bypass behavior after activation; merely purchasing
  the plan does not configure these controls.

Team does not supply required environment reviewers for private repositories.
Private deployment approval is a separate future design/plan decision; do not
represent this purchase as completing production release approval controls.

Sources: [GitHub branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[environment reviewer availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[pricing](https://github.com/pricing). See the [read-only audit](GITHUB_CONTROLS_AUDIT.md).

## Related approved configuration decisions

These supersede earlier proposals requiring an independent human merge approval:

- Temporary GitHub-hosted runners, Python, and Claude Sonnet through Anthropic's
  API; pin the exact model version before activation. No always-on local machine.
- Reviewer has no code-edit, shell, merge, approve, or deployment authority.
- Completed review of every latest reviewable PR revision is required by policy;
  findings are advisory and do not independently block a human merge.
- Approved model-spend ceilings: USD 5 per day **shared across all three
  repositories**, and USD 1 per attempt; failures count. These are ceilings, not
  cost estimates. Shared durable reservation accounting is implemented and tested
  offline in the backend coordinator. Trusted hosted activation, real provider
  billing and publication remain unverified and disabled; see the
  [activation checklist](ACTIVATION_CHECKLIST.md).
- User, `dk242`, and Nolan (user supplied handle `athyleticsOG`) may author and
  merge their own PRs. Verify exact account/team mappings before changing access.
- New maintainers can be granted repository Write access through GitHub; Admin
  access is not required simply to merge subject to the configured checks.

This document records decisions, not a running reviewer or remote configuration.
Other pending proposals retain their existing approval requirements.
