# Diagnostic-derived device reporting release

This scope exports only `getDeviceProcessingV1` and
`observeDeviceProcessingManifest`. It does not deploy rules, indexes, other
functions or the optional native performance-facts pipeline. Both handlers use
Node 22, 512 MiB and 120 seconds; max instances are 10 (callable) and 5 (observer).
The observer listens to finalized objects in `kickai-69dd0.firebasestorage.app`
and retries transient failures. The callable is HTTPS-only and authenticates
verified nonanonymous `@posetek.net` admins in its handler.

Prepare the exact local dependency closure (no install, network or deployment):

```
node deployments/device-processing/prepare.cjs /private/tmp/NEW-device-processing-release
```

Review its source manifest, tests and the current live function inventory first.
Use `gcloud functions deploy` with the two explicit entrypoint names, explicit
project `kickai-69dd0`, region `us-central1`, `--no-gen2`, runtime `nodejs22`, and
the prepared `source` directory. Set `--security-level=secure-always` explicitly
on every callable update: gcloud otherwise defaults to optional HTTPS. The
observer uses `--trigger-event=google.storage.object.finalize`,
`--trigger-resource=kickai-69dd0.firebasestorage.app` and `--retry`. Preserve the
existing service account `kickai-69dd0@appspot.gserviceaccount.com` and audit all
unrelated function versions afterward. Do not deploy the root functions directory.

Current rollout: callable version 4 and observer version 2 are deployed and
source-verified, with team-session reporting added. 238 manifests were imported
into derived summary version 2; all unrelated function versions are unchanged.
The prior observer pilot also passed. See the
[team-session release receipt](../../deployment/TEAM_SESSION_PERFORMANCE_DRAFT.json)
for the latest exact draft; the preceding device-only draft is superseded. **Callable invoker approval is pending**: automatic approval review
rejected adding `allUsers` / `roles/cloudfunctions.invoker` to the single callable.
Do not retry that IAM change without the user's explicit answer to the pending
question. No proxy, alternate endpoint or wrapper is an approved substitute.
The browser SDK requires this reachability setting, while the handler still
protects all report data. The function currently has no public invoker binding.

After approval and normal execution review: add that binding only on
`getDeviceProcessingV1`; verify unauthenticated, unverified and nonadmin denial
and genuine admin success; test the dashboard against the real callable. Promote
the already-reviewed Netlify draft only after those checks, without rebuilding.
Reconcile its production inventory and update the deployment receipt. Preserve
Players/Coaches marketing and the feedback document/behavior.

See [dashboard contract](../../docs/DEVICE_PROCESSING_DASHBOARD.md) for the exact
import script, schema, bounds and metrics. A second import of the same generations
is idempotent. Do not delete real summaries or restore player data as code rollback.
