# Admin jump recovery review

Source candidate, October 30, 2026. This implements the browser review workflow;
it does not publish a website, backend, rules or native release, change an athlete
record, or send a message by itself.

## Workflow

Open a jump repetition in Admin Rep Tools. The dedicated **Review jump** panel
loads the original recording, its generation and exact presentation timestamps
from the backend. The generic jump-height number editor is replaced by this
review path. Existing technique review remains available separately.

- **Visible marker:** select four corners around the black square, enter its
  measured side in centimetres, select at least five stable upright baseline
  frames and an airborne peak. The server uses retained pose evidence; the
  browser never supplies a final height or invented pose points.
- **Flight time:** select adjacent frames bracketing takeoff and first landing
  contact, and confirm that feet, ground contact and comparable posture are
  visible. The server uses original frame timestamps, never nominal FPS.
- Preview the saved height, recovered estimate and selection-sensitivity range.
  Write a review note, then confirm **Save estimate**. The client reloads the
  current revision and checks its ID and height before reporting success.

Both methods remain estimates and stay outside verified team rankings. The
numeric estimate is stored only under `jumpRecovery.heightMetres`; root and
metadata `jumpHeight` stay null so older installed clients cannot display it as
an unlabeled measurement. Admin shows the saved nested value with ESTIMATE,
and save readback verifies the empty root height and matching labeled estimate.
The review does not recover force, power or technique scores. Missing recording,
unusable pose, unclear ground contact or unresolved timing needs evidence
recovery or a retest; the interface does not fabricate a number.

## Contract and evidence guards

`adminGetJumpReview` returns a generation-pinned video URL, upright dimensions,
normalized presentation timestamps, original timestamp origin, available
methods, source fingerprint and expected revision. `adminPreviewJumpRecovery`
and `adminReviseRep` receive the same reviewed inputs under `jumpRecovery`.
Types and validation live in `app/src/pages/admin/lib/jumpRecovery.ts`; callable
adapters live beside them in `jumpRecoveryData.ts`.

Requests bind player, repetition, source path/generation/fingerprint, expected
revision and operation ID. The backend recalculates the value and owns the
estimate label and invalid/partial quality flags. Original values remain in
restorable revision history. A failed or uncertain save requires reloading the
current record; the browser does not retry a potentially completed write.

The displayed video must match source dimensions and duration. Nonzero source
origins are blocked until their browser mapping is verified. Frame selection
also requires `requestVideoFrameCallback` evidence: a requested seek is not
treated as a displayed frame. A paused seek must present the selected source
timestamp within rounding tolerance before corner selection, “Use current” or
calculation can proceed. Unsupported browsers and unresolved seek mismatches
block review. Marker points use the actual displayed video aspect ratio.

Any changed measurement input invalidates the preview. Preview responses must
match the method, source fingerprint and ESTIMATE label. This path cannot clear
failed processing steps or promote recovered values to verified measurements.

## Local synthetic preview

Start `npm --prefix app run dev -- --host 127.0.0.1 --port 5177 --strictPort`, then
open `/admin/jump-review-preview?preview=1`. This route exists only in development
and is absent from admin navigation. Its injected service keeps changes in
memory; it does not read or write athlete records.

The fixture is a 480×640 invented figure and marker, 60 frames in a 24 KB H.264
MP4. Its JSON timing manifest contains actual decoded presentation timestamps
and a SHA-256 of the media. There are no real names, recordings or measurements.
The DEV-only lazy import excludes the route, fixture and fake service from the
production bundle. All real playback and frame-verification guards apply to
this fixture as well.

For a manual interaction check, select the visible black square, enter a
synthetic 15 cm size, choose baseline frames 3–10 and peak 27, confirm both
review checkboxes, calculate, note and save. For flight time, use frames 14/15
and 39/40, confirm visibility/posture/player, calculate, note and save. Demo
calculations intentionally return fixed 24 cm or 31 cm; they exercise the
workflow and readback, not the server's mathematical implementation.

## Validation boundary

Local verification on October 30 passed 2,220 frontend tests, TypeScript and the
production Astro build. Scoped lint is clean; the full repository lint retains
its existing warnings. After the paused-frame initialization fix, the 17
focused recovery tests and TypeScript were repeated. Nested-only estimate
readback adds three regression tests, bringing the focused count to 20. Browser acceptance
verified initialization at frame 1, stepping to frame 0, viewing frame 14,
same-frame marker selection, and both complete estimate/save/readback flows.
The production output was scanned to confirm that the synthetic route, service,
media and manifest are absent.

Focused frontend tests cover source identity, variable timing, decoded-frame
matching, geometry, marker order, flight brackets, preview binding and missing
evidence UI. TypeScript, lint, frontend tests and a production Astro build are
required before source integration. Manual browser checks cover both synthetic
save/readback flows and frame stepping. Backend mathematics and source probing
are tested in the private backend repository.

A local synthetic preview does not prove production callable availability,
real-account authorization, all browser codecs, native failed-recording upload,
or physical measurement accuracy. Those acceptance and release steps remain
separate from this source candidate.

## Release dependency qualification

The October 30 dependency audit found a newly published high-severity advisory
in the transitive `re2js` 2.8.6 package. The lockfile updates only that package to
2.8.7, the fixed version for
[GHSA-gg6h-894w-4m9c](https://github.com/advisories/GHSA-gg6h-894w-4m9c).
It stays within Firestore's existing `^2.8.3` range; no manifest dependency,
override or audit exception is added. Its Node 20 minimum is covered by the
repository's Node 22 runtime. The production audit now has zero blocking
findings; the two previously reviewed exact `grpc-js` paths remain under their
existing exception. Static browser transport validation still excludes gRPC
from the application bundle.

The release runtime is composed from the last approved application runtime
`bb3274c`, with only jump review and this dependency patch. The newer automatic
deployment `6ae3b61b65d402dd68565eb9` is the preservation source for current
marketing and all retained assets; its application still matches the approved
runtime. Held policy, session and Ball Striking candidates remain excluded.
