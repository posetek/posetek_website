# Training access catalog requirements

## Optional comfort mats (October 1 implementation)

`content/training-access/floor-substitutions.json` is a separate, narrowly
reviewable follow-up to the historical September 26 requirements manifest. It
makes a mat optional for STR-005, STR-006, STR-008, STR-501 and STR-502, and adds
clear, non-slipping floor guidance to their existing setup text. STR-008 still
requires a bench and two people; STR-501 retains its 1.524 m crawl bound. The
authored equipment, setup text and source-bound requirements change together.
No dose, media, publication state or review clearance is changed.

Run the following from the website repository root:

```powershell
node scripts/training-floor-catalog.cjs --lint
node --test scripts/training-floor-catalog.test.cjs scripts/training-access-catalog.test.cjs
node scripts/training-floor-catalog.cjs
node scripts/training-floor-catalog.cjs --apply --expected-plan-sha <reviewed-plan-sha256>
node scripts/training-floor-catalog.cjs --verify
```

The default command is read-only and saves an exact plan in ignored
`.netlify/training-floor/catalog-plan.json`. Publication requires that reviewed
digest. A transaction rereads all 208 catalog records, all authoring records,
catalog metadata and AI configuration, rejecting any drift. The five target
documents must have no authoring record or content-review state, and may not
belong to restricted whole-body training. Every write has an updateTime
precondition. Nested `howTo.setup` masks preserve existing steps and unrelated
Firestore value types. Independent readback proves the other 203 records, all
doses/media/reviews/configuration and 80 held drafts remain unchanged, including
the false mobile acceptance gate. Lost replies use the original plan's
`--verify`; do not replan or automatically restore concurrent changes.

The guided player setup can explicitly declare `space.assumedSufficient: true`.
That assumption satisfies omitted horizontal/overhead clearance only. Supplied
dimensions and `overheadClear: false` take precedence. Equipment, participants,
surface requirements, unresolved authored requirements and marked goal-area
access remain separate. Legacy requests without the assumption retain the
previous strict clearance behavior.

Published September 26, 2026 as catalog version `1.0.92`. The guarded transaction
committed at `08:26:04.508195Z`; independent readback verified preservation at
`08:27:57.605Z`. All 54 requirement maps and the two equipment corrections are
installed. This metadata publication does not approve content or mobile use.
The website production receipt records the coordinated release and acceptance.

## Scope and source of truth

[`content/training-access/requirements.json`](../content/training-access/requirements.json)
accounts for all 208 observed catalog records. The canonical backend normalizer
accepts 54 as published, 55 as unpublished, and 80 as held whole-body drafts; 19
legacy/media records are unsupported by that execution contract. The 54 published
records receive access metadata. The other 154 records are inventory-only and
must remain unchanged. The exact quoted source and decisions for each proposed
map are in the manifest; a readable overview is in
[`content/training-access/README.md`](../content/training-access/README.md).

The source is existing authored catalog instructions and equipment/participant
metadata, not a new exercise recommendation. The inventory snapshot contains no
athlete reads. The tracked manifest excludes media/download links, uploader and
reviewer identities, credentials, and private authoring records. The live plan
retains exact Firestore snapshots only in ignored `.netlify/training-access/` so
the operator can prove preservation and reject concurrent changes.

## Requirement semantics

`accessRequirements` version 1 contains:

- `sourceHash`: fingerprint of the current authored source, defined below.
- `equipment.allOf`: every named item is required. An empty list means no item
  required by this map; it never means the athlete has every item.
- `equipment.anyOf`: each group requires at least one member. None of the 54
  authored setups explicitly establishes a supported equipment substitution, so
  all current groups are empty. Do not infer that bench substitutes for box or
  resistanceBand grants the separate sledOrBand token.
- Every version-one access-aware selection requires a valid source-bound map.
  A missing, malformed, stale or unresolved map makes that drill unavailable to
  this flow. Legacy clients without `intake.access` retain their existing flat
  equipment checks. Install and verify all 54 maps before launching the website
  access flow; the three unresolved maps still remain held as described below.
- `space`: optional `minLengthMeters`, `minWidthMeters`, `surfaces`,
  `overheadClear: true`, and `requiresGoalArea: true`. Missing athlete dimensions
  fail only an explicit numeric constraint. Selecting pitch does not automatically
  confirm a usable goal area. Selecting gym grants no equipment.
- `participantMin`: people including the athlete, preserving the stricter of
  authored `playersMin` and the existing normalized partner requirement.
- `unknowns`: bounded unresolved-critical codes. A nonempty list holds the drill
  from the new access-aware personal selection without changing publication.

Dimensions are explicitly authored lower bounds, with exact conversions of feet
and yards. A range such as 5–15 m yields its authored 5 m minimum; it does not
authorize silently changing a prescribed dose. Route, gate and landing bounds
are not a certification of total safe clearance. Complete setup instructions still
apply, including unquantified exit/landing space and a suitable non-slipping
surface. No current authored text specifies a surface material, so the maps do
not fabricate grass/turf/indoor restrictions. General bodyweight drills are not
held merely because their prose omits an unnecessary numeric footprint.

Three source gaps require author clarification before access-aware selection:

| Drill | Code | Unresolved authored requirement |
|---|---|---|
| HJP-003 | `triple_jump_lane_length_unspecified` | Three consecutive broad jumps need a long clear lane; no usable lane bound is authored. |
| SPD-006 | `run_off_distance_unspecified` | The minimum build plus fly segments total 25 m, but the required long run-off has no distance. |
| STR-004 | `stable_support_type_unspecified` | Stable support is required, but its type is not mapped to an equipment ID or approved alternative. |

Clarifying these gaps is a future authored-content decision. This patch does not
invent distances, clearances, material substitutions, or review approvals.

## Two narrow equipment corrections

`BMA-501` explicitly names a ball and two cones but stores an empty equipment
array. Its corrected array is `['ball', 'cones']`. `SHT-502` explicitly names cone,
goal and ball but stored an empty array; its corrected array is
`['ball', 'cones', 'goal']`. These are the only edits to existing prescription
content. No dose, instruction, age, difficulty, partner flag, status, media,
review, clearance, active plan or log is changed.

The publisher checks content-review state for these two corrections. If a
current authoring record or drill carries a content-review status, reviewer or
reviewed hash, it refuses the direct correction. Use the established authoring
and review-invalidation workflow instead; never carry an old content approval
across changed equipment. The current restricted whole-body workflow requires
archiving published content before editing and resets review state. This tool
does not bypass or impersonate that workflow. It refuses every trainingPolicy
or whole-body batch record as a patch target, and writes no authoring records.

Requirement metadata itself grants no review clearance. Any subsequent edit to
its source invalidates the map by hash mismatch for the new access-aware flow;
re-audit and republish the metadata explicitly. Existing media approvals remain
about their original media generations and are not reinterpreted as access review.

## Source fingerprint

Compute before normalization discards legacy fields. The payload contains
`drillId` from the document ID; `schemaVersion` from raw data, default 1; and each
of these raw fields with absent/null values represented as null:

```text
name, equipment, requiresPartner, playersMin, playersMax, setup, execution,
safetyNote, howTo, coachComments, regression, progression, cues
```

Recursively sort object keys, preserve array order, serialize compact JSON with
literal Unicode/UTF-8, and serialize integral numbers as integers. SHA-256 of
those UTF-8 bytes is `sourceHash`. For the two corrections, compute the installed
hash after applying the equipment correction. Media, private identities,
timestamps, catalog versions and the requirement map itself are excluded. Status
and other execution constraints retain their separate canonical validation.
Cross-language fixtures are in
[`source-hash-fixtures.json`](../content/training-access/source-hash-fixtures.json).

## Verification and guarded publication

Run from the website repository root:

```powershell
node scripts/training-access-catalog.cjs --lint
node --test scripts/training-access-catalog.test.cjs
node scripts/training-access-catalog.cjs
```

The third command is read-only. It uses the existing operator CLI login without
printing or persisting credentials. It reads only drill catalog, catalog
authoring, catalog metadata and AI configuration. It saves the reviewable exact
plan to `.netlify/training-access/catalog-plan.json` and prints its SHA-256.
The plan proposes one catalog-version bump, 54 requirement maps, and the two
explicit equipment corrections. It preserves legacy missing raw status fields.

Before publication, review the actual manifest and plan, verify the backend and
canonical rules contract, and confirm the unchanged 80-draft/mobile hold. The
backend and rules use their canonical repositories and publishing commands;
this tool does not deploy either. Apply only the reviewed plan, supplying the
digest printed by that exact preflight:

```powershell
node scripts/training-access-catalog.cjs --apply --expected-plan-sha <reviewed-plan-sha256>
node scripts/training-access-catalog.cjs --verify
```

Apply re-derives and validates every patch from the reviewed manifest, opens a
transaction, rereads the full relevant snapshot, and rejects any catalog,
authoring, configuration or version drift. Each catalog/meta update also has an
exact updateTime precondition. Narrow update masks preserve Firestore value
types and every unrelated field. The only paths written are the 54 allowlisted
catalog records and `drillCatalogMeta/current`; no athlete or authoring writes
are supported. Verification compares all 208 records, all catalog authoring,
configuration, exact media and review state, and confirms the mobile gate false.

If a network reply is lost after commit, retain the original plan and run
`--verify` before considering any retry. Do not generate a new plan or remove
installed maps to bypass a mismatch. If verification reports an unrelated
concurrent change, inspect it against the saved snapshot; do not automatically
restore teammates' work. Metadata publication does not rewrite old workouts or
logs. A current-access mismatch should use the reviewed workout-revision/copy
flow, preserving frozen started-session snapshots.
The ignored `.attempt.json` is written before sending the transaction commit;
`.committed.json` records an acknowledged commit before post-write verification.
An attempt alone does not prove a write succeeded. `.applied.json` is produced
only after the preservation verification passes.
Read-only `--verify` also saves a fresh `.verified.json`; when the matching
`.committed.json` exists, it reconciles `.applied.json` from that acknowledged
commit and the new verification. Typed comparisons normalize only Firestore
REST's equivalent empty array/map wrappers (`arrayValue: {}` versus
`arrayValue: {values: []}`, and the analogous empty map). Scalar types, all
nonempty contents, media, reviews and unrelated fields still compare exactly;
errors identify the record without dumping its private contents.

There is no automatic rollback: deleting requirement maps would block those
drills in the version-one access flow. Any rollback must be separately reviewed, versioned
and guarded against the then-current update times. Restoring an empty equipment
array would reintroduce the known missing-equipment issue.

The 80 unpublished whole-body drafts remain unpublished, all media and review
states remain unchanged, and `wholeBodyTraining.mobileVerified` remains false.
