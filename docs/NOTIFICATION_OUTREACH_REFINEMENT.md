# Notification recipients, outreach identity and native tracker recovery

The following dated October 2 results are historical checkpoints. The later
[coverage correction](NOTIFICATION_COVERAGE_CORRECTION.md) and
[its production receipt](../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
record the current application release, user-issue version 8, tracker version 5,
scoped social observation wrappers and current cloud-workbook verification status. Preserve
the original revision-121 receipt and its source intervals. Current unknown
operators, unverified contacts, mailbox alias approval and native device gates
remain explicit; row counts never establish unique affected-user counts.

The October 2 refinement makes Dylan the only receiver of new application issue,
status, daily-summary and workout emails and both PoseTek Google Cloud alert
policies. Nolan and Taiyo retain editing access to the existing shared workbook:
**PoseTek > Technology > Website > User Issue Tracker > PoseTek Issue Tracker.xlsx**.
Dylan handles user outreach manually. No automatic outreach, subscription purchase,
website/native release or historical Resend replay is part of this change.
Use [the production receipt](../deployment/NOTIFICATION_REFINEMENT_PRODUCTION.json)
for actual deployment, publication, delivery and coverage results.

## Recorded identity and current contact

`userIssueOccurrences.reporterUid` remains the recorded account key. Authenticated
token name/email/verification/time is separate historical evidence. Server-owned
`currentContact` resolves only that exact UID using Firebase Admin Auth and records
the current display name, email, verification flag, disabled state and lookup time.
Client-supplied actor/contact fields are normalized away. The target athlete stays
in the existing separate `player` record, with existing ownership/staff checks.
Reporter or diagnostic uploader identity does not establish the original device
operator. Service records without a UID never acquire an actor from a recipient,
device, nearby event or target athlete.

Lookup errors leave incidents intact and contacts retryable. An earlier successful
lookup remains evidence, labeled last-known; the current contact is unavailable
when a later lookup fails. The existing five-minute source recovery also scans
contacts in bounded pages, with a separate repair cursor and no capture/publication
checkpoint advancement. Current contacts refresh after 24 hours; failed lookups
retry after 15 minutes. New incidents check the exact account at intake, using the
bounded server cache. These lookup limits do not establish user email ownership
when Firebase reports the address unverified.

Emails show **Account/reporter**, **Contact email**, **Target athlete** and
**Attempted action** separately, with occurrence/receipt times, code, build/device
and evidence. Credential/email redaction remains for arbitrary free text; only
validated server-owned account fields supply an outreach address.

## Existing Excel schema and evidence

The native writer adds a labeled current-contact annotation to the existing
`User who acted / reported` and `Identity basis` cells. Recorded actor UID and target
player ID remain separate columns. Historical wording, source links, row IDs and
Action IDs stay unchanged. The writer preserves saved Status, Owner, Due and Fix
notes by Action ID even after sorting. Never replace the master with a downloaded
copy, run the retired whole-file renderer, reseed or initialize native sync again.

Outlook joins require a unique backend Internet-Message-ID confirmed by Exchange,
exact sender, full subject, frozen effective recipient set, and the same-ID backend
occurrence. Text resembling a UID or email reference is insufficient. A separate
bounded reconciliation catches later traces outside the normal receipt-time
overlap. Every original immutable Outlook item stays a separate row, including
Google Cloud repeats, unrelated candidate notices requiring triage and unmatched
messages. Backend intake remains independent of email delivery.

## Frozen delivery and recovery

The dispatch guard and the transactional Microsoft send claim both enforce Dylan
alone. New claims snapshot the effective payload digest and recipients. Existing
consumed permissions, receipts and traces retain the original envelope; a later
recipient change cannot turn a historical partial delivery into all-delivered.

The approved recent-unsent recovery window is
`2026-10-02T20:32:00.000Z <= createdAt < 2026-10-02T21:16:12.577Z`.
Each Microsoft job must have a frozen original envelope, no consumed permission or
send/receipt/trace evidence, and no active dispatch lease. A transaction rereads the
job, receipt subcollection and send pause. Its audited amendment retains the
original payload and prior attempt/failure state, freezes Dylan-only destinations
and an exact-occurrence contact rendering, and is immutable once claimed. No
callable, schedule or trigger exposes this operator-only amendment primitive.

Native revision 87 had already saved batch
`3e88313e-a544-430b-83bb-da2f49d8ef17` while backend revision 86 was blocked.
Fresh cloud verification checked its exact digest, full revision chain, rows,
formula results, archive, receipts, original 882 links and all 180 current human
records. The ordinary bridge acknowledged that identical cached receipt with the
queue paused, without a Flow request, Excel rewrite or new batch.

Asynchronous acknowledgement metadata failures now have fixed sanitized reason
codes and bounded identical-batch retries. Unsafe polling URLs are not followed.
Invalid terminal workbook receipts still block on the existing URL, digest,
revision, row-set, count and conflict checks. Only verified native receipts advance
publication checkpoints; fresh cloud readback independently confirms publication.
Contact and late-mail repair cursors never claim source completeness.

## Final physical acceptance and fixed-cutoff catch-up

Final fresh cloud readback verified 289 actions, 1,104 instances, 402 email rows
and two daily records against the exact backend revision-121 chain. The fixed
`23:32:01.540Z` queue audit had zero pending tickets. All 180 saved human records,
882 historical source links, formulas and all 121 native receipts were preserved
and verified. Independent revision-121 identity
acceptance verified all 101 current-contact annotations: 77 historical occurrences
and 24 newer occurrences. Real diagnostic uploads and staff actions involving a
different target athlete passed separate identity acceptance checks.

All eleven approved recent amendments delivered to Dylan alone and are physically
joined at revision 121 to their workbook incident records by verified Internet-Message-ID. Their
separate identity fields describe nine diagnostic upload messages and two service
failures with unknown operators. Original frozen payloads and consumed claim
digests remain intact. A fresh 23:24 UTC permission review confirmed Nolan and
Taiyo still have **Can edit** access. The revised team guide passed fresh cloud
readback with SHA-256
`4243d2df168b0374eb427604a474d7d62b78352ea0401b911649c5a1981689f1`.

Guarded publication metadata recovery reconciled 141 lagging existing windows in
eight transactions. Capture fields remained unchanged, with no Excel, Flow, email
or seed changes. Both sources completed and published all 159 windows through their
fixed October 2 cutoff at 4:28 PM PDT: Outlook through
`2026-10-02T23:28:04.127Z` and backend through `2026-10-02T23:28:04.120Z`. A later
`23:34:18.201Z` readback observed two newly queued arrival tickets. The normal native
queue resumed **RUNNING**, verified at 23:36 UTC with unchanged configuration.
This confirms source catch-up through those checkpoints. Later arrivals and the
independent outstanding-delivery scan require their own completeness evidence.
The former Codex tracker automation has since been removed. Consult the production receipt
for exact coverage rather than inferring it from row counts or delivery.

## Operation and limits

The original sender, Outlook/Excel connections, tenant service-principal restriction,
claim-once safeguards, native script and workbook schema are preserved. Event
intake and five-minute full-source catch-up continue automatically in the cloud,
independently of this chat, Codex and Dylan's computer, with fixed UTC upper bounds,
pagination and a 30-minute overlap; fifteen-minute recovery handles outstanding
work. Source capture, writer publication, send acceptance and recipient delivery are different
states. Do not claim complete coverage or delivery from a flow badge or silent
alerts. A resolved action requires verified remedy/retest evidence; recurrence is
retained and flagged.

Private captures, raw emails, contacts, backups, scripts, source snapshots and
credentials stay outside Git and the shared folder. Only the workbook and team
guide belong in that folder. Read the production receipt before another scoped
release; preserve existing function IAM, schedules, rules and all human records.
