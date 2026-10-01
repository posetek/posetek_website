# Native Power Automate Excel writer candidate

This source is not deployed. No Excel connection, paid plan, live workbook
bootstrap, flow activation, or production trigger is established by these tests.
The existing hourly publisher must be stopped only at an approved, verified
cutover; two writers must never target this workbook concurrently.

`office-script.ts` is a self-contained Office Script. Its entry point is
`main(workbook, payloadJson: string): string`. The Power Automate Run script action
passes `string(triggerBody())`; the HTTP response returns the parsed result only
after the script succeeds. All trigger runs and the backend workbook lease must
serialize writes to one workbook. Restrict the authenticated HTTP trigger to the
approved service identity. Never use an anonymous trigger URL as a credential.

## Payload and ownership

The exact version-1 envelope is:

```json
{
  "schemaVersion": 1,
  "batchId": "opaque-stable-batch-id",
  "workbookKey": "configured-workbook-key",
  "payloadSha256": "64-lowercase-hex",
  "expectedRevision": 0,
  "generatedAt": "2026-10-01T22:00:00.000Z",
  "changes": { "actions": [], "instances": [], "emails": [], "dailyRows": [] }
}
```

Each changed row is `{key, expectedMachineSha256, values, links}`. `values`
contains **all** machine-owned fields using exact current Excel header strings;
`links` contains every specified source-link header, with an HTTPS address or an
empty string. The arrays contain 0–150 changed rows in total. A zero-change batch
still validates the native workbook, postread and revision before acknowledgement.
A backend delivery
may expand into several row changes; split before freezing a batch if needed.
Dates are numeric Excel serial values representing Pacific wall-clock time; the
normalizer owns daylight-saving conversion. Null cells are represented by `""`.

| Group | Native table | Stable source key | Omitted fields | Hyperlink fields |
| --- | --- | --- | --- | --- |
| actions | ActionTracker | Action ID | Records, Emails, Status, Owner, Due (Pacific), Fix notes | Code / evidence, Provider reference |
| instances | IncidentInstances | Occurrence ID | Recommended next step | Private issue |
| emails | EmailEvidence | Outlook message ID | none | Outlook source, Issue / service incident |
| dailyRows | DailyDeliveries | Job reference | none | none |

`SPECS` in `office-script.ts` is the complete column-order contract. The writer
rejects missing/extra machine columns. It never updates existing human Status,
Owner, Due or Fix notes. Existing order and filters remain; new records append.
IDs are retained exactly. Source strings that resemble formulas are written as
literal text, then verified against their original semantic values.

`expectedMachineSha256` is null only for a new source key. For an existing row it
is SHA-256 of canonical JSON `{values,links}` from the previous verified cloud
read. Canonical JSON sorts object keys recursively, retains array order and uses
JSON scalar encoding; hashes use UTF-8. `payloadSha256` hashes the whole envelope
except its own field using the same rules. The writer recomputes both digests;
an incoming digest is never evidence that Excel saved the requested cells.

Every recurrence for an existing action must retain reviewed machine prose and
include a bounded `Recurrence recorded` marker in Observed evidence / limits.
For a newly appended instance whose live manual action Status is Resolved, the
writer requires that action evidence update before accepting the batch. It never
reopens or resolves the manual status. Backend issue status, delivery status,
silence and the manual task decision are different facts.

## Verified acknowledgement

The result is JSON `{schemaVersion,batchId,workbookKey,payloadSha256,verified:true,
revision,applied:{actions,instances,emails,dailyRows},counts:{actions,instances,
emails,dailyRows}}`. `applied` holds exact source keys. Revision increases by one.
Counts and row values/links are read back from the native tables, all preexisting
source keys are retained, and human fields are compared by Action ID. Calculated
columns and top counts use structured table formulas so appended rows are counted.

A pending marker precedes cell writes. A failed call gets no success receipt.
The exact frozen batch can resume rows already wholly written. A row left
partially written (neither its expected old digest nor its new digest) stops for
reviewed recovery; the script does not guess which cells to replace. It does not
clear another pending batch. Receipts are saved after successful postread and
before the final revision. A retry after interrupted revision finalization checks
the actual saved values again before completing the revision.

The last 1,000 receipts are retained in the workbook. Exact retained replay returns
the original receipt without applying data again. A reused batch ID with different
bytes is rejected. An older replay whose receipt was pruned fails stale revision;
the durable backend receipt journal remains authoritative. A prior receipt proves
its own batch was verified, not that later legitimate updates left those cells
unchanged. Acknowledgement validation must match all envelope fields and keys.

## Bootstrap and seed export

Build paste-ready scripts into an ignored directory:

```powershell
node scripts/issue-tracker/build-office-scripts.cjs .netlify/issue-tracker-office-scripts
```

The generated `PoseTek-bootstrap.ts` accepts `bootstrapJson` with `mode`,
`workbookKey`, `expectedSourceSha256`, `footerAddress`, `expectedFooter`, and
`dailyRows`. `mode:"inspect"` performs no writes. Supply the exact existing
Instances footer region as `A<number>:X<number>`. Inspection returns the native
source fingerprint, row counts, footer cell values, and full machine values,
hyperlinks and SHA-256 seeds for the three existing tables.

Do not guess the initial Action IDs or reassign historical instances. The output
explicitly reports `groupingMapVerified:false`: operation/error-to-Action mappings
must be reconciled with the existing reviewed action groups before enabling the
normalizer. Seed source IDs and machine fingerprints from this actual cloud
snapshot, not from an older local workbook or receipt counts. Private seed outputs
contain incident data and must stay outside Git.

`convert-bootstrap-seed.cjs` is an offline conversion candidate; it uploads
nothing. Its second input is an explicit reviewed mapping file with
`{schemaVersion:1,reviewed:true,workbookKey,mailbox,sourceSha256,actionMappings}`.
The review digest must match the native export. Each mapping signature must point
to an existing exported Action ID. Conversion validates exact machine hashes and
counts, derives counters from existing display IDs, and preserves email joins
only through an exact existing Linked instance value. It emits compact seed
metadata with counts plus per-source row documents at
`issueTrackerRows/{group-hash(key)}`. The emitted settings stay disabled and
unverified. No guessed aliases, profile identities or grouping assignments are
created. Example:

```powershell
node scripts/issue-tracker/convert-bootstrap-seed.cjs .netlify/native-export.json .netlify/reviewed-map.json .netlify/disabled-tracker-seed.json
```

After approved cutover preparation, `mode:"initialize"` requires the exact
reviewed source digest and footer values. It copies and verifies every existing
daily-delivery row into `DailyDeliveries` at `Instances!Z5:AD`, archives the exact
old footer contents at `Instances!AG5:BD`, then clears only the verified former
footer contents. The three existing user-facing sheets stay intact. It adds a
hidden `_TrackerSync` sheet with state in B1 and a bounded receipt table. Source
rows and human inputs are not regenerated. It installs structured formulas and
returns fresh seeds for all four native tables.

Initialization deliberately starts with `mode:"paused"`. Enabling requires an
approved operator to reconcile counts, source IDs, native formula behavior,
source links and preserved human fields, stop the old publisher, seed the durable
backend mapping, configure the serialized authenticated flow, and explicitly
change the state to ready. A partially initialized workbook stops for review;
the initializer does not run a second migration over it. Reconcile any pending
prior cloud publication before selecting the initial snapshot.

## Limits and acceptance gates

Office Scripts have no workbook transaction or exclusive coauthor lock. Excel's
connector explicitly does not support concurrent modifications by other clients.
The revision, row fingerprints, structure checks and postread checks detect many
conflicts but cannot make concurrent manual editing conflict-free. Pause the
writer while editing, save/close editors, then resume. Lock/timeout errors must
keep the batch queued and use bounded retry; do not invoke a second writer.

Local tests exercise pure planning, hashes, duplication, sorting, human-field
preservation, stale revision, replay and postread refusal. They are not Microsoft
Excel host acceptance or evidence of production delivery. Before live cutover,
test against a disposable native Excel workbook with representative size:
header-only receipts, row appends alongside the daily table, literal prefixes,
formula recalculation, row sorting, preserved links, an injected timeout/retry,
locked workbook, changed human input, and the returned flow HTTP receipt. Check
runtime limits and licensing in the signed-in tenant before any purchase.

Official API references: [tables and append semantics](https://learn.microsoft.com/en-us/javascript/api/office-scripts/excelscript/excelscript.table?view=office-scripts),
[range and literal/formula APIs](https://learn.microsoft.com/en-us/javascript/api/office-scripts/excelscript/excelscript.range?view=office-scripts),
[Office Scripts TypeScript restrictions](https://learn.microsoft.com/en-us/office/dev/scripts/develop/typescript-restrictions),
[Excel connector limits and concurrent-write restrictions](https://learn.microsoft.com/en-us/connectors/excelonlinebusiness/).
