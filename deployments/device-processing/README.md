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

The user explicitly approved callable public reachability on October 3 after the
initial automatic rejection. `allUsers` / `roles/cloudfunctions.invoker` is now
present only on `getDeviceProcessingV1`; Firebase handler authorization remains
mandatory. Genuine admin requests returned 200; unsigned requests receive JSON
401 with CORS. Do not reopen the resolved approval question.

The completeness follow-up changes reporting only; the observer normalizer remains
summary version 2. Deploy only `getDeviceProcessingV1` from the prepared immutable
source bundle, preserve its invoker binding and HTTPS-only setting, then verify
source bytes and all unrelated function versions. Callable v5 is source-verified from `f996b83` (16 exact files); observer v2 and all
124 other functions are unchanged. See the [verification receipt](../../deployment/DEVICE_PROCESSING_COMPLETENESS.json). Do not promote the superseded website
draft: production changed concurrently and must be reconciled before any hosted release.

See [dashboard contract](../../docs/DEVICE_PROCESSING_DASHBOARD.md) for the exact
import script, schema, bounds and metrics. A second import of the same generations
is idempotent. Do not delete real summaries or restore player data as code rollback.
