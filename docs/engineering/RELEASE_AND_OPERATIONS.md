# Staging, release, and recovery

This is the operational route from reviewed source to an observed release. It
does not activate deployment. Use the [handbook](README.md),
[activation checklist](ACTIVATION_CHECKLIST.md), and separately maintained
[main rollout record](MAIN_ROLLOUT.md) for current stage evidence. The
[proposed staging config](staging.proposed.json) has deliberate unresolved
fields; it is not an active environment definition.

## Stage boundary before a push

Check the actual remote `main` and hosting integration before integrating
pipeline commits. GitHub's ordinary CI, Netlify Git publishing, the guarded
whole-site builders, and the live site have different effects. The verified
staged-source procedure uses `[skip netlify]` in every pushed head, PR title,
and merge commit; check its effect and record it in the
[rollout ledger](MAIN_ROLLOUT.md). Never use `[skip ci]`: required CI must still
run. A source merge is not production artifact promotion.

Capture the current deployed website inventory and its source mapping rather
than freezing an earlier count. Preserve every existing live file unless a
reviewed release explicitly changes/removes it. The guarded website builders
produce `production-dist`; compare the new artifact with the captured live
baseline, verify allowed changes, test a Netlify draft, then promote that
exact digest and record the result. [Website production builder](../../scripts/build-production.mjs),
[application release builder](../../scripts/build-application-release.mjs), and
[release tests](../../scripts/production-baseline.test.mjs) are the source
starting points. A plain Astro build proves compilation, not preservation of
the deployed whole site. Historical 1,697 or later 1,872 file inventories
are snapshots, not the next release acceptance threshold.

## Isolated staging

Use a separate Firebase/GCP project, buckets, identities, secrets, callbacks,
App Check/CORS configuration, synthetic athletes/clubs, test payments, and
controlled email recipients. Never point staging at production project
`kickai-69dd0` or copy athlete records/videos into it. Parameterize every
client and backend project reference before testing; a public preview URL
alone does not isolate data. A gateway revision with zero traffic still has
production resource access and cannot stand in for staging. Deploy identities
should use OIDC with exact repository/ref/environment claims and least
privilege. Keep cloud credentials out of PR jobs. Validate budget alerts,
approvals, receipt capture, health checks, and rollback in isolation before
enabling hosted deployment. The [backend staging proposal](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/STAGING_CONFIG_CHANGE_PROPOSAL.md)
and [release preparation](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/RELEASE_PREPARATION.md)
give backend-specific prerequisites.

## Preserve the canonical publishers

| Component | Reviewed release path | Independent acceptance |
| --- | --- | --- |
| Website | Guarded `production-dist`, Netlify draft, exact-artifact promotion and baseline reconciliation. | Guest and authenticated journeys against the target; every intended file delta, serving behavior and rollback artifact recorded. |
| Gateway | [Canonical `release.sh` path and tested-image flow](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/RELEASE_PREPARATION.md): pushed `main`, immutable image, no-traffic candidate, verification, explicit traffic shift. | [Linux ARM evidence](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/GATEWAY_ARM_IMAGE_VALIDATION_20261007.md) is not production AMD64 qualification. Verify target architecture and image digest. |
| Functions, indexes, data | Follow the [cross-service operations handoff](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/FUNCTIONS_DATA_OPERATIONS_HANDOFF.md), retaining old-client compatibility and scoped backfills. | Reversible deploy order, schema/contract checks, data guard, health and recovery; never treat state rollback as automatic. |
| Firebase rules | Mobile's sole canonical publisher, `firebase/operations.py publish`, with exact-byte test receipt and identity audit. | Trusted reviewed rule source, deployed hash checks, and scoped cleanup; do not weaken authorization to support a rollback. See [mobile rules guide](https://github.com/posetek/posetek-mobile-app/blob/main/docs/RULES_CI_PREPARATION.md). |
| iOS | Primary owner build/XCTest, real iPhone capture and repeated-rep acceptance, TestFlight, then separately authorized distribution. | Matching toolchain/assets/signing, memory/thermal and camera behavior on physical devices. Static Swift parsing and wrapper tests are not native acceptance. See [mobile release checklist](https://github.com/posetek/posetek-mobile-app/blob/main/docs/brand/APP_STORE_RELEASE_CHECKLIST.md). |

No production publisher, Firebase rules, payment, mailing, or mobile-store
action is implied by this guide. The existing rules drift alarm compares
pushed `main` with live rules. Keep it until a reviewed release-receipt-based
replacement is actually implemented and tested; a merge may precede a
scheduled rule publication.

## Receipt, recovery, and operators

For each platform release, record the website, backend, and mobile source
SHAs; built artifact and image digests; canonical rules hashes; client
contract/version compatibility; test and approval results; timestamps;
previous serving artifacts; and exact rollback actions. The
[backend receipt validator](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/RELEASE_RECEIPT_VALIDATOR.md)
and [compatibility/recovery matrix](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/COMPATIBILITY_AND_RECOVERY.md)
describe prepared offline checks. A local structural receipt test does not
prove a hosted promotion, restored data, or healthy users.

Before promotion, name an operator, observation window, service-level
signals, backup/restore route, and stop conditions. On failure, stop further
promotion, preserve evidence, restore the previous serving artifact or traffic
target where safe, and verify client and data compatibility. Escalate
stateful/index/rules rollback for review; restoring an older file or image
does not necessarily reverse writes or authorization changes. Run isolated
recovery drills and record duration before promising an RTO.

## Troubleshooting by boundary

- **Compile passes, site differs:** inspect `production-dist` and the live
  baseline diff, not just `app/astro-dist`. Check Netlify rewrite and
  preserved-file behavior before promotion.
- **PR gate green, provider absent:** ordinary `ci` is not a completed AI
  review or remote branch protection. See [security and review](SECURITY_AND_REVIEW.md).
- **Private-rule or mobile-contract source missing:** fail the integration
  prerequisite and verify the exact reviewed SHA; never copy private rules to
  the public repository or label the ordinary mutable artifact job attested.
- **Gateway test passed only on ARM:** qualify the production architecture and
  image digest separately before traffic shift.
- **Native tests unavailable:** verify the owner-provisioned Mac toolchain,
  valid authorized clips, Pods, simulator/device, and signing. Record a blocked
  prerequisite instead of calling syntax parsing device acceptance.
- **Deployment metadata inconsistent:** compare exact source SHA, artifact
  digest, rules hash and receipt. Halt promotion until the serving state is
  reconciled; don't infer it from a local checkout name or old remote redirect.
