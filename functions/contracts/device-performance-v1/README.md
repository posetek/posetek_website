# device-performance-v1 — canonical contract

Machine-readable copy of the device-performance schema V1: the records the app sends to the website's
`ingestDevicePerformanceV1` and the admin **Device performance** tab reports. The meaning of every field,
metric and limit is defined in
[docs/plans/PROCESSING_PERF_CONTRACTS_V1.md §8](../../../docs/plans/PROCESSING_PERF_CONTRACTS_V1.md#8-device-performance-schema-v1-plan-07-4).
This directory defines its shape.

**Status:** frozen v1 — 2026-09-29. Review fixes F1–F16 are applied; a delta re-review is pending. Nothing
implements the schema yet.

## Files

| File | Contents |
|---|---|
| `schema.json` | JSON Schema draft 2020-12. The root validates one record. `$defs/batchV1` validates an ingestion request; `$defs/ingestResponseV1` validates its per-item response. |
| `fixtures/index.json` | Each fixture's file, target (`#` or a `$defs` pointer), expected result, the check that must reject an invalid fixture (`schema` or `semantic`), and the rule it breaks. |
| `fixtures/*.valid.json` | Records of every fact kind, with these variants: attempt summaries (normal, and one whose invocation failed before admission), run summaries (field and evaluation origin), upload groups (result files, and a video archive that is `unavailable`), a transfer invocation, a device status, and a two-record batch. |
| `fixtures/*.invalid.json` | An oversized record (> 16 KiB); nine pass ids; a negative duration (the telemetry `-1` sentinel); evaluation origin without a run id; field origin with a run id; a nested operation without a parent; an `invalid` verdict without a reason; a missing reason that points at a present value; a 17-record batch. |

Fixture identifiers, hashes and measurements are illustrative placeholders, not real devices, athletes or
builds.

## Rules a validator must add to JSON Schema

- **Size.** `x-maxEncodedBytes` is a custom annotation. The UTF-8 length of the instance's RFC 8785 canonical
  JSON must not exceed it: 16 384 bytes per record, 131 072 per batch.
- **Attributable missing values** (semantic). Every `missingReasons[].field` is a JSON Pointer into `body`, where
  `""` means the whole record. The value it points at must exist and be `null`.
- **Identity** (semantic). `recordId` must equal the entity id for its kind (contract §8.6):

  | `recordKind` | `recordId` equals |
  |---|---|
  | `attemptSummary` | `attemptId` |
  | `runSummary` | `processingRunId` |
  | `uploadGroupSummary` | `body.groupId` |
  | `transferInvocation` | `body.invocationId` |
  | `deviceStatus` | `executorInstallId` |

  Ingestion rejects a mismatch with `identityMismatch`.
- **Server fields.** A client record never contains `firstReceivedAtServer`, `updatedAtServer` or a digest.
  `additionalProperties: false` rejects them.
- **Evaluation origin.** Production ingestion rejects `origin: "evaluation"` with `evaluationOriginRejected`,
  even though the schema accepts the shape (contract §8.8).

## Canonical and pinned copies

- This directory is the **canonical** copy. Change it only together with a change-log row in the contract
  document.
- The website keeps a **pinned, byte-identical** copy at `posetek_website/functions/contracts/device-performance-v1/`
  (`schema.json` and `fixtures/`). Its SHA-256 digests must equal the table below.
- **A test on each side checks it.**
  - Mobile (owner T1.1c): decode every `*.valid.json` with the Swift `Codable` types, reject every `*.invalid.json`,
    and compare `schema.json`'s SHA-256 with this table.
  - Website (owner T1.3): compare the pinned files with this table and, when a sibling mobile checkout is present,
    with the canonical files (the sibling convention the rules tests use for `RULES_PATH`). Run the ingestion
    validator, including the semantic rules above, on every fixture.
- A schema change updates the canonical files, this table, the pinned copy and both tests in one release.

## Pinned digests (SHA-256)

| File | SHA-256 |
|---|---|
| `schema.json` | `906c843cc446a29bcc8e8f2947e9ed11246f03929b1b93731e3273042fba1f49` |
| `fixtures/attempt-summary.valid.json` | `e2d80f5d9743cad38a5563547770b81cdc44c92aeb19096ae3ad629985ddba55` |
| `fixtures/attempt-summary-pre-admission-failure.valid.json` | `0f39e5bdadf30b9d7f52e799ce908f24c66ec4732c92f69172cdc1490ff4bfb2` |
| `fixtures/run-summary.valid.json` | `626aa20b983ef95b25e02aadff744516e2477f79034681d8c1a1c19a1bf8d009` |
| `fixtures/run-summary-evaluation-origin.valid.json` | `114c3b6d4f03a8a2aa443f62213aaabdf3d880f56ef7beae9d60d863975b8e09` |
| `fixtures/upload-group-summary.valid.json` | `4beaa4ce628f245769adb4fc9fde2b7aeacf8ae3fac68d96222e4a866a6d36ac` |
| `fixtures/upload-group-summary-video-unavailable.valid.json` | `5c03d4128f0cd089ffae0a6aaa4e72c1554d194fec621071aa00e26cf31b75ff` |
| `fixtures/transfer-invocation.valid.json` | `64092da635118247ca9ba8f618132c5489cbf84ddbe04ff944898f1ae19b4027` |
| `fixtures/device-status.valid.json` | `07d2deed950bcd2382a04dfbcb205fea57062aa3b634b105aad5085fd67316b1` |
| `fixtures/batch.valid.json` | `913468ad1173634ad0d50db2265573ace8f6aada789328b3ca4ee072485b575f` |
| `fixtures/run-summary-oversized.invalid.json` | `9d8fe20f5a8d89256479b0dd8beda2fd36bdba819fe15f57e0d2b84f9898fdea` |
| `fixtures/run-summary-too-many-pass-ids.invalid.json` | `4487ed8035b8964e3a4a5b928f8914e71d9406813f583bb646637b2d4780c0fb` |
| `fixtures/run-summary-negative-duration.invalid.json` | `63f67a4e8da2257fee64b3424e3f3e3fd97e08d8f57ccb21f048371251ad18de` |
| `fixtures/evaluation-origin-without-run-id.invalid.json` | `f07f57ab5fb674fd7a0c1735f6331bf8b3ff3453edb8c6a64b2391fb2e977d57` |
| `fixtures/field-origin-with-evaluation-run-id.invalid.json` | `e694ced9a871d8867976fc751e6e2e56a2057f660ddcc3cf442fdac2044dc1c1` |
| `fixtures/stage-nested-without-parent.invalid.json` | `22b63bdc6676f21b21493bdf7ca091e4dfae90f98aea57384aac5bbed5f877ef` |
| `fixtures/attempt-summary-invalid-verdict-without-reason.invalid.json` | `286d7be1079b3246440b7f2c491fc423b84fa8085e7b9d852f7e05f21cc71d29` |
| `fixtures/missing-reason-points-at-value.invalid.json` | `c611c2a0a0c24c2a56e8de718cb98f9989bf694d4a00a11d321a9333049dcaf1` |
| `fixtures/batch-too-many-records.invalid.json` | `c05547ee6a85dfc95267f7f716b89ebfd2649b0a52e5216ef08f3b72eb985257` |

`fixtures/index.json` is a manifest, not a contract file, and is not pinned.

## Test vectors

The baseline `ProcessingPolicyVersion` hash used in the run-summary fixtures is
`63256738ad026d65118ce3b15a01e69ac3ae728876df23cf815191999df23d56`, the SHA-256 of
`posetek.processingPolicy.v1|ballSampling=dense|captureProfileFinalizeCheck=off|kickExactStop=off|kickNormalMotion=computed|kickPassFusion=off|reviewConstruction=eager|sessionCalibrationInput=legacy`
(contract §2.3). The six-component hash from before the review is superseded and must not be used.
