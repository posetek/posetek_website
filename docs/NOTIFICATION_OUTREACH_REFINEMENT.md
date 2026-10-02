# Notification recipients, outreach identity and native tracker recovery

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
copy, run the paused hourly renderer, reseed or initialize native sync again.

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

## Operation and limits

The original sender, Outlook/Excel connections, tenant service-principal restriction,
claim-once safeguards, native script and workbook schema are preserved. The old
hourly Codex automation stays paused. Event intake and five-minute full-source
catch-up continue in the cloud, with fixed UTC upper bounds, pagination and a
30-minute overlap; fifteen-minute recovery handles outstanding work. Source
capture, writer publication, send acceptance and recipient delivery are different
states. Do not claim complete coverage or delivery from a flow badge or silent
alerts. A resolved action requires verified remedy/retest evidence; recurrence is
retained and flagged.

Private captures, raw emails, contacts, backups, scripts, source snapshots and
credentials stay outside Git and the shared folder. Only the workbook and team
guide belong in that folder. Read the production receipt before another scoped
release; preserve existing function IAM, schedules, rules and all human records.
