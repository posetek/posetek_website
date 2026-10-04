# Notification production validation

This is the handoff for the October 3–4 validation work on the
`codex/user-issue-alerts` automation branch. All **31 approved source endpoints**
passed exact deployed source, configuration and IAM checks: twelve Insights,
six tracker at version 7, ten user-issue and three Microsoft-email endpoints.
The aggregate check also verified the complete source-release chain and preserved
unrelated functions. Tracker storage version 2 was activated and read back at
**2026-10-04 07:04:50.217 UTC** (October 4, 12:04 AM PDT). The remaining behavior
below is gated behavior until its separate acceptance passes. The first-plus-daily
notification policy was committed at **2026-10-04 07:10:32.256247 UTC** and its
readback was reconciled without a second policy commit. Issue sending is still
disabled; active policy configuration does not prove email delivery.
Source verification and the storage setting do not prove rebuild convergence,
email delivery or publication of queued records.
The [preceding progress receipt](../deployment/OUTLOOK_IDENTITY_AUTOMATION_PROGRESS.json)
and dated production receipts remain historical evidence. The
[partial validation receipt](../deployment/NOTIFICATION_PRODUCTION_VALIDATION_20261003.json)
preserves the source/storage/policy checkpoint, completed held email-job audit and
first accepted storage-v2 workbook batch, and adds the later revision-365 physical
and identity acceptance below. Sending and genuine delivery remain separate gates.
This handoff is not a website release. Newer primary-site changes and native
application releases have their own source and acceptance gates.

## Latest accepted publication and identity checkpoint (October 4)

The **17:03:17.750 UTC** backend snapshot had revision **365** and zero pending
tracker tickets. Physical cloud readback at **17:06:03.434 UTC** accepted **789
actions, 3,228 occurrences, 2,384 original email rows and four daily/status rows**.
All 365 native receipts, machine hashes, formulas and cached results passed.
Human-field readback at **17:09:07.313 UTC** preserved all **690 saved records**
from revision 266 by stable Action ID, alongside 99 additional action records.
The post-identity uniqueness proof at **17:09:52.135 UTC** accepted every one of
the 3,228 occurrence sources, with **zero incomplete source-authority rows**.
The original full companions retained exact raw evidence; these verifiers made
no workbook, source-checkpoint or cloud writes.

Guarded mailbox identity activation completed at **15:28:02.319 UTC** through
one settings write and one source-binding write, without row, checkpoint, queue,
workbook or email writes. The accepted revision-365 identity counts are **187
recorded-actor rows**, **148 verified-email rows**, **39 unverified-email rows**,
and **3,041 unknown-actor rows**. All 187 recorded-actor rows retain unavailable
Auth display names; no fresh Auth lookup is claimed. These are row counts, not
187 distinct accounts or users. The historical count of **34** meant incomplete
source authority, not necessarily missing or pending contacts. Its current value
is zero; unknown operators and six historical target labels remain unconfirmed.

At this snapshot, Outlook captured and published through **16:58:02.536 UTC**
(sequence 605); backend captured and published through **16:58:02.544 UTC**
(sequence 596). Both had all captured windows published. This covers those dated
cutoffs, without asserting coverage of later arrivals. Later revision-367 backend
health with capture/publication through approximately **17:20 UTC** is progress,
not fresh physical acceptance of that revision. The earlier checkpoint
plan003 was read back in the **after** state by GET-only inspection at
**15:19:25.005 UTC**. Its original journal remains uncertain, with 17 events and
`restoreRequired:true`; the readback neither rewrites that history nor authorizes
replay or establishes a new workbook revision.

All held native-publication, capture and recovery operations have been restored
to their original RUNNING/ENABLED states. The final006 guarded send attempt was
refused at **17:15:41.837 UTC** with `issue_resume_fresh_evidence_required`:
**no apply, send journal, consumed send intent or email send**. Overall production
acceptance remains **false** and genuine Dylan-only delivery remains **OPEN**.
The Microsoft sender was observed **On at 17:13:47.633 UTC**, with Dylan's
connection unchanged. Its visible trigger-concurrency/throttling advisory remains
unresolved by these proofs. Configuration and successful-flow badges do not prove
delivery; the genuine-delivery gate remains open.

The fixed Insights metadata read at **16:58:29.159 UTC** supports **15 actual
settled v4 manifests**, rebuilt between **16:54:15.390 and 16:54:31.990 UTC**.
Of 497 player-parent documents, 69 had current manifests: 63 v4 and six v2;
62 were coherent fresh v4 and seven were stale (the six v2 plus one v4).
The remaining 428 had no current manifest. All 101 referenced day documents
were present; no active rebuild lease was observed. Seventeen pending testing
markers were ordinary open/incomplete work, with no eligible unresolved finalizer
at that fixed point. The census read parent names/presence, not profile fields;
all-497 Insights-manifest acceptance remains false. The deployed twelve-endpoint
cohort retains nine v4 and three older v2 dependency contracts.

The earlier fully paginated **07:05–16:30 UTC** log interval contained no
WARNING-or-higher records and ended before those rebuilds. The newer full
**07:05–17:18 UTC** review across the twelve scoped endpoints found **29 WARNING
records**, all from `projectInsightRecords`, and **zero ERROR-or-higher records**.
Their retained text, “Snapshot has no readTime. Using now()”, occurred between
**16:54:17.150030 and 16:54:33.107953 UTC**, overlapping the rebuild window; the
text matches the local Firebase Functions **4.9.0** SDK fallback when both snapshot
create/update times are absent; that version is also pinned by the deployed
`projectInsightRecords` closure lockfile. Runtime SDK bytes were not independently
downloaded. These warnings do not
establish failed rebuilds or crashes. Settled metadata and bounded logs do not
prove every endpoint ran, payload accuracy, user outcomes, all-account convergence,
incident resolution or email delivery.

## Preserved earlier validation checkpoints

The fixed backend read at **2026-10-04 04:14:30.165 UTC** (October 3, 9:14 PM PDT)
retained revision **266**, with **690 actions, 1,280 instances, 764 original email
rows and 3 daily/status rows**. The private recovery archive contains **3,585
pending tracker tickets** and all **690 saved human records**, keyed by stable
Action ID. Status, Owner, Due and Fix notes are protected throughout recovery.
These are records and queue tickets, not counts of unique users or proven crashes.

The held email-job audit completed **130 pages**, examining **3,226 jobs**:
**1,152 deferred** for backlog review and **2,074 preserved**. Its exact source
cutoff remains **2026-10-04 07:10:32.256247 UTC**; the completed checkpoint was
saved at **08:50:03.285210 UTC**. No email or workbook write was performed by this
audit. Original payloads, consumed claims, delivery evidence and historical Resend
jobs remain intact. These counts are jobs, not unique users or resolved issues.

Fresh cloud readback at **09:17:13.707 UTC** (2:17 AM PDT) verified the first
post-cutover native batch at **revision 267**: **691 actions, 1,319 instances,
804 original email rows and 3 daily/status rows**. All 267 native receipts,
machine hashes and formulas passed the preserved original verifier. Separate
readback at **09:19:42.528 UTC** confirmed all **690 saved human records** from
revision 266 survived by stable Action ID. Full storage-v2 companion verification
preserved the raw snapshot and used no source-state splicing.

This first batch establishes physical publication of its accepted changes, not
complete catch-up. The **09:14:27.509 UTC** backend snapshot still had **3,598
pending tracker tickets**. Outlook capture was complete through **09:09:03.035 UTC**,
but publication through **00:34:05.451 UTC**; backend capture was through
**09:09:03.134 UTC**, but publication through **00:34:05.351 UTC**. Both sources
reported unpublished captured windows, and outstanding-delivery recovery remained
in progress. Later arrivals need their own checkpoints.

The same revision-267 cloud bytes were freshly verified at **09:42:35.564 UTC**;
all **690 saved human records** passed again at **09:43:47.033 UTC**. The native
queue resumed **RUNNING** at **09:57:43.847 UTC**, with readback verified at
**09:58:01.150 UTC**. Exactly one empty resume request was made; the original pause
journal, routing, rate limits and retry configuration remain intact. This resumes
normal publication without authorizing issue emails or changing workout settings.

The **10:00:56.037 UTC** backend read observed revision **268** and an active native
writer. Outlook capture reached **09:54:04.096 UTC** and backend capture reached
**09:54:04.031 UTC**; publication still reached only **00:34:05.451 UTC** and
**00:34:05.351 UTC**, respectively. This is backend progress, not fresh physical
acceptance of revision 268 or complete publication. The existing outstanding-delivery
scan remains active. Issue sending stays disabled; mailbox identity cutover,
current-contact corrections and genuine Dylan-only delivery remain unaccepted.

Independent capture continues. Workout delivery is not paused by the issue-email
hold. The master remains **PoseTek → Technology → Website → User Issue Tracker →
PoseTek Issue Tracker.xlsx**. Nolan and Taiyo's editing access was independently
confirmed at **08:00 UTC**; no permissions were changed.

The independent Google Cloud fallback was read at **2026-10-04 08:38:52.808 UTC** and
its two policies were On with Dylan as their sole destination. That is a dated
configuration check, not proof that every fallback notice was delivered. Its
delivery limits and evidence are checked separately from application email cadence.
A separate Outlook review fully paginated **08:35 UTC inclusive to 09:38:30 UTC
exclusive**, across all subjects and read states, and found no messages in that
interval. That interval does not prove later delivery, cover older mail or resolve
an incident.

## Approved notification and record behavior

New application issue, status, daily-summary and workout emails target
`dylank@posetek.net`; Microsoft 365 sends from `alerts@posetek.net`. Dylan handles
outreach manually. Nolan and Taiyo use the shared tracker to investigate and fix
issues; removing them from alert recipients does not remove workbook access.

The active issue policy authorizes an immediate notice for the first issue and for
a meaningful change: a new recorded reporting account or target athlete supported by
recorded identity evidence, increased severity, or recurrence after a Fixed/Verified
state. Status changes remain visible;
a Verified recovery notice requires the saved fix and retest evidence. Routine
repeats go into the daily summary rather than generating an email for every repeat.
The summary uses the preceding **9 AM to 9 AM America/Los_Angeles** receipt-time
window and separates recorded user attempts, service failures, diagnostics and
confirmed crash evidence. Issue sending remains held after final006's freshness
refusal; selecting a send permission does not prove delivery.

Every captured source occurrence remains documented in its appropriate workbook
evidence: backend incidents as instances and incoming notices as individual email
rows. Routine repeats are retained when their immediate email is deferred. Backend
capture also runs independently of email delivery. Resumed publication and queued
updates do not prove complete catch-up. Ordinary successful workout completion
emails are outside the issue-only workbook; workout failures and related
processing errors belong in it.

A replay of the same durable source ID is a duplicate observation. A new failed
attempt or a new source occurrence remains a separate instance even when its
wording resembles an earlier failure. Client/server reports can share an instance
only with compatible exact account, request, operation and authorized-target
evidence. Google notices retain individual email rows while linking verified
project/incident evidence. Outlook aliases require authoritative same-item proof;
matching subjects, timestamps or Internet-Message-ID alone cannot merge records.

Previously frozen payloads, consumed send claims, original recipients and partial
delivery receipts stay intact. The pre-cutover unsent backlog has completed its
audited deferral/preservation pass; retained review work must not become a burst
of delayed messages. Historical Resend
jobs are retained for review and are not replayed, reassigned or purchased extra
quota by this work.

## Identity and outreach limits

Account/reporter, Contact email, Target athlete and Attempted action are separate
fields. Current outreach details come from a server-owned lookup of the exact
recorded Auth UID, with lookup time and email-verification state. A failed lookup
keeps the incident and shows unavailable or explicitly last-known contact evidence.
The target athlete's name must never be combined with another account's identity.

Service failures without recorded actor evidence retain an unknown operator and
unavailable contact. A diagnostic uploader may identify a reporter without proving
who experienced or operated the failing device. Generic diagnostics and unclean
sessions do not establish a crash, memory exhaustion or interrupted workout.
Unknown cause and missing device/build/action context remain explicit.

The earlier exact-source review confirmed **39 automated-service message/incident
joins** without identifying an affected operator. Its **34 older annotations**
were incomplete source-authority rows, rather than a count of missing contacts;
the later revision-365 proof reduced incomplete source authority to zero.
**Six historical target labels** remain unconfirmed rather than being presented
as verified athlete identities. Complete identity acceptance does not identify
unknown operators or make unverified contacts verified, and retained historical
contact text does not establish current outreach acceptance.

## Manual Excel status and recurrence

New backend occurrences under an existing Action retain separate instances and
machine recurrence evidence. Status, Owner, Due and Fix notes remain attached to
the Action ID; automation never reopens or resolves those manual fields. The
native writer refuses a new instance under a currently Resolved action when its
required machine recurrence evidence is missing.

Excel's manual Resolved status is separate from the admin issue's Fixed/Verified
state. An Excel-only change does not authorize an immediate recurrence email.
Proven recurrence after the recorded admin Fixed/Verified transition does; other
routine repeats can appear in the workbook and daily summary. Google notices
retain individual email rows grouped by exact project/incident. Mail-only repeats
do not create backend instances or their recurrence marker, and a service recovery
notice does not resolve the manual task or prove the user's problem is fixed.

## Deployed source, active storage/policy and remaining acceptance gates

| Implementation | Verified behavior and preserved contract | Still required |
| --- | --- | --- |
| Notification cadence | Source cohorts and policy readback verified; all 130 held backlog pages audited at 3,226 examined/1,152 deferred/2,074 preserved | Approved sending resumption, then genuine Dylan-only delivery and matching published identity evidence |
| Tracker storage version 2 | Six source endpoints and storage flag verified; revision 365 physically accepted with all 690 saved human records, complete native receipt chain and captured/published source cutoffs aligned through 16:58 UTC; maintenance holds restored | Fresh evidence for later arrivals and the separate final-send gate |
| Insights rebuild repair | Twelve source endpoints retain their exact dependency closures; 15 actual settled v4 manifests and bounded log review accepted within the scope above | Seven stale and 428 missing current manifests remain explicit; no all-account, payload, user-outcome or incident-resolution acceptance |
| Outlook identity conversion | Guarded settings activation at 15:28:02.319 UTC and revision-365 post-identity acceptance; all 3,228 occurrence sources exact and historical aliases/rows retained | Unknown operators, unverified contacts and six historical target labels remain explicit; genuine delivery is separate |

The tracker repair retains the existing workbook schema, row IDs, evidence
links, formulas and human columns. Frozen batches replay their identical payload,
digest and revision; uncertain acknowledgements never authorize reseeding or a
replacement batch. Capture completeness and publication completeness remain
separate for Outlook and backend. A successful flow badge or silence from alerts
does not resolve an action or prove complete coverage.

The independent tracker review passed **209 local tests**, including storage
cutover/replay, bounded growth, corrupted shard/row rejection, alias preservation
and source checkpoint behavior. Insights tests compare the repaired actual
dependency variants with their original calculations and cover source replay,
concurrent work, retry, deletion and lease expiry. These checks do not substitute
for deployed or device acceptance. A separate local emulator check against
freshly captured deployed rules passed **300 direct-client denial assertions**:
six roles cannot read, create, update, delete or list the Insights state/event
paths or the new tracker-index and notification-cadence collections. This check
made no production writes or rules changes. A dated private mobile checkout is
not asserted to be the current canonical rules source.

## Coverage boundaries and operation

Power Automate event intake, backend capture and cloud recovery operate without
this chat, Codex or Dylan's computer. The retired hourly Codex procedure is not a
dependency and must not be restarted. Licensed cloud connections and their account
authorization must remain available.

The new native reporting candidate remains unreleased and requires Mac/iPhone/
TestFlight acceptance. Crash export configuration does not prove a genuine
symbolicated crash reached the incident, Dylan's mailbox and shared workbook.
Handled coach operations without explicit reporting instrumentation remain outside
guaranteed capture; the fourteen observed social callables do not cover every
coach workflow. Workout emails identify the player and available organization/team
label; a coach name in that label is not a dedicated assigned-coach lookup.

During cutover and recovery, preserve all source IDs, pending versions, original
receipts and team notes; confirm genuine delivery to Dylan only, then verify fresh
cloud workbook bytes and complete source/publication checkpoints. Keep issue
sending held until its guarded identity and publication checks pass. Sending
acceptance then requires genuine delivery and its matching published record; the
accepted native queue can continue processing retained updates. Raw mail, contacts,
credentials, ledgers, previews and recovery archives stay private
and outside Git and the shared tracker folder.
