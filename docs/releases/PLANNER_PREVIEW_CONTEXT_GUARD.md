# Planner preview context guard release

Published November 1, 2026 at 3:42:59 PM PST. Exact reviewed deployment
`6ae7cb8d2a05c4dbbbd9b7e5` was promoted without rebuilding.

[Production receipt](receipts/PLANNER_PREVIEW_CONTEXT_GUARD_PRODUCTION.json) ·
[behavior](../features/PLANNER_PREVIEW_CONTEXT_GUARD.md) ·
[source PR #111](https://github.com/posetek/posetek-website/pull/111).

## Behavior and verification

With whole-body preview enabled, **Preview priorities** previously allowed an
empty training context to reach the gateway. It now waits for the same complete
schedule and equipment confirmation used by generation, explains missing input,
and checks again before loading evidence or submitting. The shared request
builder rejects explicitly supplied incomplete contexts. Context-free legacy
requests retain their behavior; valid Sunday weekday zero remains intact.

Candidate and production checks used the normal signed-in admin session through
supported Safari controls and one owned synthetic player. Missing schedules
disabled preview with guidance; a complete schedule enabled it; a fresh assessment
completed and displayed on each surface. Removing a selected weekday disabled
the candidate action again. Two assessment jobs completed in total. No Auth
account was created, no real player or readiness field changed, and no training
plan was generated or activated. Cleanup removed the owned fixture, both jobs
and their projections. A delayed independent readback checked nine owned paths,
recursive descendants and linked operational records, with zero residue. A late
projection observed after the first cleanup was removed before that readback.
Shared quota counters retain their ordinary expiry. No storage artifact was
referenced by either assessment result.

This verifies the specific preview-context defect. It does not claim an exact
real-player retry, physical-phone acceptance, or resolution of every separate
workout-generation failure. Staff still choose a player's actual schedule and
confirm available equipment; the application does not invent those values.

## Artifact and preservation

All 2,436 artifact files match 2,437 provider records, including generated Netlify
metadata. The artifact SHA-256 is
`b67f64126968a3d07c934f8c7ecc7fadbc4056f34c3a4066e6458910d2ad4de2`.
Compared with the actual preceding deployment `6ae52d6bd807c91041fc511a`, all
2,429 served paths remain present: 2,428 retain exact bytes and only
`/application.html` changes. Seven hashed runtime assets were added. Provider
metadata differs between deployments; effective redirects and headers were
unchanged. Players, Coaches, isolated feedback, coach enrollment and historical
assets remain exact. All 14 production route checks passed.

The fresh provider inventory reconciles the preservation baseline to 2,434 files.
All 37 historical `localPath` recovery records remain. Source main still held
the October 24 baseline; reconciliation includes intervening accepted runtime
assets rather than treating that old source pin as the live predecessor. Every
cache entry was seeded from checksum- and size-verified accepted artifact bytes.
The ordinary `node scripts/build-production.mjs` check passed against all 2,434
protected files. Its generated source-main output was **not uploaded**.

## Source and validation

Reviewed source `9337d1b79e22cf02260bd2f0faa18f0406b0dce8` merged in PR #111 as
`f2871c32014648e3485e14c94e355a278b853440`. The released application was assembled
separately on approved runtime `757cf1b946ab4212634fae1f3cbec690969e320d`.
Assembled commit `698d1b4600834442e191a76ee773ac5d9b704cf2` and qualified runtime
`f4ce1a8bd6b10a967bfb76dd5d98d2689124ae05` have the same static artifact digest.
The later runtime commit qualifies four frozen backend lock/exception files
without deploying functions or changing canonical backend ownership.

Both [source CI](https://github.com/posetek/posetek-website/actions/runs/41361935394)
and [runtime CI](https://github.com/posetek/posetek-website/actions/runs/41363036768)
passed all six jobs. Completed latest-revision advisory reviews found no
actionable findings. Source tests passed 2,203 checks across 196 files; runtime
tests passed 2,068 across 186 files, plus 16 release guards. Source TypeScript,
Astro, lint and static Firestore transport checks passed. Production app
dependency audits reported zero findings.

The app retains Firebase 12.18.0 and Firestore 4.17.1 with scoped gRPC 1.13.6 and
re2js 2.8.7 overrides. The static browser transport guard inspected 120 generated
source HTML/JS files, and Node initialization smoke made no requested database
read/write. This is not server mTLS qualification. Frozen runtime function and
legacy lockfiles received minimal patch updates to replace expired exceptions;
their audits retain 24 and 32 lower-severity paths respectively, with zero
blocking paths. Their qualification passed 1,256 server tests with three existing
private-fixture skips, 13 legacy tests and five artifact checks.

## Future releases and recovery

Do not merge the runtime branch into main or deploy all of source main. Held
policy, session and Ball Striking candidates remain excluded. Preserve the current
accepted runtime, existing results behavior, isolated entries and retained assets
when composing a follow-up. Keep `[skip netlify]` on source, PR and receipt
integration; ordinary Git publishing remains enabled for main.

No backend, gateway, rules, indexes, catalog or native release is included.
Private support identities, fixture identifiers, raw captures and operational
paths are outside this repository. The verified previous deployment is a recovery
reference; no rollback was performed. Any correction must be checked against the
current serving inventory and must preserve unrelated accepted surfaces. A
website recovery does not reverse business data.
