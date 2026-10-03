# Expanded Insights scoped backend release

This directory prepares and verifies the nine Expanded Insights
functions. It does not deploy automatically. Existing V1 Insights, personalized
planning, video processing and other functions remain outside this codebase.
The application release and reporting/rules/usage control-plane changes have
separate receipts and rollback steps.

Use the reviewed source and one operator window. Generation 1 deployment does not
offer an atomic compare-and-swap across nine endpoints. Coordinate with other
operators, keep the prepared source immutable, and stop if inventory or IAM changes
unexpectedly. This guide is not a production receipt.

The coach workspace adds one comparison callable and projection version 4. Deploy
all nine functions together so event writers retain the new measured-axis projection.
`recordInsightUsage` is included without behavior changes. Existing testing-event
processors may still write version 3; the report rebuilds those snapshots on demand.
No athlete source record or canonical rule changes.

## Prepare, deploy and verify

Run the offline tests first:

```powershell
python -B deployments/expanded-insights/test_prepare.py
node functions/insights-entrypoints.test.js
node functions/insights-v2-qualification.test.js
node functions/insights-v2-projection.test.js
node functions/insights-v2.test.js
```

Choose a fresh ignored directory for each attempt. The credential file is the
existing short-lived owner session prepared by the operator, with `access_token`
and `expires_at` (milliseconds). Neither credentials nor private receipts belong
in Git. The helper reads that session; it never prints or copies its token.

```powershell
$releaseDir = '.netlify/expanded-insights-release-YYYYMMDDTHHMMSSZ'
$credentialFile = '.netlify/owner-session.json'
python -B deployments/expanded-insights/prepare.py --mode prepare --run-dir $releaseDir --credential-file $credentialFile
npm --prefix "$releaseDir/source" ci --ignore-scripts
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
firebase deploy --project kickai-69dd0 --config "$releaseDir/firebase.json" --only functions:expanded-insights --non-interactive --force
python -B deployments/expanded-insights/prepare.py --mode verify --run-dir $releaseDir --credential-file $credentialFile
```

Use only `--only functions:expanded-insights` with the generated configuration.
The 60-second discovery timeout allows this bundle's dependencies to initialize.
`--force` acknowledges the new event functions' reviewed retry policies during a
noninteractive deployment; keep it restricted to this exact nine-function scope.
Do not use a project-wide `--only functions` deployment or the root Firebase
configuration for this release. The generated codebase exposes exactly:

- `getClubInsightsV2`, `getCoachPlayerComparison` and `recordInsightUsage`.
- `projectInsightPlayer`, `projectInsightRecords`, `projectInsightRevisions` and
  `projectInsightFailures`.
- `projectInsightArtifacts` and `projectInsightArtifactDeletes`.

Before deployment, preparation captures the full `us-central1` function inventory
in `before.json`, every existing owned function's IAM policy in `before-iam.json`,
and its version-specific source ZIP. `manifest.json` records source/configuration/
IAM hashes and exact expected definitions. If any owned endpoint is not ACTIVE,
or the inventory/IAM changes while capturing backups, preparation refuses to
produce a valid release. Schema 1 manifests must be replaced by a fresh schema 2
preparation; they lack the complete definition and IAM checks.

Verification downloads each deployed version and checks every bundled source byte,
the absence of unexpected files, and the unchanged prepared Firebase configuration.
The Firebase CLI may append `.runtimeconfig.json` during upload. The verifier
accepts it only when its complete JSON is exactly `firebase.projectId` and
`firebase.storageBucket` with this release's expected project and bucket. Extra
fields, duplicate keys, differing values and oversized content fail verification.
Its SHA-256 and byte count are recorded without copying configuration values into
the sanitized verification metadata. All fourteen prepared source-file hashes remain
unchanged.
It checks ACTIVE Node 22 endpoints, execution timeouts, memory and maximum instance
counts, exact event resource/type/service/retry policy, callable labels, expected
HTTPS URLs, public ingress and unconditional `allUsers` invoker access. Public
transport access permits Firebase callable authentication to run; the handler
still requires the current authorized user. It does not grant reporting access.

The pinned expected definitions come from the reviewed Firebase SDK `__trigger`
metadata. SDK retry configuration is represented as `eventTrigger.failurePolicy`
by the [Cloud Functions v1 resource API](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions).
That API also defines the 256 MB default used by `recordInsightUsage`.

The verifier rereads inventory and IAM after the source checks to detect concurrent
changes. It writes `after.json`, `after-iam.json` and `verified.json` only after all
checks pass. The unrelated-function preservation comparison covers `us-central1`.
Successful verification still needs live admin/manager/assigned-coach access and
denial checks, historical qualification reconciliation, date/filter/pagination
checks and browser validation before the application is promoted.

## Rollback

Keep `before.json`, `before-iam.json`, every `*-before.zip`, `manifest.json` and the
successful post-deployment receipt. The before inventory includes complete old
trigger, environment, service-account, ingress and runtime configuration; these
may contain private values and must remain ignored. Verify backup hashes against
the manifest before using them.

1. Stop overlapping deployment work. Read the current owned endpoint versions,
   source hashes, configuration and IAM. Continue only if they still match this
   release's verified `after.json` / `after-iam.json`. If another operator has
   changed an endpoint, reconcile that change before touching it.
2. For endpoints present in `before.json`, restore the exact captured source and
   old function configuration. Restore its saved IAM policy using a freshly read
   current policy etag; do not reuse a stale etag or overwrite a newer policy.
   Preserve all old trigger/runtime/service-account/environment fields, not just
   the JavaScript source. A reviewed single-endpoint Cloud Functions v1 update is
   appropriate; this helper deliberately has no automated rollback mutation.
3. For endpoints absent before this release, delete only the exact new endpoint
   names whose current version/source ownership was established in step 1. The
   scoped CLI form is:

   ```powershell
   firebase functions:delete <owned-new-endpoint> --project kickai-69dd0 --region us-central1
   ```

   Do not remove functions by wildcard, project, or shared codebase-wide inference.
   During a partial rollout, only endpoints actually created by this attempt are
   eligible. A failed verification is not proof that an endpoint belongs to this
   release; inspect its current source/version before reverting it.
4. Read back restored configuration, IAM and source bytes; compare them with the
   before capture. Confirm newly created endpoints selected for removal are absent
   and unrelated functions remain unchanged. Coordinate the application rollback
   and any usage-disable or reporting/rules rollback under their separate guarded
   receipts. Do not delete athlete history or restore old projections as though
   they were source records.

IAM capture and restoration use the documented
[getIamPolicy](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/getIamPolicy)
and [setIamPolicy](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/setIamPolicy)
contracts. A failed deploy, expired session or uncertain command result should be
resolved by reading current state before retrying a mutation.
