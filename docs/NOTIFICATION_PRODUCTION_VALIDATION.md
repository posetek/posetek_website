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
records the new source/storage/policy checkpoint; physical publication, complete
backlog treatment and delivery require their own later evidence.
This handoff is not a website release. Newer primary-site changes and native
application releases have their own source and acceptance gates.

## Preserved validation baseline

The fixed backend read at **2026-10-04 04:14:30.165 UTC** (October 3, 9:14 PM PDT)
retained revision **266**, with **690 actions, 1,280 instances, 764 original email
rows and 3 daily/status rows**. The private recovery archive contains **3,585
pending tracker tickets** and all **690 saved human records**, keyed by stable
Action ID. Status, Owner, Due and Fix notes are protected throughout recovery.
These are records and queue tickets, not counts of unique users or proven crashes.

Issue sending remains disabled and the native queue remains paused. Storage and
the notification policy are active, while mailbox identity cutover is not yet
accepted. The first audited backlog page examined **25 jobs**, deferred **10** and
preserved **15**; the remaining backlog audit is incomplete. This is email-job
treatment, not tracker publication or proof of a send. The physical shared master remains
revision **266**, with no post-storage-activation native batch or cloud publication
accepted yet. The archived
backlog and separate capture/publication checkpoints must survive the hold;
independent source capture remains enabled. Workout notification settings were
preserved and workout delivery is not paused by the issue-email hold. The shared
master remains **PoseTek → Technology → Website → User Issue Tracker → PoseTek
Issue Tracker.xlsx**, with Nolan and Taiyo retaining editing access.

The independent Google Cloud fallback was read at **2026-10-04 04:49 UTC** and
its two policies were On with Dylan as their sole destination. That is a dated
configuration check, not proof that every fallback notice was delivered. Its
delivery limits and evidence are checked separately from application email cadence.

## Approved notification and record behavior

New application issue, status, daily-summary and workout emails target
`dylank@posetek.net`; Microsoft 365 sends from `alerts@posetek.net`. Dylan handles
outreach manually. Nolan and Taiyo use the shared tracker to investigate and fix
issues; removing them from alert recipients does not remove workbook access.

The active issue policy authorizes an immediate notice for the first issue and for
a meaningful change: a new recorded reporting account or target athlete, increased
severity, or recurrence after a Fixed/Verified state. Status changes remain visible;
a Verified recovery notice requires the saved fix and retest evidence. Routine
repeats go into the daily summary rather than generating an email for every repeat.
The summary uses the preceding **9 AM to 9 AM America/Los_Angeles** receipt-time
window and separates recorded user attempts, service failures, diagnostics and
confirmed crash evidence. Issue sending remains held pending backlog and
publication acceptance; selecting a send permission does not prove delivery.

Every captured occurrence remains eligible for a distinct issue-workbook instance, including
routine repeats whose email is deferred. Backend capture also runs independently
of email delivery. The current hold means queued updates are not yet publication
proof. Ordinary successful workout completion emails are deliberately outside the
issue-only workbook; workout failures and related processing errors belong in it.

A replay of the same durable source ID is a duplicate observation. A new failed
attempt or a new source occurrence remains a separate instance even when its
wording resembles an earlier failure. Client/server reports can share an instance
only with compatible exact account, request, operation and authorized-target
evidence. Google notices retain individual email rows while linking verified
project/incident evidence. Outlook aliases require authoritative same-item proof;
matching subjects, timestamps or Internet-Message-ID alone cannot merge records.

Previously frozen payloads, consumed send claims, original recipients and partial
delivery receipts stay intact. The pre-cutover unsent backlog requires audited
deferral/review; it must not become a burst of delayed messages. Historical Resend
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

## Deployed source, active storage/policy and remaining acceptance gates

| Implementation | Verified behavior and preserved contract | Still required |
| --- | --- | --- |
| Notification cadence | User-issue and Microsoft source cohorts verified; policy activated with exact readback; first backlog page verified at 25 examined/10 deferred/15 preserved | Complete audited backlog treatment, approved sending resumption, then genuine delivery and published record evidence |
| Tracker storage version 2 | Six tracker source endpoints at version 7 verified; storage gate activated and read back at 07:04:50.217 UTC; archives original join maps once and stores later changes in bounded per-key shards with exact metadata, row and transition hashes | Actual post-cutover native-writer acceptance and fresh physical cloud readback through the preserved receipt chain |
| Insights rebuild repair | Twelve source endpoints verified with each archived dependency closure preserved; ignores irrelevant bookkeeping writes, retains source-event replay identity and coalesces current work under a per-player lease | Genuine rebuild convergence and error review; busy or unfinished work remains retryable and source deployment does not resolve an incident |
| Outlook identity conversion | Read-only typed Graph conversion and exact content/item proofs; historical aliases and rows are retained | Current source/connection acceptance, guarded settings cutover, and successful native publication |

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
cloud workbook bytes and complete source/publication checkpoints. Resume the
approved cloud pipeline only after its source and preservation gates pass. Raw
mail, contacts, credentials, ledgers, previews and recovery archives stay private
and outside Git and the shared tracker folder.
