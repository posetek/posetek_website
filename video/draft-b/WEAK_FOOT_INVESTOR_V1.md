# PoseTek weak-foot investor film — V1

Separate 60-second portrait film: 1080 × 1920, 30 fps, 1,800 frames. Earlier
investor editions remain unchanged. The audience is investors; two recorded
athletes demonstrate the same assessment-to-practice workflow.

## Recorded evidence and presentation

Each example plays its right-foot kick before its left-foot kick. The comparison
then pauses each recording at its own saved backswing. These are corresponding
phases, not simultaneous events or a before/after training result.

| Display record | Backswing | Contact | Follow-through | Support knee at backswing |
|---|---:|---:|---:|---:|
| Player 1 · right | 417 | 443 | 493 | 143.2° |
| Player 1 · left | 458 | 472 | 522 | 111.1° |
| Player 2 · right | 532 | 542 | 592 | 139.8° |
| Player 2 · left | 452 | 464 | 514 | 123.1° |

Both pairs use complete saved poses and original 1280 × 720 recordings. Pose
timing is source-declared 240 fps; movie proxies preserve original timestamps.
All anatomical labels retain physical left/right identity. Direction matching
must be an explicit display transform and cannot relabel the athlete's feet.

The support-knee metric is the interior hip–knee–ankle angle in aspect-corrected
pixel coordinates: 180° means straight. The selected chains have high recorded
visibility, and the displayed values can be reproduced directly from the exact
phase frames. The renderer omits non-finite or visibility-below-0.10 joints and
their connected segments. No missing joint is invented. Some far-arm points are
occluded at backswing; complete framing does not imply complete tracking.

The second athlete's right-foot dominance was confirmed by the user. The first
athlete's profile records a right-foot preference. Both pairs retain physical
right/left labels in the film.
Public assets and visible interfaces use anonymous player labels. Account IDs,
original names, bucket paths, access tokens and private lineage remain outside
render payloads and editable public source.

## Story and motion

| Time | Purpose |
|---|---|
| 0–4 s | Introduce weak-foot learning through recorded movement |
| 4–13 s | First example: right-foot kick, then left-foot kick |
| 13–22 s | First pair: corresponding-phase comparison and measured knee angle |
| 22–31 s | Second example: right-foot kick, then left-foot kick |
| 31–39 s | Second pair: same comparison workflow, individual recorded values |
| 39–49 s | Carry recorded evidence into a specific practice focus |
| 49–57 s | Reassessment remains pending; resolve the connected learning loop |
| 57–60 s | PoseTek identity and outro |

Keep PoseTek's forest/lime palette, restrained card motion and anchored
captions. Carry one assessment card continuously through the workflow; fade
interior labels in sequence so they never overlap. Fit complete bodies and
preserve the source aspect ratio. Normal-speed footage and labeled slow-motion
poses serve different purposes. Feedback holds use fixed recorded frames.
The replay uses one fixed fit for its complete active interval. Selecting
backswing dissolves into a larger fit bounded by the two exact phase poses;
this fit remains constant across the support-knee and kicking-thigh highlights.
The first comparison's narration starts at 15.70 seconds, when both backswing
poses are fully paused. Its metric changes at local frame 174 (18.80 seconds),
matching the following kicking-leg observation without changing either pose.

The investor proposition is a repeatable pathway from recorded assessment to
personalized practice and reassessment. One pair per player demonstrates that
workflow. It does not prove a lasting asymmetry, a training improvement, ball
speed, power or accuracy. A support-knee difference is an observation, not a
diagnosis of instability or a universal prescription to straighten the leg.
Practice and retest screens are clearly illustrative/pending where no completed
new assessment exists.

## Reproduction and verification

Restore the authorized sanitized asset/audio package, install the locked npm
dependencies, and use the new timing manifest at
`src/weak-foot-v1-timing.json`. The narration specification is
`audio-source/weak-foot-v1.json`; captions are checked against it word for word.

    npm run typecheck
    node scripts/verify-weak-foot-v1.mjs

After rendering, pass each encoded file for frame-count, geometry and complete
decode checks:

    node scripts/verify-weak-foot-v1.mjs --media=output/weak-foot-v1/FILE.mp4

The verifier independently recomputes knee and thigh angles at exact frames,
checks confidence, phase bounds, complete pose intervals, anonymous public data,
silent original-speed movie proxies, scene coverage and exact captions. It
writes `output/weak-foot-v1/source-validation.json`.

Review motion and stills at both portrait 720p and 1080p, including every scene
boundary, frozen joint highlight, caption and body extent. Confirm continuous
music remains below the new voice, original recording audio is muted, and the
encoded mix is approximately −16 LUFS with true peak no higher than −1 dBTP.
Rendering verification is recorded in generated output receipts; this document
does not itself certify an export.

All work is confined to video sources and sanitized video assets. No website,
mobile, backend, public API or athlete record changes are part of this film.

## Timed proof and creative review

The deliverable is `output/weak-foot-v1/PoseTek-Weak-Foot-Investor-V1-Timed-Proof.mp4`
with its same-named SRT. It is 720 × 1280, exactly 60 seconds / 1,800 frames,
H.264/AAC. The composition itself is 1080 × 1920; fifteen short boundary renders
at full resolution supplement the portrait proof review. Final master, compact
delivery edition and editable asset package follow creative approval.

The encoded proof passes 96 source/media checks and complete decode. Encoded
audio is −16.01 LUFS / −1.58 dBTP with zero measured timing lag. All 92 approved
narration words remain unchanged. Original field audio is muted. Objective
speech recognition and waveform checks do not imply a subjective listening review.

The first comparison's narration starts at 15.70 seconds, after its visible
backswing selection. The second metric appears at 18.80 seconds, matching the
kicking-leg sentence. Paused phase framing enlarges both recorded poses together;
it uses a fixed aspect-corrected similarity transform and never changes joints.

Run `node scripts/render-weak-foot-v1.mjs proof` to reproduce the timed proof,
`node scripts/render-weak-foot-v1.mjs boundaries` for full-resolution boundary
clips, and `python scripts/review-weak-foot-v1.py` for encoded-picture checks and
contact sheets (NumPy and Pillow required). That review verifies stationary pose
regions during four feedback holds and validates all fifteen boundary clips.
The audio validator is `audio-source/weak_foot_v1_encoded_check.py`.

All prior editions remain available. This proof has not been emailed or treated
as creatively approved.

## Source verification checkpoint

All 94 independent source checks pass. Seven narration passages contain 92
whitespace-delimited words, with exact text and punctuation retained across 25
caption cues and the SRT. Every public pose coordinate matches its checksummed
original bucket record. Side agreement, phase indices, native confidence
filtering, full-body comparison framing, quarter-speed timing and recomputed
angles pass for all four recordings.

The prepared 60-second stereo master contains 2,880,000 samples at 48 kHz and
measures −16.00 LUFS / −1.58 dBTP. This checkpoint covers source evidence and PCM;
encoded export and visual review are separate final checks.
