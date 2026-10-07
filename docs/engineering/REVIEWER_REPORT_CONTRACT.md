# Advisory reviewer report preparation

The hosted reviewer is not enabled. `ci/reviewer_contract.py` implements a pure,
offline validator for a candidate report format, using only synthetic tests.
It does not call a provider, execute PR content, fetch GitHub data, publish a
review, or authorize a release.

## Trusted inputs

The future resolver supplies full base, head, and policy commit SHAs; inspected
repository paths and line numbers; and whether the requested scope was completely
inspected. The report cannot supply or override these trusted inputs. The
publisher must recheck the current PR head immediately before posting; matching
an earlier head is not enough. A future implementation must handle races after
that read and visibly associate every comment with the inspected revision.

## Accepted report

The object contains exactly `base_sha`, `head_sha`, `policy_sha`, `status`,
`summary`, and `findings`. Status is `complete`, `partial`, `unavailable`, or
`not-run`. Summary and each finding's evidence/suggestion are limited to 4,000
characters; at most 50 findings are accepted. Each finding contains exactly
`severity` (P0–P3), `path`, `line`, `evidence`, and `suggestion`.

Paths and lines must belong to the resolver's inspected scope. Unexpected fields
such as approve, merge, deploy, run, or spend_override are rejected. A complete
report is rejected when trusted scope metadata says review was incomplete.
Unavailable/not-run outcomes cannot include findings. Zero findings is allowed
for a complete review but is not human approval.

## Test batch

Run `python3 -m unittest discover -s ci -p test_reviewer_contract.py -v`.

1. Valid scoped findings and zero-finding results are accepted.
2. A changed base, head, or policy invalidates the old report.
3. Truncated scope cannot produce a complete outcome.
4. Unavailable and not-run outcomes stay explicit.
5. Action fields, uninspected paths, and uninspected lines are rejected.
6. Malformed statuses, unexpected fields, and oversized reports fail validation.
7. Invalid trusted resolver metadata is treated as a configuration error.

Seven tests passed locally at `d382a10`. These checks do not establish model
quality, prompt-injection resistance, authenticity of upstream metadata, or safe
GitHub rendering. They establish only the report contract's checked properties.

## Remaining implementation and activation

- Trusted event intake, source resolution and immutable policy retrieval.
- Provider/model selection and repository data-handling approval.
- Durable attempt/spend reservations that count failures and prevent concurrent
  overspending; timeouts and provider response-size limits.
- A tool-free provider adapter and adversarial-diff evaluation.
- Output parsing before this validator, with a byte limit before JSON decoding.
- A trusted publisher that safely renders text, limits mentions/links, handles
  duplicate delivery and stale revisions, and has only advisory-comment authority.
- Reviewed GitHub identity, credentials, daily budget, alert ownership, and
  activation. Provider and budget remain unset in `reviewer.proposed.json`.

The validator is preparation, not a substitute for these controls or a running
review service. The user must see new security and activation proposals before
they are applied.
