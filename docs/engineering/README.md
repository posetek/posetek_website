# PoseTek engineering handbook

This is the entry point for engineering work across the website, private mobile
app, and private backend. The documents describe **prepared source in the
engineering-pipeline worktrees**. They do not assert that the changes are on
`main`, hosted checks have run, secrets are configured, or a release occurred.
Use [the rollout record](MAIN_ROLLOUT.md) for staged integration evidence once
that separately maintained record is present. Never infer production state from
a local green command.

## Start with the task

| Task | Working guide | Evidence and decisions |
| --- | --- | --- |
| Make an ordinary change; run checks | [Development and validation](DEVELOPMENT_AND_VALIDATION.md) | [Website workflow](WORKFLOW.md), [implementation status](IMPLEMENTATION_STATUS.md) |
| Review a PR, dependency finding, or budget failure | [Security and review](SECURITY_AND_REVIEW.md) | [Reviewer contract](REVIEWER_REPORT_CONTRACT.md), [exception registry](EXCEPTIONS.md) |
| Stage, release, recover, or test native/device behavior | [Release and operations](RELEASE_AND_OPERATIONS.md) | [Activation checklist](ACTIVATION_CHECKLIST.md), [rollout record](MAIN_ROLLOUT.md) |
| Understand authorization and all 42 plan items | [Approved plan and future register](APPROVED_PLAN_20261007.md) | [Current configuration choices](FUTURE_PURCHASES.md), [dated decisions](DECISIONS.md) |
| Reproduce an earlier checkpoint | [2026-10-07 verification handoff](VERIFICATION_HANDOFF_20261007.md) | [Original validation baseline](VALIDATION.md), [read-only GitHub controls audit](GITHUB_CONTROLS_AUDIT.md) |

The [project context](../../POSETEK_PROJECT_CONTEXT.md) explains product and
repository boundaries. [AGENTS.md](../../AGENTS.md) contains local agent
instructions. Current explicit user decisions and the approved plan supersede
older process wording in dated records; preserve those records for provenance.
In particular, authors may merge their own PRs after passing CI and a completed
latest-revision advisory AI review. Independent human approval is not a current
requirement. Findings are advisory, while incomplete, unavailable, failed, or
budget-exhausted review does not fulfill the completion gate. Private-repository
enforcement and provider activation remain pending; see
[security and review](SECURITY_AND_REVIEW.md).

## Repository map

These are canonical GitHub paths intended to resolve after the staged changes
reach each repository's `main`. Private links require repository access.

| Repository | Primary guides |
| --- | --- |
| [Website](https://github.com/posetek/posetek_website) (public) | This handbook; [workflow](WORKFLOW.md); [implementation status](IMPLEMENTATION_STATUS.md) |
| [Mobile app](https://github.com/posetek/posetek-mobile-app) (private) | [Engineering workflow](https://github.com/posetek/posetek-mobile-app/blob/main/docs/ENGINEERING_WORKFLOW.md), [build and testing](https://github.com/posetek/posetek-mobile-app/blob/main/docs/BUILD_AND_TESTING.md), [12-playbook adoption audit](https://github.com/posetek/posetek-mobile-app/blob/main/docs/PLAYBOOK_ADOPTION_AUDIT.md), [rules CI preparation](https://github.com/posetek/posetek-mobile-app/blob/main/docs/RULES_CI_PREPARATION.md) |
| [Backend](https://github.com/posetek/posetek-backend) (private) | [Engineering workflow](https://github.com/posetek/posetek-backend/blob/main/docs/ENGINEERING_WORKFLOW.md), [baseline](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/BACKEND_BASELINE_20261007.md), [compatibility and recovery](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/COMPATIBILITY_AND_RECOVERY.md), [release preparation](https://github.com/posetek/posetek-backend/blob/main/docs/engineering/RELEASE_PREPARATION.md) |

The [mobile adoption audit](https://github.com/posetek/posetek-mobile-app/blob/main/docs/PLAYBOOK_ADOPTION_AUDIT.md)
maps all twelve original playbooks (`00`–`11`) to the 42-item plan and the
historical D01–D25 decisions. The original playbooks remain intact. Use the
[approved plan](APPROVED_PLAN_20261007.md) for the current item register, not a
count inferred from a passing test suite. New ideas belong in that plan's future
register before implementation scope is changed.

## Evidence and stage history

| Stage | What is established | What remains distinct |
| --- | --- | --- |
| Original baseline, 2026-09-26 | [Validation](VALIDATION.md) and [D01–D25](DECISIONS.md) record starting findings and decisions. | Some commands, counts, and approval language are historical. |
| Credential-free preparation, 2026-10-07 | [Verification handoff](VERIFICATION_HANDOFF_20261007.md) records exact local checks and source revisions across three worktrees. | Hosted CI, physical-device/native acceptance, production deployment, provider calls, and remote protection were not proven. |
| Subsequent pipeline commits | Website CI includes offline policy, production dependency audits, unit/lint, server, static build, and browser smoke; explicit cross-repository parity and local private-rules emulator journeys are separate. | Source integration onto fresh `main` and hosted results require new evidence. Dated counts are snapshots, not current production inventory. |
| Future activation | [Activation checklist](ACTIVATION_CHECKLIST.md) and [rollout record](MAIN_ROLLOUT.md) define credential, trust, spend, source-preservation, and release checks. | No key, paid review, remote setting, deployment, or purchase follows automatically from code readiness. |

For a production website assembly, verify the current live preservation
inventory dynamically against the intended source and generated artifact. The
historical 1,697-file count is not a current invariant; a later observed live
baseline was 1,872 files and may change again. Record the source SHA, captured
baseline, diff, artifact digest, and deployment receipt for the actual release.

## Non-negotiable boundaries

- The public website never publishes canonical private Firestore or Storage
  rules. Local authenticated emulator runs use private reviewed rules. A public
  PR cannot become a full private-rules parity gate.
- The canonical mobile schema/synthetic-fixture artifact is a separate,
  currently inactive source workflow. Its ordinary PR consumer is mutable CI,
  not a privileged tamper-resistant attestation. The independent privileged
  verifier was explicitly deferred.
- The shared Claude budget is USD 5 per UTC day and USD 1 per attempt across all
  three repositories. No provider key or paid automation is activated by these
  documents.
- The website's public GitHub protection capabilities differ from the private
  backend/mobile repositories on the current Free organization plan. GitHub
  Team purchase is deferred; do not describe private checks as enforced.
- A successful compile, synthetic test, or local emulator run is not a staging
  or production release. Follow [release and operations](RELEASE_AND_OPERATIONS.md)
  and retain exact source/artifact/receipt evidence.
