# Scoped player password recovery release

This package exports exactly ten reviewed callables: the six player/request
endpoints and the four existing shared access-link transports. It retains the
existing default-codebase ownership and runtime settings for those four. Only
the explicit endpoint filter below may be deployed; never deploy the central
functions entry, all default-codebase functions, rules, hosting, or the gateway.

Source is `functions/account-access.js` and `functions/account-recovery.js`.
`prepare.py` stages their exact runtime dependency closure, captures previous
source archives/configuration/IAM, and checks that unrelated function records
stay unchanged. Verification checks uploaded source bytes, actual configuration,
transport/IAM and preserved existing settings. Operator receipts, browser
credentials and generated artifacts belong inside ignored `.netlify`.

## Prepare, publish, verify

Run source/backend/frontend and canonical rule checks first. Commit and push the
reviewed source using `[skip netlify]` before publication. Refresh the existing
authorized Firebase CLI session using a read-only command; no token is printed:

```powershell
firebase projects:list --json --non-interactive
node deployments/account-recovery/owner-session.cjs .netlify/account-recovery-owner.json
python deployments/account-recovery/prepare.py --mode prepare --run-dir .netlify/account-recovery-backend --credential-file .netlify/account-recovery-owner.json
npm --prefix .netlify/account-recovery-backend/source ci --ignore-scripts --no-audit --no-fund
firebase deploy --only "functions:getAccountAccessLink,functions:completeAccountAccessLink,functions:listAccountAccessLinks,functions:revokeAccountAccessLink,functions:inspectPlayerRecovery,functions:issuePlayerRecovery,functions:submitAccountRecoveryRequest,functions:listAccountRecoveryRequests,functions:updateAccountRecoveryRequest,functions:confirmAccountRecovery" --config .netlify/account-recovery-backend/firebase.json --project kickai-69dd0 --non-interactive
python deployments/account-recovery/prepare.py --mode verify --run-dir .netlify/account-recovery-backend --credential-file .netlify/account-recovery-owner.json
```

The six new endpoints have explicit instance caps; public intake uses 30 seconds
and ten instances, the five authenticated endpoints 60 seconds and five
instances. Existing get/complete keep 120 seconds and list/revoke 60 seconds,
without changing their instance configuration. All require the ordinary callable
public transport invoker; privileged application authority remains in the handler.
No secret binding is added. On any partial rollout, retain the private inventory,
rollback archives and CLI evidence; inspect current versions before a retry.

Add only the two composite indexes, two new `expiresAt` TTL policies, and the
canonical staff-membership collection-group equality index. Existing member
field indexes are retained. Default is read-only; `--apply` is explicit:

```powershell
python deployments/account-recovery/storage.py --credential-file .netlify/account-recovery-owner.json --output .netlify/recovery-storage-before.json
python deployments/account-recovery/storage.py --credential-file .netlify/account-recovery-owner.json --apply --output .netlify/recovery-storage-requested.json
python deployments/account-recovery/storage.py --credential-file .netlify/account-recovery-owner.json --output .netlify/recovery-storage-ready.json
```

Wait for all indexes **READY** and TTL policies **ACTIVE** before exposing the
frontend. Requests expire after 90 days; bounded email/global counters after two
hours. Canonical mobile-owned rules already default-deny the private recovery
collections. Test them through `node scripts/run-rules-tests.mjs accountRecovery`;
this package contains no rule source or publishing command.

## Hosted acceptance and exact website artifact

`web-prepare.cjs <fresh-private-run-dir>` binds the current production deployment
to the committed preservation baseline. It captures provider inventory and the
exact raw Players, Coaches and isolated feedback bytes using Netlify's documented
[raw file media type](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/#get-file).
Use its `marketing-manifest.json` with the guarded application builder. Restore
its checksum-verified `approved-public/feedback.html` after the build because
recovery makes no feedback document change. Verify every candidate provider file
and all predecessor records other than the application/generated metadata, then
perform browser acceptance on the immutable draft before exact draft promotion.
Reconcile the baseline and pass its ordinary preservation build afterward.
Verify production while the accepted local artifact remains intact, before that
ordinary build. If historical HTML aliases are rewritten by Netlify's pretty-URL
serving, seed their baseline cache only with checksum-and-size-verified original
bytes from the accepted artifact or authenticated raw provider API. Never adopt
rewritten served bytes or weaken the checksum guard.

`web-release.cjs` verifies the complete provider inventory against the local
artifact, predecessor preservation, effective routing/headers and new asset
URLs. Netlify's filename normalization is accepted only with collision-free
paths and exact served bytes. Promotion requires successful browser evidence
bound to the accepted artifact digest, retains an intent receipt for interrupted
responses, and publishes only the explicit new reviewed draft without rebuilding.

```powershell
node deployments/account-recovery/web-release.cjs verify-draft --run-dir .netlify/account-recovery-web --deployment-id "NEW_REVIEWED_DRAFT_ID"
node deployments/account-recovery/web-release.cjs promote --run-dir .netlify/account-recovery-web --deployment-id "NEW_REVIEWED_DRAFT_ID" --browser-evidence .netlify/account-recovery-web/browser-evidence.json
node deployments/account-recovery/web-release.cjs verify-production --run-dir .netlify/account-recovery-web --deployment-id "NEW_REVIEWED_DRAFT_ID"
```

The fixture tool does not touch real accounts or send email. Run it only after
the scoped backend and indexes are verified. Fixture account IDs, selected player
IDs and two organizations are freshly reserved; passwords are temporarily saved
in a private `browser-credentials.json` for the hosted and production browser
checks. ID tokens and one-time recovery secrets stay in memory. Never print or
commit the credential file. `check` exercises the real callable contract,
authorization, anonymous intake, routing, concurrent updates, manual sharing,
password completion, fresh sign-in acknowledgement and preserved account/player
state. It intentionally retains fixtures for the website checks.

```powershell
python deployments/account-recovery/acceptance.py --mode prepare --run-dir .netlify/recovery-acceptance --credential-file .netlify/account-recovery-owner.json
python deployments/account-recovery/acceptance.py --mode check --run-dir .netlify/recovery-acceptance --credential-file .netlify/account-recovery-owner.json
# Complete hosted and production browser checks before cleanup.
python deployments/account-recovery/acceptance.py --mode cleanup --run-dir .netlify/recovery-acceptance --credential-file .netlify/account-recovery-owner.json
# After asynchronous projections have settled, perform a read-only independent readback.
python deployments/account-recovery/acceptance.py --mode verify-cleanup --run-dir .netlify/recovery-acceptance --credential-file .netlify/account-recovery-owner.json
```

Cleanup is resumable from `owned.json`, refuses foreign UID/path/credential
bindings, selects grants/requests/audit only by exact owned selectors, removes
descendants only below owned parents, and bulk-deletes only reserved Auth UIDs.
It also removes exact owned player/UID usage roots, intervals, social projections,
share records and any owned workout notification state/outbox, retaining all
unrelated records. The Auth deletion tombstone is `socialPreferences/{uid}`.
No storage, real workout or notification records are created. Shared operational
rate counters remain under their ordinary TTL. Use delayed `verify-cleanup`
readback to catch asynchronous owned projections; verify zero accounts/documents and the
absence of the browser credential file before recording production acceptance.

## Verified privacy erasure

A verified account/privacy deletion request also includes exact-UID erasure of
server-bound recovery requests. The tool never reads contact answers or infers an
account from public claimant names/emails. Unbound public claims need separate
verified operator review; matching a claimed email alone is not an account link.
Existing access-grant/audit retention and Auth deletion remain separate operations.

```powershell
python deployments/account-recovery/erase.py --uid "EXACT_VERIFIED_UID" --credential-file .netlify/account-recovery-owner.json --run-dir .netlify/recovery-erasure/preview-1
python deployments/account-recovery/erase.py --uid "EXACT_VERIFIED_UID" --credential-file .netlify/account-recovery-owner.json --run-dir .netlify/recovery-erasure/apply-1 --apply
```

Use another fresh preview directory for zero-match readback. Apply uses exact
document/revision preconditions; changed or unacknowledged writes do not count as
confirmed deletion. Count-only receipts contain no UID, paths, contact details,
answers or credentials. This is an operator step, not an automatic Auth hook.

Offline checks:

```powershell
python -m unittest discover -s deployments/account-recovery -p "test_*.py"
node --test deployments/account-recovery/entrypoints.test.cjs
node --test deployments/account-recovery/web-release.test.cjs
```
