# Guided personal workouts and generation reliability

Implementation contract agreed October 1, 2026. The production receipt records
the actual deployed identities and completed acceptance; this document does not
replace that receipt.

## Player experience

Training → Personal workouts → Create workout uses a short guided setup with
recoverable Back/Next answers. Players choose one or two focuses, then Home,
Gym or Field, missing profile age, available time and readiness. Age precedes
duration assessment only when confirmation is needed. Known AI Coach
conditions prefill the setup; an existing proposal opens its conversation without
another generation. No active plan is required.

Focus labels map to existing domains: Speed (`speed`), Strength (`strength`),
Agility (`agility`), Ball control (`dribbling`), Passing (`passing`), First touch
(`receiving`) and Finishing (`shooting`). Prescriptions may contain supporting
domains, but each explicitly selected focus must receive eligible work.

Home assumes floor/bodyweight and the current device's timer. Gym assumes
dumbbells, resistance bands, kettlebell, bench and timer. Field assumes cones,
flat markers and timer. Ball and Goal are separate choices, off unless already
known. A goal does not confirm a marked penalty area. Compact setup exceptions
can remove resources, add specialized equipment, change participants or date.
Location defaults are visible assumptions the player can correct.

The user explicitly chose to assume suitable space without a measurement
question. `access.space.assumedSufficient: true` represents that product
assumption; it does not record invented dimensions. An explicit smaller dimension
or overhead restriction takes precedence. It grants no equipment, surface,
marked goal area, partner or coaching clearance. Actual setup requirements remain
in the prescribed drill instructions.

Time defaults to 20 minutes. The ordinary slider offers feasible five-minute
targets in 5–60 minutes; supplied/custom targets retain the existing 1–135-minute
contract. The server calculates dose, rests and transitions under the existing
approximate-time tolerance. Review displays both requested and calculated time.
Unavailable combinations require a visible adjustment rather than a hidden
focus or equipment substitution. The current reviewed catalog does not cover
every age or setup; assessment cannot approve held content to fill those gaps.

Age resolution uses a valid recorded birth date first, otherwise a nonfuture
integer age observation recorded no more than 365 days ago. Missing, undated or
stale observations require explicit confirmation. Saving an age writes `age`,
server `ageRecordedAt` and `updatedAt`; it never invents a birth date or increments
an observed age on its anniversary. Profile displays the observation. Owner rules
permit refreshing its timestamp even when the integer age is unchanged.
Admin Profile uses the same age policy and provides an explicit Confirm current
age action. Saving another profile field does not refresh an old age observation.

Conversation → reviewed prescription → explicit Publish → saved detail → Start
remains the workflow. There are no player drill-search, reorder or dosage editing
controls. Start/Resume rechecks a compact current setup while preserving frozen
workout snapshots, completed sets and timers. Six-tab navigation and private
conversation recovery remain unchanged.
AI Coach history disables message submission until the selected conversation has
loaded from the server. A synchronous guard also blocks a rapid submit before the
loading state renders; canceling or switching conversations cannot bind an old
read to the next message.

## Additive gateway and rules contract

`assess_personal_workout` is a code-only self-owned capability through the existing
`llmJobs` transport. Parameters are `requestId`, `scheduledDate`, `timezone`,
`intake` and optional `timeAvailableMinutes`. Intake contains existing age,
equipment, solo/partner, pain and access fields plus required `focusDomains`
(one or two distinct canonical domains).

Its safe result contains `schemaVersion`, resolved age/source, current
`scheduleRevision`, `catalogVersion`, selected focuses, per-focus availability,
`supportedMinutes`, `recommendedMinutes` and actionable limitations. Feasible
durations use the same single-session composition constraints as generation.
Assessment is repeated when relevant conditions change, not on slider movement.
It does not call a provider, consume AI allowance, write usage, or create a
conversation, proposal, workout or profile. Only its job receipt/result persists.
Current self ownership and global/personal/capability gates still apply.

Generation accepts optional `intake.focusDomains`; older callers retain their
existing text-based path. Optional `access.space.assumedSufficient` accepts only
literal true. Canonical gateway/rules validators agree on both additive fields.
Generation independently checks current eligibility; assessment is not a trusted
authorization token.

Guided generation composes a single session from shared published-catalog,
age/difficulty/access, legal-dose, duration and frequency logic. It does not create
an artificial weekly plan. Conversational refinements retain earlier constraints
and unaffected blocks unless changed. Failed refinements preserve the last valid
proposal. Existing metering, stable operation identities, immutable revisions,
exact-proposal Publish, schedule checks and atomic publication binding remain.

Admin personalized plans retain their weekly optimizer and private testing
evidence. Private context persistence validates Firestore shape as well as size;
unsupported nested structures use the existing immutable JSON artifact storage.
Evidence is retained intact with its hashes and private reader/activation checks.

## Catalog and release boundaries

Floor substitutes for the required mat in STR-005, STR-006, STR-008, STR-501 and
STR-502. Equipment, authored setup, access maps and source hashes change together
through a narrow guarded publication. Bench/partner requirements remain where
authored. Doses, media, existing prescriptions and logs remain unchanged.
The 80 unpublished whole-body drills and false mobile acceptance gate remain held.

The implementation base preserves already-live user-issue-alert source `e8de8d7`
and reconciles deployment `6abd8f957e046e8059376091` before the next release.
Gateway publishes only from pushed canonical backend main through `release.sh`;
rules publish only from the native repository through `firebase/operations.py
publish`. `scripts/personal-assessment-policy.cjs` activates only the assessment
capability entry with an exact plan digest and config update-time precondition;
existing allowances, native policy and feature/content gates are preserved.

Website publication uses the explicit PoseTek site, guarded Astro composition,
candidate verification and promotion of that exact candidate. Release receipts
record source commits, baseline, gateway/rules/catalog identities, tests, live
acceptance, cleanup and recovery. Rollback restores audited service/source
releases; it never rewinds athlete data or deletes legitimate drafts.
