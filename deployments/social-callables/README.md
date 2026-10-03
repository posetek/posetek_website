# Scoped social callable release

This package prepares, preflights and verifies exactly fourteen existing social
callables. It never deploys, changes IAM, sends mail or publishes rules. Root
`functions/index.js` is not a deployment entrypoint for this scope.

Existing targeted releases left different service and storage-helper versions on
some endpoints. Preparation captures all fourteen exact version ZIPs, IAM
policies and the complete `us-central1` inventory. It pulls **each endpoint's
unchanged service implementation and dependencies from its own live ZIP**.
Differing implementations are retained under `endpoint-deps/<endpoint>/` and
selected by an immutable `implementation-roots.json`. Package dependencies must
agree; a difference in their lockfiles refuses the unified bundle. Only the
scoped entrypoint and request-observation wrapper are new. A separately approved
feed optimization requires its own reviewed composition and receipt.

The existing `requireCaller` body is extracted from every captured entrypoint and
must equal the scoped entrypoint's body. The manifest binds those fourteen source
hashes and the unchanged caller hash. Preparation refuses a caller mismatch; it
does not quietly adopt a newer root-entrypoint identity contract.

Runtime options come from the current ACTIVE Node 22 endpoints. The reviewed
profile is 120 seconds, 256 MB, the existing App Engine service account, HTTPS
callable transport and public ingress. Existing minimum/maximum limits are
retained when present; absence is not replaced with an invented limit. Full
environment, build configuration and all IAM bindings remain comparison evidence.
Preparation does not set a new codebase label on the existing functions.

Run the tests, then prepare a fresh ignored directory using the existing owner
session. It reads that short-lived session without printing or copying the token.

```powershell
$python = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python -B deployments/social-callables/test_prepare.py
node --test deployments/social-callables/scoped-entrypoint.test.cjs
$releaseDir = '.netlify/social-callables-release-YYYYMMDDTHHMMSSZ'
$credentialFile = '.netlify/user-issues/owner-session.json'
& $python -B deployments/social-callables/prepare.py --mode prepare --run-dir $releaseDir --credential-file $credentialFile
```

The manifest binds all source bytes, endpoint-specific unchanged helper hashes,
runtime options, original configuration/IAM/source receipts and a candidate
digest. If capture completed but composition refused, `--mode compose` can
recover those exact ZIPs only when fresh inventory/IAM still match and no valid
manifest/source directory exists. It never replaces a frozen candidate.
After unrelated, separately verified releases, `--mode reprepare --from-run
<prior-run>` creates a fresh run with the current complete inventory while reusing
the exact captured social ZIPs only if all fourteen social versions and IAM still
match their original capture. It checks the current inventory again before
composition. A changed social endpoint requires a fresh `prepare` capture.

Before any approved deployment, install only the package's locked dependencies,
inspect SDK discovery, and run `--mode preflight`. The operator must coordinate
the deployment window; fourteen v1 updates have no atomic transaction.

```powershell
npm --prefix "$releaseDir/source" ci --ignore-scripts
& $python -B deployments/social-callables/prepare.py --mode preflight --run-dir $releaseDir --credential-file $credentialFile
$targets = (Get-Content "$releaseDir/manifest.json" -Raw | ConvertFrom-Json).only
$env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
firebase deploy --project kickai-69dd0 --config "$releaseDir/firebase.json" --only $targets --non-interactive
& $python -B deployments/social-callables/prepare.py --mode verify --run-dir $releaseDir --credential-file $credentialFile
```

The generated `only` value names every endpoint explicitly. Never substitute
`--only functions`, a root configuration, a whole default-codebase deployment,
or `--force`. This scope has no new event retries or function deletions.

For exact configuration preservation, the existing operator can instead upload
the manifest-bound ZIP and use Cloud Functions v1 **source-only updates** on these
fourteen existing resources: PATCH each function with `updateMask=sourceUploadUrl`
and only its existing `name` plus the new authorized upload URL. Do not include
runtime, environment, IAM or trigger fields in that patch. The preparation helper
does not perform upload or PATCH. Both deployment methods must pass the same
post-deployment verifier; unexpected CLI configuration/label changes fail it.
The [Google upload contract](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/generateUploadUrl)
requires a ZIP no larger than 100 MB, the two documented PUT headers, and no bearer
credential on the signed upload. The [source-only PATCH contract](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/patch)
requires an explicit update mask. The guarded release operator keeps progress
receipts private, waits each operation, and refuses automatic resubmission after
an ambiguous patch acknowledgement. Reconcile that original operation and exact
live source before preparing another candidate.

Verification freshly downloads every resulting version and checks exact files,
runtime, limits, service account, labels, environment/build values, transport and
IAM policy. It also requires the complete unrelated regional inventory unchanged.
Firebase's content hash and deployment output IDs may change; permission or
configuration changes cannot be dismissed as metadata. CLI-added runtime config
is accepted only when it contains exactly this project's Firebase project and
storage bucket. New/unexpected archive files, local drift or concurrent source/
IAM changes fail verification. No receipt is written as successful after failure.

Rollback ZIPs and their original versions/configurations/IAM remain private under
the run directory. Do not deploy a rollback through the root entrypoint. A live
source readback proves package/configuration preservation; it does not prove that
a real timed-out user action was repaired or that its notification was delivered.
Use genuine correlated activity and fresh shared Excel evidence for acceptance.
