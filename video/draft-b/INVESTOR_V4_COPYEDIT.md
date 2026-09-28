# PoseTek investor V4 — copy edit and closing line

Separate edition: `PoseTekInvestorV4CopyEdit`, 116 seconds / 3,480 frames, 1920 × 1080 at 30 fps. Previous V4 and weak-foot exports are preserved.

The user requested grammar and phrase placement corrections without changing the core text or meaning, plus “PoseTek. Learn more at posetek.net.” at the ending. The nine original arguments remain in order, with the same investor framing. No visuals, recorded movements, measurements, scene transitions or native app wording have been reworked. Only the identity card is extended from 1.3 to 4.3 seconds for the new line.

Narration uses the same `af_heart` voice at the existing natural rate of 1.2. The two unchanged spoken passages reuse their original synthesis. Changed sentences are synthesized as complete utterances. Captions hold complete clauses with deliberate phrase boundaries and at most two lines. No words are cut to fit. The original 25-second demonstration retains its complete V4 mixed PCM, including its music and countdown.

## Copy changes

### Passage 01

Before: At posetek, we combine innovations in smartphone computing power, computer vision, and AI to bring elite level performance testing to every competitive soccer player looking to bring their game to the next level.

After: At PoseTek, we combine innovations in smartphone computing power, computer vision, and AI to bring elite-level performance testing to every competitive soccer player looking to bring their game to the next level.

### Passage 02

Before: Using just the smartphone, our custom made cones, and our proprietary technology, we are able to capture athletes' movements across a broad sets of movements

After: Using just the smartphone, our custom-made cones, and our proprietary technology, we are able to capture athletes' movements across a broad set of movements.

### Passage 03

Before: Our technology captures the movements of the athletes with computer vision directly on the smartphone, processing them in real-time

After: Our technology captures athletes' movements with computer vision directly on the smartphone, processing them in real time.

### Passage 04

Before: And grades their performance both against the professional/d1 standard, along with where their position and where they sit on the developmental pathway

After: It grades their performance against the professional/D1 standard, while considering their position and where they sit on the developmental pathway.

### Passage 05

Before: A deep understanding of how the player is developing allows us to produce personalized, customizable workout plans that target the things that specific player needs to focus on.

After: A deep understanding of how the player is developing allows us to produce personalized, customizable workout plans that target the things that specific player needs to focus on.

### Passage 06

Before: Athletes can follow these workouts on the app, in the same way an athlete might work with a private trainer

After: Athletes can follow these workouts in the app, in the same way they might work with a private trainer.

### Passage 07

Before: Our AI technology also compares your technique against the pros and finds your weaknesses and provides the tips and queues that closes the loop on performance improvement

After: Our AI technology also compares your technique against the pros, finds your weaknesses, and provides the tips and cues that close the loop on performance improvement.

### Passage 08

Before: And periodic retesting and re-evaluation allows the athlete to grow with the platform.

After: Periodic retesting and re-evaluation allow the athlete to grow with the platform.

### Passage 09

Before: One system that democratizes the technology and coaching assistance that only the pros used to get.

After: One system democratizes the technology and coaching assistance that only the pros used to get.

### Added closing line

PoseTek. Learn more at posetek.net.

Spoken at 1:52.35, after the connected development cycle, while the identity card remains visible. The music ends with a gentle fade at 1:56.

## Files and reproduction

- Composition: `src/InvestorV4CopyEdit.tsx`
- Timing: `src/investor-v4-copyedit-timing.json`
- Exact revised copy: `audio-source/investor-v4-copyedit.json`
- Audio/caption builder: `audio-source/v4_copyedit_audio.py`
- Render: `node scripts/render-v4-copyedit.mjs master`
- 720p proof: `node scripts/render-v4-copyedit.mjs proof`
- Local media: `output/investor-v4-copyedit/`

The original recorded media is reused through the established sanitized allowlist. No website, mobile app, backend, account or public API changes are made. Generated audio, video and working files stay out of Git.

## Verification

TypeScript compiles. All nine original argument sections plus the added closing line fit without changing earlier visual scene boundaries. Caption text matches the revised copy exactly (198 whitespace-delimited words, including the five-word closing). The audio verification preserves the original V4 demonstration bit for bit and checks complete sample count, continuous score, loudness and peaks. Independent speech recognition matches the nine narrative passages; the short brand-only closing has a recognizer spelling ambiguity (“Post Tech”), recorded transparently alongside the TTS phonemes `/poʊz tɛk/` and the spoken “dot net.”

Final encoded-media checks and the visual review are recorded beside the output. Earlier V4 export hashes are retained in `audio-validation.json`.
