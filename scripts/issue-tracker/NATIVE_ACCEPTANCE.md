# Native Excel acceptance — October 1, 2026

These results came from Office Scripts running in Excel Online against a private,
synthetic PoseTek workbook. The shared issue tracker was not modified by these
tests. They establish native workbook behavior and the limited private Power
Automate transport/replay acceptance below, not production deployment.

The fixture used the same table headers, source keys, formulas and editable
Status, Owner, Due and Fix notes columns as the tracker. Its 23 actions, 560
instances and 128 emails held 678,648 string characters, compared with 663,516
in the master at that test's checkpoint. All records and evidence links were synthetic.

| Native check | Confirmed result |
| --- | --- |
| Initial bootstrap, update and exact replay | Passed; sorted action rows retained their human fields. |
| Numeric and text preservation | ISO date labels, leading zeros, long numeric-looking IDs and original apostrophes survived literal string writes. Fractional numeric dates required normalization to 15 significant digits before hashing. |
| Exact pending-batch recovery | Passed at revision 3 after a reviewed synthetic hyperlink repair; retained the original batch ID and payload hash, verified all 557 affected links and matched the exact replay receipt. Recovery writer portion: 15,911 ms; this is not an ordinary-write benchmark. |
| Append plus footer preservation | Passed at revision 4 with 23 actions, 561 instances, 131 emails and one daily row. The email reference footer moved to row 139, its link survived, the adjacent daily table was unchanged and all human fields were preserved. Writer: 20,281 ms; replay: 471 ms. |
| Ordinary representative update | Passed at revision 5 with unchanged counts of 23 actions, 561 instances, 131 emails and one daily row. Writer: 17,485 ms; exact replay: 1,160 ms. The existing source hyperlink and human fields were preserved. |
| Fresh read-only preflight, 2026-10-02T04:20:06.051Z | Passed at ready revision 5 with no pending batch and counts 23/561/131/1. Verified all 23 actions' human fields by stable ID, all 716 source rows and 858 source links, formulas, five receipts and the moved footer. No workbook write was performed. |
| Actual Power Automate transport and identical replay | Passed with two exact terminal receipts for frozen batch `synthetic-power-automate-native-06`, revision 6 and unchanged counts 23/561/131/1. OAuth audience and canonical polling-route corrections retained the original batch and prior attempts. HTTP 202 alone was never accepted as a write receipt. |
| Revision-six read-only postflight, 2026-10-02T04:36:16.616Z | Passed with the exact batch-six receipt, ready state/no pending batch, unchanged human-field hash for all 23 actions, 716 source rows, 858 links, formulas and footer. |
| Final readback after verified transport replay, 2026-10-02T04:51:56.787Z | Passed with the same counts, all 23 human-field records and their original hash, 716 source rows, 858 links, formulas and footer. Ready revision 6, no pending batch and exactly six receipts; the frozen batch-six receipt matched. |

The hyperlink probe found a native behavior the original mocks did not cover:
setting a single-cell link over an existing multi-cell hyperlink made that cell's
address ambiguous; clearing that cell also removed the neighboring range links.
The writer now retains unchanged URLs, supports new links and blank-to-URL
enrichment, and refuses replacement or removal of an existing nonempty source
URL for reviewed migration. It never clears source hyperlinks automatically.
The real master's verified XML contained 845 individual-cell hyperlinks with no
multi-cell or duplicate references; its bytes were only read during this check.

The accepted append script used writer snapshot SHA-256
`7cb0931b09cc8856efdf1f5042e088b2c4bc9d2282a203c943defd79ba4b5f28`.
Private scripts, payloads, screenshots and detailed receipts remain outside Git
under `.netlify/error-tracker-2026-10-01/native-acceptance/`.

Cutover still requires a fresh inspection of the cloud master, mailbox access and
both production intake paths. Private transport acceptance does not establish
shared-master publication. No runtime guarantee follows from these browser
measurements, and the 150-row schema ceiling is not a proven batch capacity.
Initialize only from that current native inspection's fingerprint, values and
footer; preserve all teammate edits and verify the resulting paused workbook and
backend seed before enabling one writer. These tests do not establish production
Outlook/backend intake, email delivery, or that the hourly publisher has stopped.
