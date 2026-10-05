# PoseTek website project context

Reviewed on October 5, 2026. This guide summarizes the available repository and
release notes; it is not a claim that every historical discussion or private
business document is included.

## Current hosting and marketing snapshot (2026-10-05)

Netlify's ordinary Git build published merged source `b776c32` as
`6ac3d1c930af650008d83718` at 9:37:14 AM PDT. The application and feedback entries
retain the preceding attribution release bytes; this publication updates marketing
and adds runtime assets. All 1,638 prior protected file records are unchanged.
The reconciled baseline now protects 1,697 files, including the 59 added assets.

A local, ignored `.netlify/approved-marketing/manifest.json` captures the exact
original Players/Coaches documents, their provider hashes and five live route
hashes. The application-release build passed using this snapshot and kept both
marketing documents byte-for-byte; all 55 release-guard tests passed. See
[the snapshot receipt](deployment/MARKETING_SNAPSHOT_20261005.json).
This preparation does not upload or publish the new application. Review the exact
hosted draft and complete its backend/feature acceptance before publication.

## Local website source reconciliation (2026-10-05)

The source integration preserves fetched main `0ad845e`, all local feature
history, the published feedback-attribution branch `1dca2a5` and issue-alert
branch `0005f12`. It also includes tracking-only replay and compressed diagnostic
journals. The latest live application remains the feedback release recorded below;
this integration does not publish a new website or backend revision.

The combined source passed 1,660 frontend tests, 948 backend tests (three existing
private-history skips), lint, TypeScript/Astro, 55 release guards and 60 diagnostic
rule assertions. The ordinary production build preserved all 1,638 protected files.
Tracked-source mappings and exact checksum/size checks now support either Git line
ending without changing any pinned production bytes. See [the integration receipt](deployment/WEBSITE_MAIN_RECONCILIATION_20261005.json)
for branch ancestry, local browser checks, remaining release boundaries and logs.
All 27 pre-existing untracked duplicate files are preserved outside the commits.

## Prospective feedback account attribution (2026-10-05)

The latest application-changing release is `6ac395bfba35bceed566d26c`, source `5792b63`, published
October 5, 2026 at 5:23:26 AM PDT. It preserves the concurrently published Kai
Overview release by merging `0ad845e` before rebuilding. The exact reviewed
artifact matched all 1,640 files in the 1,641-record provider inventory. Hosted
and production each passed 27 synthetic browser checks with no feedback writes;
the reconciled baseline protects 1,638 files and passed the ordinary build guard.
Live backend acceptance passed 48 checks with owned synthetic accounts/responses
removed; no real feedback or user identities were inspected.

Dylan requested account attribution for future feedback and confirmed that
signed-out shared links should continue accepting anonymous responses. The
public form explains attribution before the questions and adds no consent
checkbox. Signed-in submissions use a server-verified Firebase Auth account
snapshot (name/email when available and exact UID); no client-supplied author
or player-profile mapping is trusted. Workout/results entry points require
sign-in. Signed-out QR, message and direct links remain anonymous. Firebase
anonymous-auth sessions are treated as signed out. Version-1 and historical
responses remain anonymous; identities are not inferred from logs or records.

The isolated form imports Auth only, with no Firestore, application issue
tracking, usage analytics or replay. Only account submissions send a token;
opened/started events contain no account fields. Sessions and responses share
the deduplication UUID, so a privileged backend operator can relate a submitted
session to its response. Reporting continues to count form sessions, not unique
players. The private admin view labels account and anonymous responses clearly.
Privacy disclosure is dated October 5. The user's age statement is not a
recorded DOB or proof of parental consent; existing under-13 protections remain.

Read [the feedback handoff](docs/APP_FEEDBACK.md) and
[the attribution production receipt](deployment/APP_FEEDBACK_ATTRIBUTION_PRODUCTION.json)
for publication, scoped backend evidence, synthetic acceptance and recovery.
This change preserves invitation timing, seven-day cadence, training records,
client-denial rules, 90-day feedback retention, legacy feedback and approved
marketing/icon bytes. Native invitations and the 12-player comprehension pilot
remain separate and outstanding.
Account/privacy deletion requests must also run the exact-UID feedback erasure
procedure, including matching diagnostic sessions. The dry-run-first operator
helper passed 12 synthetic tests; it is not an automatic Auth-deletion hook.

## Kai's coach Overview release (2026-10-05)

The preceding coach Overview website release was `6ac38fde67d690075984e58b`, source
`7b1aa1869624e96f6e300912ce742ffb1882b058`, published October 5, 2026 at
4:55:11 AM PDT. Kai's `Coach-Dashboard` commits are preserved alongside the
current feedback and approved P-icon source. See [the release handoff](docs/COACH_OVERVIEW_RELEASE.md)
and [verified production receipt](deployment/COACH_OVERVIEW_PRODUCTION.json).

Coach Overview now leads with a dated Team snapshot and a collapsed roster whose
open state survives fetches, retries, search, pagination, date changes and refresh.
Visible population counts and active filters remain available. Review links
preserve other reporting filters and clear name search to match positive snapshot
counts; zero-count actions are disabled. **No workout status** is distinct from
no activity: missing records, unrecognized endings and endings outside the period
can fall here. Weekly performance lines connect available results across empty
weeks, with the explanation and data table retaining missing-result distinctions.

Production verification matched 1,587 website artifacts to 1,588 provider records.
It preserved 1,540 predecessor records; only the application entry and generated
provider metadata changed, with 46 runtime assets added. The predecessor is
`6ac1abf790c8c0037928b52a`. Approved Players/Coaches, feedback and stable P icon
bytes are preserved. Reporting calculations, cohorts, membership/access, private
drafts, backend functions, rules, gateway, native and held content are unchanged.
That release's reconciled baseline protected 1,585 files, and the ordinary TypeScript/Astro
preservation build passed for all of them. The current protected-file inventory
remains in `deployment/homepage-baseline.json`.

## PoseTek P website icons (2026-10-03, historical introduction)

Dylan requested the approved PoseTek P for browser tabs and Google Search.
The source now uses the previously approved outlined lime P badge, recovered
from the official icon asset branch, with SVG, 96px PNG, multi-size ICO and
180px Apple touch variants. Shared Astro and compatibility heads point to stable
same-origin icon URLs. The full wordmark remains available for page content.
The icon-only website release was `6ac1abf790c8c0037928b52a`, published October 3, 2026 at
6:31:53 PM PDT from source `c2ba02b`. Its 1,541 website artifacts match the
1,542-record provider inventory. Only icon links in 83 HTML heads changed;
1,454 existing files retain their exact bytes, and four icon files were added.
All page bodies, runtime assets, application behavior and feedback security
headers are preserved. Hosted and production browser checks decoded all four
formats across five entry routes; served-content checks passed for 22 routes.
That release's reconciled preservation baseline protected 1,539 files, and the ordinary
TypeScript/Astro build preserved all of them after publication. See
[the production receipt](deployment/SITE_ICONS_PRODUCTION.json) and
[the icon handoff](docs/SITE_ICONS.md) for provenance, Google recrawl limits
and the guarded metadata-only release workflow. Google Search display has not
been verified; Google controls recrawling and favicon selection.

## Coach and admin engineering handoff for Kai (2026-10-03)

[Kai's dashboard handoff](docs/KAI_DASHBOARD_HANDOFF.md) documents current coach
Team Insights and the admin workspace, their data definitions, source entry
points and verification cases. The companion Word document includes desktop
screen captures and is a generated deliverable kept outside Git. Credentials,
signup codes and identifiable player screenshots are not included in the shared
repository handoff.

Dylan's requested direction is to help coaches understand player standing and
development needs with fewer steps, without making workout prescription a
required path, and to simplify admin interpretation and oversight across clubs.
Kai has creative discretion to propose information hierarchy and workflows.
Automatic reconciliation, exception monitoring and revised navigation are
directions to explore, not newly released functionality or approved final designs.
The current membership, qualification, comparison, privacy and release contracts
remain binding. This documentation review does not change website behavior,
production records, permissions or deployment.

## Complete phone and station performance (2026-10-03)

The user-approved live callable connection is enabled, with genuine authenticated
HTTP 200 requests verified. Local `/admin/device-performance` shows all recorded
algorithms over 90 days by default, every known installation, inspectable
unattributed runs, and explicit missing diagnostic indexes. Reconciliation found
315 current manifests/summary generations, 310 runs, six recent phones plus three
historical installation identities, and 97 indexes whose manifests are unavailable.

Team session cards add average time per player (first capture to final accepted
processing result, including pauses), median/range and coverage, plus per-drill
completed-processing averages including partial measurement results. Source and
timing cohorts remain separate. Protocol throughput counts accepted partials;
measurement quality and syncing remain separate. The current four-player event
has all 81 processing runs and 80 accepted/synced reps available. The bottom
player table now prioritizes station durations, full-runthrough totals, inter-station
gaps and averages, followed by a per-player station chart with duration and shared
clock modes. The all-attempt log is removed; chart points open individual run
details. This presentation follow-up uses the unchanged live v5 API. See
[phone contract](docs/DEVICE_PROCESSING_DASHBOARD.md) and
[team contract](docs/TEAM_SESSION_PERFORMANCE.md).

The requested chart follow-up combines station throughput and interruption markers
in one full-width chart with shared time and rep-count axes. Source and local
verification are recorded in [the team contract](docs/TEAM_SESSION_PERFORMANCE.md);
shared-checkout integration is complete and the updated dashboard is available on
local port 5173. Hosted publication remains unchanged.

The earlier website draft `6ac1911a5b925767ec7362b8` is superseded. Production has
changed concurrently; this follow-up updates local UI and the scoped reporting
backend without promoting an obsolete website artifact. Historical rollout
receipts remain historical; the [completeness receipt](deployment/DEVICE_PROCESSING_COMPLETENESS.json)
records callable v5 source verification, genuine authenticated HTTP 200 requests,
37 backend tests, 81 frontend tests, build and actual-data browser checks.

## Optional app feedback (2026-10-03)

The feedback application release was Netlify deployment `6ac17bc21377cbeaea114800`, published
October 3, 2026 at 3:12:14 PM PDT, from application source commit `d82cf40`.
It preserves the preceding issue-coverage release and approved Players/Coaches
bytes. Full provider inventory verification passed for 1,538 files, including
1,537 website artifacts and the provider's generated configuration record.
The reconciled baseline protects 1,535 application/public files; the ordinary
build preserved all of them, and local entry checks passed for 25 application
routes, five marketing routes and 1,414 assets.
Read [the feedback release receipt](deployment/APP_FEEDBACK_PRODUCTION.json) and
[the feedback handoff](docs/APP_FEEDBACK.md) for exact hashes and validation.

An optional invitation appears on return to Training after a successful completed
workout save, at most once per seven days in the same browser. Pain stops, early
endings, failed saves and previews are excluded. Results retain a feedback link.
At that release, `/feedback` was a separate public document requiring no login or name, carrying
only a broad source and random form-session ID to its isolated HTTPS endpoint.
It loaded no analytics/replay or authentication scripts. Verified PoseTek admins
can read recent responses and form-session counts and download a QR code at
`/admin/feedback`.

The two scoped feedback functions, three count indexes and TTL policies are
live and verified. The canonical mobile-owned rules explicitly deny all client
access to the three new collections; no permissive fallback applies. Responses
and diagnostic form-session events expire after 90 days; separate abuse counters
expire after 30 minutes. Existing player records, legacy feedback, training gates
and storage rule bytes were preserved. The canonical rules source is shared in
[mobile PR 35](https://github.com/posetek/posetek-mobile-app/pull/35).

The 12-player comprehension review across the three previously agreed age bands
remains outstanding. Automated mobile layout checks do not establish player
comprehension or the 30–60-second target. Seven days is a pilot cadence; native
invitations still require a separate mobile release.

## Current issue alert delivery (2026-10-05)

October 5 current issue-send update: [new-only delivery handoff](docs/CURRENT_ISSUE_ALERT_DELIVERY.md) and [verified source/activation receipt](deployment/CURRENT_ISSUE_ALERT_DELIVERY_20261005.json). New issue sending is enabled with a send-only cutoff; historical queues stay untouched. The dated acceptance and holds below remain historical records.

## Historical automation production validation (2026-10-03–04)

The `codex/user-issue-alerts` automation source is now integrated with the current
website source. These dated automation receipts do not change the current website
publication recorded above, training content, rules or native application bytes.
Historical receipts below remain records of their respective checkpoints.

All 31 approved source endpoints passed exact deployed-source, configuration and
IAM checks: twelve Insights, six tracker at version 7, ten user-issue and three
Microsoft-email endpoints. Unrelated functions and the full release chain were
preserved. Storage version 2 was activated at `2026-10-04T07:04:50.217Z`. The
first-plus-daily policy was committed at `2026-10-04T07:10:32.256247Z` and reconciled
without a second commit. Its held email-job audit completed 130 pages at that
original cutoff: 3,226 examined, 1,152 deferred and 2,074 preserved, with no email
or workbook writes by the audit. Original envelopes, consumed claims, receipts
and historical Resend jobs remain intact. Issue sending is still disabled.

The revision-266 archive protects all 690 saved human records and 3,585 pending
tracker tickets at `2026-10-04T04:14:30.165Z`. First post-cutover physical cloud
acceptance at `2026-10-04T09:17:13.707Z` verified revision 267: 691 actions,
1,319 instances, 804 original email rows and three daily/status rows. All 267
native receipts, machine hashes and formulas passed. All 690 saved human records
survived by stable Action ID; fresh readback confirmed the same cloud bytes at
`09:42:35.564Z` and saved human fields at `09:43:47.033Z`.

The native queue resumed RUNNING at `2026-10-04T09:57:43.847Z`, with readback at
`09:58:01.150Z`, through exactly one empty resume request. The original pause
journal, routing, rate limits and retry configuration remain unchanged. The
`10:00:56.037Z` backend read observed revision 268 and an active native writer;
that is not fresh physical acceptance of revision 268 or complete catch-up.
Outlook/backend capture reached approximately `09:54Z`, while their respective
published checkpoints remained `00:34:05.451Z` and `00:34:05.351Z`. Capture and
publication stay separate, and the existing outstanding-delivery scan remains
active. Those were incomplete gates at that dated checkpoint; the later accepted
publication and identity state is recorded below. Read the [validation handoff](docs/NOTIFICATION_PRODUCTION_VALIDATION.md)
and [partial receipt](deployment/NOTIFICATION_PRODUCTION_VALIDATION_20261003.json).

The later accepted **revision 365** has **789 actions, 3,228 occurrences, 2,384
original email rows and four daily/status rows**, with all **690 saved human
records** preserved. Backend evidence is dated **17:03:17.750 UTC**, physical cloud
acceptance **17:06:03.434 UTC**, human-field acceptance **17:09:07.313 UTC**, and
post-identity uniqueness **17:09:52.135 UTC**. Guarded mailbox identity activation
completed at **15:28:02.319 UTC**. All 3,228 occurrence sources were exact with zero
incomplete source authority; 187 recorded-actor rows retain unavailable Auth display
names, with 148 verified and 39 unverified email rows, while 3,041 unknown-actor
rows remain unknown. Outlook/backend capture and publication align through
**16:58:02.536/16:58:02.544 UTC**, without a claim about later arrivals.
Native publication, capture and recovery holds are restored. Final006 was refused
at **17:15:41.837 UTC** without apply, intent or send; overall acceptance remains
false and genuine Dylan-only delivery remains open.

Insights metadata at **16:58:29.159 UTC** supports 15 actual settled v4 rebuilds.
Seven current manifests remain stale, including six v2, and 428 player-parent
documents have no current manifest; 17 pending testing markers are ordinary
open/incomplete work. The full scoped **07:05–17:18 UTC** log review found 29 SDK
snapshot-clock warnings and no ERROR-or-higher records. This is scoped metadata
and log evidence, not all-account convergence, verified payloads, user outcomes or
incident resolution. No native release or dedicated assigned-coach lookup is added.

Dylan is the sole recipient of new application and workout emails. Both Google
Cloud fallback policies were On with Dylan alone at `08:38:52.808Z`; Nolan and
Taiyo's shared tracker editing access was confirmed at `08:00Z`. A fully paginated
Outlook review of all subjects/read states from `08:35Z` inclusive to `09:38:30Z`
exclusive found no messages; it does not establish delivery outside that interval.
Exact-UID reporter/contact is separate from target athlete and attempted action.
The 39 verified automated-service mail joins keep unknown operators unknown;
the older count of 34 described incomplete source-authority rows, not unknown or
pending contacts. Revision 365 has zero such incomplete rows; unknown contacts
and six historical target labels remain unconfirmed. Diagnostic/device records do not prove a crash.

Every captured occurrence is retained, with first/meaningful-change notices and
a daily summary of routine repeats once sending is accepted. Manual Excel
Status/Owner/Due/Fix notes stay attached to stable Action IDs and are never
automatically reopened or resolved. Excel-only Resolved does not authorize an
immediate recurrence email; admin Fixed/Verified recurrence requires recorded
transition evidence. Mail-only Google repeats retain individual email rows without
inventing backend instances or resolving human tasks. Ordinary successful workout
emails remain separate from the issue-only tracker. The canonical master is
**PoseTek → Technology → Website → User Issue Tracker → PoseTek Issue Tracker.xlsx**.
Cloud intake, recovery, email and native publication do not depend on this chat,
Codex, an hourly Codex procedure or Dylan's computer. Workout settings are
unchanged and workout delivery is unpaused. No historical Resend replay or
automated user outreach is included. Native device/crash acceptance and
uninstrumented coach-workflow limits remain explicit; a coach name in a workout
team label is not a dedicated assigned-coach lookup.

## Historical notification coverage correction (2026-10-02–03)

The preceding authenticated application was Netlify deployment
`6ac06e0d420f2b6b34129fb5`, from frozen source digest
`e7ad1aaa6b2b87b17b8c6885ea263e35170b86e95759e304bc3cdb8244876e88`.
Full provider inventory and served-content checks passed for 1,485 files,
preserving that release's marketing source, protected files and platform configuration.
Baseline adoption passed and protects 1,482 application/public files; its exact
verification result is in
[the correction receipt](deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json).
Do not infer it from a successful deployment badge.

Ten user-issue functions at version 8 and six tracker functions at version 5
passed exact source/configuration/IAM verification. Fourteen social endpoints
passed the same scoped checks with their differing original implementations,
runtime configuration and helper variants preserved. The website generates a
fresh diagnostic UUID for every supported social invocation, retaining the same
ID for SDK transport retries. Server-owned replay claims require compatible
known operation and authorized target evidence; reused IDs with conflicts remain
distinct. Both source observations retain provenance. Timings remain in raw
Cloud Logging, with no new workbook timing column. Diagnostic/service counts are
not unique-user counts, and generic diagnostic uploads do not prove a crash or
interrupted workout.

Dylan remains the sole alert recipient; Nolan and Taiyo retain editing access to
the shared tracker. Power Automate event intake and automatic cloud recovery
update it independently of this chat; Codex and Dylan's computer are not required
for ongoing capture, email delivery or workbook updates. Crashlytics Cloud
Logging export is On for the one registered iOS app, but genuine symbolicated
device export and owning-Mac/iPhone/TestFlight acceptance remain held. The new
Microsoft mailbox identity-conversion flow passed read-only semantic acceptance,
and all six tracker endpoints passed exact version-six source/configuration/IAM
checks. The additive identity settings transaction remained pending at that
checkpoint. Revision 266's next batch exceeded the existing document limit;
subsequent source repair and acceptance gates are recorded in the validation
handoff above. Read
[that verification checkpoint](deployment/OUTLOOK_IDENTITY_AUTOMATION_PROGRESS.json)
and preserve every historical email row and unconfirmed alias. No automatic outreach,
historical Resend replay, native release or training-rule change is included.
Read [the correction handoff](docs/NOTIFICATION_COVERAGE_CORRECTION.md) for current
contracts and limits; final workbook/source cutoffs come from its production
receipt. Preserve the earlier dated receipts and results below.

## Historical Dylan-only notifications, outreach contacts and tracker recovery (2026-10-02)

Dylan now requires only `dylank@posetek.net` to receive new issue, status,
daily-summary and workout notifications. Both separate PoseTek Google Cloud
notification policies were verified with Dylan alone. Nolan and Taiyo retain
their editing access to the existing shared tracker; their email removal does
not revoke workbook or mailbox permissions. No additional purchase, automated
user outreach, historical Resend replay, website or native release is authorized
by this refinement.

The scoped source/configuration checks verified ten user-issue functions at
version 5, three Microsoft email functions at version 2 and six tracker functions
at version 2, preserving existing IAM, schedules and unrelated resources. Dispatch
and the transactional send claim check Dylan-only effective recipients before
authorizing a send. Original payloads, consumed claims and recipient receipts
remain historical evidence. The explicitly approved recent unclaimed Microsoft
recovery window is `2026-10-02T20:32:00.000Z` inclusive through
`2026-10-02T21:16:12.577Z` exclusive; an audited amendment never erases the original
envelope or evidence of a consumed permission.

Exact-UID Auth enrichment covered 101 occurrences across seven recorded accounts:
three had verified email addresses and four had unverified addresses. Their Auth
records supplied no display names. At the fixed initial review, 995 service/anonymous
occurrences lacked a recorded Auth UID and remained unknown; no athlete, recipient
or device is substituted as the actor. Historical occurrence-token identity and
current outreach contact are separate. Failed lookups preserve last-known evidence while marking the current
contact unavailable. Only counts and methodology belong in this public handoff.

Fresh cloud verification matched the saved revision-87 native receipt to the exact
frozen backend batch. Its acknowledgement was reconciled without rewriting Excel
or regenerating that batch. The first ordinary retry then returned revision 88.
All eleven approved recent Microsoft amendments delivered to Dylan alone,
preserving their original payload hashes and frozen claim digests. Their separate
identity fields describe nine diagnostic upload messages and two service failures
with unknown operators. A fixed-cutoff Outlook review from 21:57 through 22:20 UTC
found sixteen post-change messages addressed only to Dylan, with no CC or BCC.
Final fresh physical cloud acceptance verifies revision 121: 289 actions, 1,104
instances, 402 email rows and two daily records. The fixed `23:32:01.540Z` queue audit
had zero pending tickets. All 180 saved
human records, 882 historical links, formulas and the full 121-receipt chain passed.
Independent revision-121 identity acceptance verified all 101 contact annotations
(77 historical and 24 newer) against exact-account evidence and physically joined
the eleven delivered amendments through verified Internet-Message-IDs. Diagnostic
uploads and staff actions targeting a different athlete passed separate checks.
Nolan and Taiyo's **Can edit** access was freshly confirmed at 23:24 UTC, and the
revised team guide passed fresh cloud readback.

Guarded recovery reconciled 141 lagging existing publication windows in eight
transactions, preserving capture fields and making no Excel, Flow, email or seed
changes. Both sources completed and published all 159 windows through their fixed
October 2 cutoff at 4:28 PM PDT: Outlook through `2026-10-02T23:28:04.127Z` and
backend through `2026-10-02T23:28:04.120Z`. A later `23:34:18.201Z` readback found two
newly queued arrival tickets. The normal native queue resumed **RUNNING**, verified
at 23:36 UTC with unchanged configuration. These checkpoints cover the verified
intervals; they do not establish coverage of later arrivals or completion of the
independent outstanding-delivery scan. Use the
[refinement receipt](deployment/NOTIFICATION_REFINEMENT_PRODUCTION.json) for those
operational outcomes and exact coverage, and
[the refinement handoff](docs/NOTIFICATION_OUTREACH_REFINEMENT.md) for the contract.
The Codex updater has been removed; native cloud batches are the sole
writer for the shared master. Preserve the historical receipts below as records
of their earlier verification times.

## Historical Microsoft migration and initial tracker activation (2026-10-02)

Dylan reported purchasing Power Automate Premium and authorized setup. One
available Premium license is now assigned to dylank@posetek.net, and the existing
writer saves without the former licensing block. It is On,
Automated, owned by Dylan, with ID b011912f-bb15-453f-92ef-761d223095b4, now targeting
the verified shared master after private-fixture acceptance. Its trigger permits only the newly created
dedicated service principal. Existing Excel and Outlook connections are confirmed.
The shared mailbox alerts@posetek.net exists. Following Dylan's explicit approval,
his Send As permission was read back at 2026-10-02T05:29:31.9389018Z. His existing
Full Access, Nolan's Send As and the sent-copy settings were unchanged. No email
was sent by that permission step; the separately approved setup pilot below
passed send and recipient-delivery acceptance. No additional subscription was
purchased by the agent.

Eleven fixed credential/callback/ingress secrets were installed and read back as
Secret Manager version 1. Both reviewed flow endpoints are now installed as
version 1; all five Microsoft email runtime grants passed exact readback.
A bounded live message-trace query returned HTTP 200 with zero
matches, proving query access only, not email delivery. Dylan-only mailbox RBAC
is not verified: organization customization completed and `IsDehydrated` is false,
but `New-ManagementScope` still returned its prerequisite error in a fresh
authenticated session. The contradictory Microsoft failure has no confirmed cause;
do not substitute tenant-wide Mail.Read. A dedicated GET-only reader using Dylan's
existing Outlook connection is imported as `950eee98-d71a-48b8-b0b3-5fa5f2bd3c31`,
with separate delegated-provider proof gates. The first package was rejected for
unsupported Parse JSON Secure Outputs. V2 imported with supported action-specific
privacy settings and read the known Inbox item with full body/headers/folder/read
state, after rejecting unauthenticated and other-mailbox routes. Its first
collection page then failed before connector access: `substring` rejected an
index equal to path length. V3 changes only the message-ID tail to `slice` and the
ID-character scan to include an allowed sentinel, retaining the exact original
URL, caller, fixed GET and privacy policy. The existing flow was edited while Off;
its actual saved export passed validation at `2026-10-02T08:45:14Z`. The validator
permits only the two observed branch-entry omissions of empty `runAfter` alongside
editor metadata; all real dependencies stay exact. Read-only v3 acceptance passed
at `2026-10-02T09:12:05.266Z`: 72 pages and 143 mailbox messages, with replay of all
128 then-recorded legacy ID aliases through the connector. The dated receipt
described these as immutable-ID aliases; later review found that connector echo
and ignored preferences do not prove authoritative Graph ID types or canonical
same-item aliases. The private audit retained 206 original responses.
One unrelated message omitted headers; relevant messages,
the Inbox reference, all legacy items and replay retained strict header checks.
This verifies the delegated reader, not application RBAC or tracker publication.
Failed v2/v3 attempts remain alongside the successful fresh acceptance receipt.
At the initial migration, the email flow was imported and On after Dylan manually uploaded its ZIP. All four
email backend scopes passed exact deployed-source verification, preserving every
existing function IAM policy and schedule. Its approved one-message setup pilot
passed send acceptance, Exchange delivery evidence for all three recipients and
duplicate suppression. The isolated pilot finished with its terminal evidence
retained. Both production alert domains now select Microsoft; activation readback
passed at `2026-10-02T06:53:00.665Z`, preserving original domain intake cutoffs and
all other fields. Its full transaction census retained 489 pending historical
Resend issue jobs without rerouting or replay. See
[the release receipt](deployment/MICROSOFT_EMAIL_PRODUCTION.json).
The Outlook arrival flow was observed On at `2026-10-02T10:14:04.924Z`; its saved
definition and native checker passed earlier verification. The isolated six-function tracker deployment passed actual
source/configuration verification at `2026-10-02T09:37:27Z`, with settings still
disabled. All six are ACTIVE version 1; existing functions, IAM, schedules,
settings, rules and secret policies were preserved. A CLI empty-queue-policy
error was resolved through actual private-policy readback, without redeployment
or added IAM grants. Shared-master configuration and native readiness are now
verified. Backend settings were atomically enabled at `2026-10-02T10:13:41.205Z`.
Independent cloud revision-eight publication passed at `2026-10-02T10:53:58.855Z`:
70 actions, 684 instances, 160 emails and one daily record, preserving all 882
original links, 23 human records, machine hashes, formulas and eight native receipts.
Both temporary queue holds were restored to RUNNING. The audit still had 490
pending tickets: Outlook publication reached `10:21:03.004Z`, while backend
publication remained `04:56:51.854Z`; both captures reached approximately 10:46 UTC.
Complete catch-up is not claimed. The A4 label now truthfully identifies the
static imported baseline; independent cloud comparison proved only that cell
changed. The exact setup pilot classification was acknowledged
through the normal writer at revision seven and is included in the verified
revision-eight workbook. Read
[the production receipt](deployment/ISSUE_TRACKER_EVENT_PRODUCTION.json).
Independent correction readback also preserved all 63 then-current human records
and 1,031 prior links. The updated team guide was published and its fresh cloud
download verified at `2026-10-02T10:57:04.711Z`; the shared folder contains only
that guide and the workbook.

The initial migration selected Microsoft 365 through Power Automate for new
notification types, retaining the then-approved recipient sets and existing alert
history. The later Dylan-only refinement above supersedes those recipient sets.
A durable one-time claim prevents an uncertain send from being blindly
replayed. Send acceptance and recipient-level Exchange trace evidence remain
separate. Previously attempted Resend jobs retain their provider and history.
At migration activation, the Microsoft sender and trace gates were enabled for new alerts after the
reviewed creation cutoff `2026-10-02T06:52:17.518Z`. No billing subscription was
changed; the Resend key/webhook remain for preserved historical jobs and receipts.

Tracker capture is independent of email delivery. The deployed recovery includes
fully paged whole-mailbox reads, separate capture/publication checkpoints, direct
backend occurrences and repeated scans of historical delivery jobs. Native
acceptance against a private fixture matching 23 actions, 560 instances and 128
emails found and fixed Excel timestamp rounding and a synthetic hyperlink overlap
edge case. Native append, exact recovery and ordinary updates now pass: an
ordinary update took 17.5 seconds, with a 1.2-second exact replay. Those initial
browser tests did not establish Power Automate transport or shared-master acceptance.
The fresh read-only native preflight at 2026-10-02T04:20:06.051Z verified ready
revision five with no pending batch, 23 actions/561 instances/131 emails/one daily
row, all 23 human-field records, 716 source rows, 858 links, formulas and footer.
Actual Power Automate transport now passes: two calls of the identical frozen
batch returned exact verified revision-six receipts with unchanged counts. The
OAuth resource's trailing slash and canonical polling route were corrected while
retaining the original batch and prior attempts. A revision-six native readback
also verified the same human fields, 858 links, formulas and footer. The final
post-replay inspection at 2026-10-02T04:51:56.787Z confirmed those preserved values
and ready revision six with no pending batch. This is private-fixture acceptance,
not shared-master publication or email delivery.
Concurrency one, bounded asynchronous receipt polling and exact replay remain
required. See [native acceptance](scripts/issue-tracker/NATIVE_ACCEPTANCE.md).

The earlier cloud/local workbook discrepancy was resolved. The pre-migration
shared publication had 598 instances, 128 emails and 23 actions, with both source cutoffs at
2026-10-02T04:56:51.854Z. Its pre-migration workbook SHA-256 was
c9bf937b4cd1507d9f376bc861d0cb3779443b6a522e190ac48fb79c68f69d19.
No unfinished hourly candidate remained at that pre-migration checkpoint.
Do not resurrect an older unpublished candidate or overwrite the native master.
The read-only native master inspection at `2026-10-02T09:13:35.555Z` verified
those counts, all 23 human-field records and 882 source links. A fresh cloud
backup passed full source, human-field and footer comparison at
`2026-10-02T09:16:14.457Z`. Its workbook container hash differs after native
inspection, while the publication basis remained unchanged. The actual master
was then initialized and made ready at revision zero. The disabled backend seed import verified
all 750 rows (23 actions, 598 instances, 128 emails and one daily record).
That revision-zero cloud workbook, verified at `2026-10-02T10:08:45.472Z`, preserved those
rows, all 23 human-field records, 882 source links, formulas and archived footer;
its SHA-256 is `35adfc8c39bebea2374d837a6816a771daf2af5731e19c87e78c3f274de1a2d0`.
The local synced master matched those bytes at `2026-10-02T10:11:51.851Z`, without
a local overwrite. The read-only verifier accepts only the three exact XML
current-row formula serializations; the native writer checks remain unchanged.

The saved writer export passed strict retarget validation while Off at
`2026-10-02T09:58:29.972Z`; only the workbook target changed from the accepted
fixture. A fresh cloud download of its selected upsert script passed exact body
and parameter checks at `2026-10-02T10:05:29.479Z`, matching current source and
accepted fixture SHA `7cb0931b09cc8856efdf1f5042e088b2c4bc9d2282a203c943defd79ba4b5f28`.
The writer was observed On at `2026-10-02T10:09:59.421Z`. The guarded backend
activation passed at `2026-10-02T10:13:41.205Z`, followed by the first genuine
native batch at revision one. Subsequent independent shared-master readback
verified revision eight at `2026-10-02T10:53:58.855Z`, as recorded above. Never run
the old whole-file renderer or reinitialize this native master. New source coverage
must come from verified native batch and publication receipts.

At Dylan's explicit request, the old Codex tracker procedure was removed.
Power Automate and the existing backend provide ongoing cloud operation;
earlier instructions to run a desktop updater are superseded. The production email route uses Microsoft for new
alerts, and the replacement tracker is active with independent revision-eight
publication verified. Catch-up continues from each source's verified publication
cutoff; complete publication is not claimed. Never run both workbook writers
against the master. Read
[ISSUE_TRACKER_EVENT_FLOW.md](docs/ISSUE_TRACKER_EVENT_FLOW.md),
[the tracker package](deployments/issue-tracker/README.md) and
[the Microsoft email package](deployments/microsoft-email/README.md).
This backend and automation release did not change website bytes or training/planner records.

## Historical shared user-issue recipients (2026-10-01; superseded)

The user approved Nolan (`nolanj@posetek.net`) and Taiyo (`taiyow@posetek.net`)
alongside Dylan for ongoing issue/status/daily-summary emails and the independent
Google Cloud alert policy. That rollout made new issue messages include all three;
old frozen Dylan-only messages retained their destination and idempotency keys.
Signed callbacks recorded each recipient separately and required all three
delivery confirmations before that aggregate job was called Delivered. Those
historical consumed envelopes still retain their individual evidence after the
October 2 recipient restriction. Workout outcome/inactivity recipients
remain unchanged. See [the recipient rollout receipt](deployment/USER_ISSUE_RECIPIENTS_PRODUCTION.json).
This is a backend/configuration-only follow-up; the website release below is unchanged.
The inspected October 1 failed-email record confirmed Resend daily quota
exhaustion. Later partial recovery does not establish delivery to every new
recipient; check each recipient's current evidence. No paid Resend plan, quota
override or historical replay was performed.

## Reliable personal workouts (2026-10-01, live)

Guided player Training is live as deployment `6abeaf5702a9c9983c7a41b9`, source
`8956871d0ece5bf7c43e9830df60ab072eb3bd64`, published October 1 at 12:18:33 PM PDT.
Focus, location, time, conditional age and readiness replace the equipment
checklist. Visible location defaults have compact exceptions; available times
come from code-only assessment. Conversations, AI revisions, explicit publishing
and tracked workouts remain connected. The reviewed catalog can still leave some
age/setup combinations unavailable; offer adjustments without granting held drills.

The shared gateway is `agent-gateway-sha-a63f1b0b7e5d`, built and tested from
canonical backend main and promoted through its release script. Private admin
evidence now falls back to immutable JSON artifacts for unsupported Firestore
structures as well as excessive size. Admin and player age readers agree; an
explicit confirmation can refresh the same observed age without inventing a DOB.
Catalog `1.0.93` makes only STR-005, STR-006, STR-008, STR-501 and STR-502 mat
optional. All 80 held drafts, media, doses, review states and native gates remain.

The availability follow-up separates completed empty assessments from loading
and retryable errors; a bounded check retains its accepted job identity for
recovery. Completed testing and active plans are not prerequisites. Live
synthetic acceptance created a 30-minute Speed/Agility draft without either.
The reported age-21 gap comes from authored catalog bounds: 53 of 54 published
personal-session drills end at age 19 or younger; STR-501 covers Strength at
ages 9–25. Current bounds remain enforced. These limits do not establish clinical
unsuitability; adult coverage needs a separate content/age-envelope update.
The reconciled baseline protects 1,438 application/public files. All 1,440
artifact files match production inventory; the 52 existing processed HTML files
retain only their previously verified transformations. The ordinary preservation
build passed against this new baseline.

The release preserves already-live issue-alert source `e8de8d7` and predecessor
deployment `6abd8f957e046e8059376091`, including approved Players/Coaches marketing
bytes. Read [the handoff](docs/RELIABLE_PLAYER_WORKOUTS.md),
[the availability receipt](deployment/WORKOUT_AVAILABILITY_PRODUCTION.json), and
[the initial production receipt](deployment/RELIABLE_PLAYER_WORKOUTS_PRODUCTION.json)
before another application, gateway, rules or catalog release. The existing Coach
proxy allows production origins and rejects Netlify preview origins; exercise the
actual Coach handoff on Posetek.net rather than widening that allowlist.

## User issue alerts (2026-09-30)

The user approved a separate crash/bug notification workflow to `dylank@posetek.net`,
with a report form, private admin inbox, per-user incident emails, status changes
and a 9 AM Pacific summary. Website and backend alerts are live as deployment `6abd8f957e046e8059376091`,
source `e8de8d7`, published 9/30/2026, 3:41:20 PM PDT. All-user intake and delivery
were enabled at 2026-09-30T22:42:51.312Z. Eight synthetic emails received signed
delivery confirmations; test accounts and issue fixtures were removed. The baseline
protects 1387 files; all 1389 artifact files match production.
Players and Coaches marketing bytes are unchanged. See
[the production receipt](deployment/USER_ISSUE_ALERTS_PRODUCTION.json). Read [USER_ISSUE_ALERTS.md](docs/USER_ISSUE_ALERTS.md) and
[the scoped release guide](deployments/user-issues/README.md). The native source
candidate is separate and unverified on Mac/iPhone/TestFlight. Crashlytics export
has not yet been verified; a synthetic adapter test is not device acceptance.

## Coach percentile presentation (2026-09-29, live)

Coach percentile presentation is live as deployment `6abb9f1e6c2c84772de67005`, source
`684528b`, published September 29, 2026 at 4:25:34 AM PDT. The card pairs a compact
radar with readable skill positions, measured-player counts and concise scale
explanations. Phone layouts show skill positions first. Scoring and access are
unchanged. All 1,342 artifact files match production inventory; the baseline
protects 1,340 application/public files. See
[the presentation release receipt](deployment/COACH_COMPARISON_POLISH_PRODUCTION.json)
and [PR #14](https://github.com/posetek/posetek_website/pull/14).

Verification passed 79 Insights tests, 30 release guards and 28 synthetic browser
layout/state checks across four widths. Candidate and production artifact, route
and signed-out entry checks passed. No production records or accounts were
created. The ordinary preservation build matched the published artifact.

## Unified coach workspace and Astro migration (2026-09-29)

The user approved Team Insights as the single coach workspace, including
organization and independent coaches. Overview owns the roster; Testing,
Workouts, Active use, Community and one named player tab share its shell. Player
comparisons use measured team/roster percentiles and recorded age, with explicit
missing-data states. Existing plans, workout history, published personal workouts,
signup actions and planner paths remain connected. Canonical staff permissions
and social audiences remain authoritative.

The user also selected the full-site Astro migration and supplied Astra frontend
design guidance. Astro builds Players, Coaches and the application documents,
retaining React interactions, Svelte demonstrations and the protected public
assets. See [the implementation handoff](docs/UNIFIED_COACH_WORKSPACE.md) and
[the API contract](docs/insights/COACH_WORKSPACE_CONTRACT.md). The scoped Insights
release contains nine functions; no gateway, rules, native or catalog release is
included. Website source `3e41c2a6c2bc8beba3b0829091a96d441ad0e15c` was published
as `6abb9834af8b9c320f64df04` on September 29 at 3:55:40 AM PDT by promoting
the exact reviewed draft. All 1,337 artifact files match the production inventory;
the reconciled baseline protects 1,335 application/public files. The ordinary
preservation build and 30 release guards passed. Hosted coach acceptance passed
73 checks; production passed 12 coach, 16 athlete/manager/admin, and two compiled
entry checks. See `deployment/UNIFIED_COACH_WORKSPACE_PRODUCTION.json` for backend,
served-HTML processing, cleanup and recovery evidence.

The previously deployed workout-alert source branch was merged before this work,
preserving the September 28 live functionality that had not yet reached main.
The following section records that predecessor production state.

## Workout email alerts (2026-09-28, live)

All-player workout alerts are enabled from September 28, 2026 at 4:06:30 PM PDT
(`activatedAtMillis: 1790636790868`), with no historical backfill or pilot allowlist.
Resend sends saved workout outcomes to `dylank@posetek.net` from
`PoseTek Workouts <workouts@alerts.posetek.net>`. Website sessions also qualify for
one inactivity notice after 30 minutes without meaningful activity, processed by
a five-minute sweep. Native coverage uses existing saved endings; native-only
inactivity is not inferred. Emails include recorded progress, time and a protected
link to the exact workout history, where administrators can inspect delivery status.

Website source `d814225368976c97e8184eabb8953779d139bc1c` was published as deployment
`6abadd8abff0a78fde2fbe28` at 3:56:54 PM PDT by promoting the reviewed draft without
rebuilding. All 1,239 artifact files match the candidate; the reconciled baseline
protects 1,207 application/public files (125,432,039 bytes). The ordinary
preservation build, 22 release checks, 30 production routes and all 1,049 JS/CSS
assets passed. All 32 approved marketing files remain unchanged.

All seven scoped Firebase functions and the scheduler are live and audited.
The verified Resend domain uses one DKIM TXT, two DNS-only CNAMEs and a
subdomain-only initial DMARC policy; root mail records remain unchanged. The
sending-only key is domain restricted and both secrets use Secret Manager.
Three synthetic emails received signed delivery receipts; the post-DMARC quiet
message was also confirmed in Outlook Inbox. The first two messages have provider
delivery evidence only. Natural quiet timing, resume cancellation, exact protected
links and sign-in return passed. Synthetic cleanup and final quiescence checks
passed before global activation. A bounded post-activation audit found exact
settings, no synthetic roots and zero sampled new jobs or activity; this is not
a claim of real-player usage or a complete historical scan.

Read the [production receipt](deployment/WORKOUT_NOTIFICATIONS_PRODUCTION.json),
[notification handoff](docs/WORKOUT_NOTIFICATIONS.md) and
[scoped release guide](deployments/workout-notifications/README.md).
The implementation preserves existing workout logs, canonical rules, gateway,
native source, training catalog and the false whole-body mobile acceptance gate.
Changes are shared in [PR #11](https://github.com/posetek/posetek_website/pull/11).
The following sections record preceding releases.

## Email-free staff and administrator access (2026-09-26)

Website deployment `6ab8679ccbfca079f8997124`, from source
`f9f10e0b69adcf3f5ed7e5742470a9a698ccd2d5`, was published September 26, 2026 at
5:50:52 PM PDT. The exact reviewed draft was promoted without rebuilding. All
1,177 artifact files match the candidate; the reconciled baseline protects 1,145
application/public files (121,839,203 bytes). Production route/asset verification,
role-routing browser checks and the ordinary preservation build passed.

Organization managers and PoseTek admins share private staff activation links.
New recipients choose a password; existing recipients sign in as the bound account.
Coaches receive only their assigned teams, and organization admins their current
organization. PoseTek admins use **Account access** in their account menu for
trusted internal-admin activation and assisted password recovery. These flows send
no email. Ordinary staff setup never verifies email; internal-admin authority keeps
the existing verified exact-domain predicate and adds explicit trusted attestation.
Player signup and the independent/legacy coach paths remain separate.

Eleven scoped Firebase functions are live from source `026e2a0`. Website validation
passed 1,278 tests, TypeScript, 22 release checks, 370 backend tests (three existing
skips), 73 admin/access rules checks and 251 social rules checks. Live API and browser
acceptance covered activation, replacement, recovery, all three staff roles,
assigned-team boundaries and zero email-send requests. Responsive review covered
360/390/430px and desktop. Seven temporary Auth accounts and all run-owned records
were removed; cleanup readback includes every asynchronous deletion tombstone.
Rules, gateway, training catalog and native UI were unchanged by this adjustment.
Read [the production receipt](deployment/EMAIL_FREE_ACCOUNT_ACCESS_PRODUCTION.json)
and [the implementation and operations handoff](docs/EMAIL_FREE_ACCOUNT_ACCESS.md).

## Confirmed training setup and account entry (2026-09-26, preceding release)

Website deployment `6ab788d1c138322f8f9b9911`, from source
`e571df38b80f524da4dd547a9d82fe906d10aaa9`, was published September 26, 2026 at
2:55:16 AM PDT. All 1,110 artifact files match the reviewed candidate; the
reconciled baseline protects 1,078 application/public files (118,178,840 bytes).
Production artifact/browser verification and the ordinary preservation build passed.

The release adds a confirmed equipment/space/people setup before personal AI
creation and a current-access check at personal Start/Resume. All 28 equipment
tokens are represented across five setup tabs. A changed setup requires a revised
AI draft before publication. Private conversations, exact proposal publication,
assigned-workout boundaries and existing allowances remain intact. The final
gateway `agent-gateway-sha-dac82d119dc7` replaces unavailable baseline drills without
loosening eligibility and avoids repeated empty domain searches. Canonical rules
and all 54 source-bound catalog maps are live in catalog version `1.0.92`; all
208 catalog records, 80 unpublished drafts and the false mobile acceptance gate
remain preserved.

Account entry distinguishes player activation, invited coaches/organization
admins, independent coaches and legacy organization-code signup. Privileged
access remains server assigned; no public administrator role is introduced.
Read [the production receipt](deployment/CONFIRMED_TRAINING_ACCESS_PRODUCTION.json),
[the training handoff](docs/CONFIRMED_TRAINING_ACCESS.md),
[catalog requirements and guarded publisher](docs/TRAINING_ACCESS_CATALOG.md)
and [account-entry workflow](docs/ACCOUNT_ENTRY_WORKFLOW.md).

Live acceptance passed 13 workflow stages, 15 checks and four staff-invitation
checks. Browser acceptance covered AI revision and refresh recovery, explicit
republication, Start, Community pause/return, current-access Resume and a truthful
partial finish. The assigned coach's history showed the same saved revision and
reported set, while retaining private-conversation boundaries. Checks covered
360/390/430px and desktop, plus production sign-in, setup and Community readback.
Validation includes 1,211 website tests, 95 final account tests, 2,003 exact-image
gateway tests, 1,055 canonical emulator tests and 55 deployed rules checks.
Run-scoped cleanup removed three temporary accounts, 244 documents and ten storage
objects. Independent readback found zero remaining accounts, documents or objects,
including nested messages; a final catalog/configuration check preserved all
source-bound maps, unrelated fields, media/reviews and the whole-body hold.
The following sections remain historical records of earlier releases.

## Conversational workouts and Community (2026-09-26)

Website deployment `6ab76982d74a19707a6f9d9a`, from source
`9b15c40a9a7f176ad333708099a73a7af8f7233f`, passed artifact and authenticated UI
acceptance and was published September 26, 2026 at 12:31:38 AM PDT. All 1,048
artifact files match the verified candidate; the reconciled baseline protects
1,016 application/public files (114,556,878 bytes). Production browser verification,
the ordinary preservation guard and synthetic verification cleanup passed. An
independent scoped readback found zero remaining verification accounts, documents
or storage objects, including orphaned conversation messages. The final gateway
`agent-gateway-sha-9639e76f5e3a` and canonical creator-private rules are live.
Read the [release receipt](deployment/CONVERSATIONAL_WORKOUTS_PRODUCTION.json),
[workout and Community handoff](docs/CONVERSATIONAL_WORKOUTS.md),
[design acceptance](docs/AI_WORKOUT_FLOW_DESIGN.md) and
[coach workflow](docs/COACH_WORKFLOW.md).

AI Coach creates an actual checked proposal and hands its private conversation to
Training. Athletes request changes through conversation, then explicitly publish
to Personal workouts; manual drill/dose controls are removed from the website.
Published unstarted workouts keep their saved identity when republished. Started
workouts use a new personal copy, preserving the original log. Coaches retain
authorized access to published workouts and progress; private proposals and
conversation messages remain athlete-only. Administrators retain existing oversight.

All seven live API stages passed, including concurrent publish equality, session
start/stop, started-copy preservation and access boundaries. Candidate UI
acceptance covered generation, conversational rename, immediate publication,
Community/Training pause recovery and finishing a saved workout. Validation passed
1,156 website tests, TypeScript, 22 release checks and 1,902 exact-image gateway
tests; canonical rules passed 1,053 emulator tests and 55 deployed checks.

AI configuration and allowances remain unchanged; all 208 catalog records remain
present and the whole-body mobile acceptance flag remains false. No physical
phone-lock or native acceptance is claimed. The submitted App Store build and
uncompiled native candidate are unchanged. No real athlete training, account,
invitation or conversation writes were performed; a brief read-only primary-origin
signed-in check could emit ordinary page-view usage telemetry. Generation,
publication, progress and cleanup verification use synthetic accounts.

## Prior player and coach release (2026-09-25)

This historical release introduced the player and coach experience, including
manual and AI personal-workout creation, from source `587c5b5`. Deployment
`6ab723a4b245cdd9426dc47a` was the verified draft promoted without rebuilding;
its baseline protected 957 application/public files. The September 26 release
above supersedes that manual athlete workflow with conversational creation and
explicit publication. Read the [historical production receipt](deployment/PLAYER_COACH_EXPERIENCE_PRODUCTION.json),
[implementation handoff](docs/PLAYER_COACH_EXPERIENCE.md) and
[coach workflow](docs/COACH_WORKFLOW.md).

Personal capabilities, canonical rules, the gateway and scoped Insights functions are live. The user explicitly authorized web release independently of native UI acceptance. The submitted App Store build is unchanged; native candidate `bc492aa` remains uncompiled/unreleased. This does not change the separate false whole-body mobile acceptance gate or approve any of the 80 unpublished drills.

Gateway source is only `Services/agent-gateway` in the backend repository;
GitHub now redirects `Athelytics/python-video-processor` to
`posetek/posetek-backend`. GitHub also redirects `athelyticsOG/posetek-mobile-app`
to `posetek/posetek-mobile-app`. Rules are only in `PoseTek-mobile-app/firebase/`.
Their respective canonical release commands in `AGENTS.md` remain binding.
The required shared website remote `dk242/posetek_website` now redirects to
`posetek/posetek_website`, confirmed when this candidate branch was pushed.

## Station recovery and ending follow-up (2026-09-22, not deployed)

End session now supports authorized early closure with lease revocation, transactional live-status
checks and preserved late uploads. Station recovery/calibration changes are mobile-only apart from
the end-session functions and live-status rule. Backend51 tests and website25/mobile9 rules checks
pass; mobile59 focused tests pass. See [the release command and verification handoff](docs/STATION_RECOVERY_AND_ENDING.md).
This supersedes earlier readiness-only closure, not the recorded production baseline.

## Testing station follow-up (2026-09-22, not deployed)

The mobile station follow-up adds live athlete enrollment at Station 1 and voice-guided rep/drill
progression. The server companion is code complete on `station-live-enrollment`: retry-safe
`addTestingParticipant`, pending-admission check-in protection, and start/close roster consistency.
47 focused server tests, 22 website rule assertions and 8 canonical station-rule tests pass;
mobile physical-device verification remains outstanding. See [the exact contract, validation and release handoff](docs/STATION_LIVE_ENROLLMENT.md).
This source change does not update the recorded production baseline below.

## Readiness and source provenance

### September 22 filming demo references

All 80 whole-body drafts now have external filming references: 81 links grouped
into the same four weeks. Admin drill details display **Watch before filming**
above the three original-video slots. Links carry source attribution, matching
notes, component adaptations and accurate verification limits. Most checks use
publisher pages/descriptions/transcripts; they do not claim a full technique review.
The portable guide is `content/training-expansion/DEMO_REFERENCES.md`.

Website deployment `6ab25ae36de88d184cc9b2e1` was published September 22 at
3:48:45 AM PDT. The references were added only to private authoring metadata with
revision checks; all 208 catalog records, media and review states were preserved.
Catalog version remains `1.0.91`; every new exercise remains a draft. Gateway,
functions, access rules and the false mobile acceptance gate were not changed.
Read `deployment/DRILL_DEMO_REFERENCES_PRODUCTION.json` for the verified receipt.

### September 21 whole-body training expansion

The approved implementation adds 80 entirely new exercise drafts for ages 10–18:
28 strength, 12 isometric, 16 plyometric, 12 speed/change-of-direction and 12 ball
packages, filmed as 20 three-clip packages per week from September 21 to October 18.
Read [the whole-body handoff](docs/WHOLE_BODY_TRAINING.md) and
[`content/training-expansion/README.md`](content/training-expansion/README.md).
The six measured tests guide performance priorities; they do not diagnose muscle
weakness or determine an external weight. Current qualified review, actual equipment,
experience, supervision and the full outside schedule constrain expanded training.
No exercise, video, reviewer qualification or player readiness is auto-approved.
The mobile compatibility gate stays false pending Taiyo's device acceptance.

The release is live and verified. Website deployment `6ab1e8b84adb5788815542e4`
was published September 21 at 7:54:47 PM PDT; gateway revision
`agent-gateway-web-64db60701c6e` serves all traffic after 1,488 container tests
passed (six private-history tests skipped). Catalog version `1.0.91` contains
the 80 new unpublished drafts and preserves all 128 prior records. All 34 observed
active plans remain unchanged. The reconciled baseline protects 673 application
files; approved Players and Coaches marketing bytes remain exact. Read
`deployment/WHOLE_BODY_TRAINING_PRODUCTION.json` for the verified receipt and
`content/training-expansion/production-id-map.json` for actual catalog IDs.
Nine new training callables and their access rules are deployed. No reviewers,
player clearances, video approvals or publications were created. Activation and
workout starts involving any of the new 80 exercises remain held until mobile
acceptance; ordinary existing plans retain their current behavior.
Its rules were re-expressed in the canonical `PoseTek-mobile-app/firebase/`
rules (2026-09-23/24); this repo no longer holds or publishes rules. Preserve existing
plans, logs, all prior catalog content and approved marketing bytes.

### September 21 Draft B video planning

Local `main` was fast-forwarded to GitHub `main` at
`62aa39791bb03293b0e6159142d75f9623ef4505`; the recent source is available in the
shared repository. A scoped check of the live home/Coaches pages and eight directly
referenced marketing assets found no relevant source/live drift. This did not
repeat a full application inventory or backend audit and did not deploy changes.

Dylan confirmed club directors and coaches as the primary audience for the
Draft B video revision. The proposed visual direction, timed storyboard, source
map and production approach are in
[the Draft B video plan](docs/DRAFT_B_VIDEO_PLAN_2026-09-21.md). The user subsequently
authorized building the video and emailing the finished result. Editable production
source and reproduction notes are in [`video/draft-b/`](video/draft-b/README.md).
The video uses source-grounded pose geometry, a single illustrative coach sample,
original high-resolution Figure-8 footage, local neural narration and an original
score. Private reference media and delivery links stay outside Git; sample
players/results remain illustrative.

### September 21 Draft B V2 implementation

The user approved and received a 55-second revision for club directors and coaches.
Six recorded test demonstrations play together before their containers form. The
club overview leads into a U13 roster and Alex's focus; the guided session shows
elapsed time, set completion and a transition from Figure-8 to Wall pass rhythm.
Live admin and native app references informed the visual behavior; all pictured
club/player data is illustrative. V1 is preserved. See
[`video/draft-b/PRODUCTION_V2.md`](video/draft-b/PRODUCTION_V2.md) for export,
validation and delivery records. This work did not deploy or change the website.

### September 17 website release: protected player signup links

Deployment `6aac924a597bd46f15cf468a` was published at https://posetek.net on
September 17, 2026 at 6:31:29 PM PDT (`2026-09-18T01:31:29.567Z`). Feature source
`c00b031c8a0011297f8357c1a6c028377b5c30e0` is on `codex/player-invitation-flow`.
The branch also preserves the concurrent gateway source and September 16 cohort
activation handoff. All 644 local files match production's 645-entry inventory;
the reconciled baseline protects 612 application/public files. The approved
Players and Coaches marketing bytes remain exact.

Staff can copy an existing signup link or generate a code only when missing.
The fragment link opens Player signup with its code filled in and removes the
code from the address bar. Signup retains the existing canonical player ID,
including the active training plan. Normal get/copy/issue actions preserve valid
codes. Five scoped invitation callables are deployed; the public validity check
uses private hashed-IP rate counters and returns no athlete identity.

Final readback at `2026-09-18T01:34:28.400Z` verified all 21 previously issued
codes unchanged and unclaimed. Production copy/prefill and signed-in account
guard behavior were checked. No real recipient account was created or redeemed,
and verification-email delivery was not exercised. Gateway, rules, video guards,
results, estimates, active plans and native source remain unchanged by this
release. Taiyo's Mac/iPhone/TestFlight acceptance remains outstanding. See
[the signup handoff](docs/PLAYER_INVITATION_LINKS.md) and
[production receipt](deployment/PLAYER_INVITATION_LINKS_PRODUCTION.json).

### Vacaville measurement recovery

The September 17 first pass repaired eleven failed September 16 attempts using
original recordings and audited revisions. The second pass corrected eight more
numerical results: four August change-of-direction times, one September 16
dribbling time and three broad jumps. A further mislabeled broad jump was
reclassified without a numeric result because its landing was not measurable.
Category migrations preserve the same rep IDs, recording dates and original
files, with explicit session and server-owned duplicate corrections. The user
confirmed the 5.875-inch black marker; the four first-pass jump repairs already
used that calibration and remain unchanged.

The first pass made no deployment changes. The second pass extended the existing
video processor's exact archive guard to 26 entries in verified revision
`onvideoupload-00025-vic`, with source unchanged. The later follow-up below expands
that map to 30 entries; preserve the full current map during later deployments.
The concurrent application/reader remediation has its
own release receipts and is not a website release performed by this data repair.
Twelve original failures and one newly identified incomplete broad jump still
require complete footage or retesting. See
[`docs/VACAVILLE_REP_RECOVERY.md`](docs/VACAVILLE_REP_RECOVERY.md) for evidence,
the **2026-09-17T21:08:20.691Z** final checkpoint, private evidence locations
and the expanded rollback boundary. Earlier release checkpoint totals below
remain records of their original observation.

### September 16 cohort: twelve active training plans

The user-authorized cohort rollout is complete. Final readback at
`2026-09-18T01:24:20.280434Z` confirmed exactly one reviewed active schema-3 plan
for each of twelve September 16 testers: two weeks, two solo sessions per week,
48 workouts total. Priorities were chosen automatically, with reviewed estimates
enabled. Seven
missing ages used the user-approved team-peer assumptions in plan intake only;
profiles and birthdays are unchanged. Existing recordings, estimates, workout
logs, historical drafts and the original four activations were preserved.
The existing signup claim links users to the same canonical player IDs where
the active plans are stored; this operation did not send invitations or claim
accounts. See [the rollout handoff](docs/SEP16_TRAINING_PLAN_ROLLOUT.md) and
[activation receipt](deployment/SEP16_TRAINING_PLANS_ACTIVATED.json). Historical
pilot receipts below retain their unactivated status at their original checkpoints.

### Current gateway follow-up: accurate workout descriptions

Gateway revision `agent-gateway-web-62c05fa8fbde` serves all traffic, verified at
`2026-09-18T01:13:01.386Z` (September 17, 6:13 PM PDT). Source commit
`903b4540f4eae37dd9e2fa944d08c00d62ef8a2c` is pushed on
`codex/evidence-linked-planner`. The backend-only fix lists actual domain minutes
as “Time allocation” and uses “jumping” for the generic plyometrics label. It
does not infer a lead from near-equal totals or claim landing technique from the
category name. Exercise selection, prescribed doses, ordering, checks and retry
policy are unchanged. All 19 synthetic comparisons preserved prescriptions;
18 authored replay tapes changed only their context fingerprints.

The immutable candidate completed its mandatory full test process successfully;
the final numerical test total was unavailable and is not inferred. Website
bytes, Firestore rules, planner configuration, IAM, the 32 archive guards,
effective-results reader and native schema remain unchanged by this release.
See [the follow-up receipt](deployment/PLANNER_INTENT_PRODUCTION.json) and
[methodology handoff](docs/PERSONALIZED_PLANNER_METHODOLOGY.md). The website
release and original pilot checkpoint below retain their historical facts.

### Previous website release: Evidence-linked personalized planner

Deployment `6aac7f6c315a6190c054fba7` was published to https://posetek.net on
September 17, 2026 at 5:35:06 PM PDT (`2026-09-18T00:35:06.349Z`). Application
source `8a1445708a46b37090dd658c8c631c16ae3fd69c`, gateway source
`5a2d62b3c18f197ca69041fc6821e6d45c258d5e` and request-rules source
`55d63d1e2e448ef871e46f4d0488fc23e66c74b2` are pushed on
`codex/evidence-linked-planner`. See the
[production receipt](deployment/EVIDENCE_PLANNER_PRODUCTION.json) and
[methodology handoff](docs/PERSONALIZED_PLANNER_METHODOLOGY.md).

The current admin planner and native schema-3 generation share server-qualified
evidence, bounded priorities, time allocation and reviewed exercise mappings.
All coaching goals may remain unchecked; up to two optional goals add emphasis.
Measured results, reviewed conditional estimates and general practice remain
distinct. Each exercise includes an explanation and progress check; primary
objectives require at least one reviewed relevant exercise. This does not imply
every exercise or every minute in that domain has a metric-specific link.
The web interface provides Evidence, Schedule, Review and Use plan steps.

At this release checkpoint, gateway revision `agent-gateway-web-e75e9318d15d`
served all traffic; the later gateway-only follow-up above supersedes it. The only rules
change permits optional boolean `useProvisionalEstimates` on personalized
assessment/generation; actor checks and activation/discard contracts are unchanged.
Native generation retains its existing active-plan behavior and daily limit of
one. Admin generation remains a draft until explicitly activated. Current mobile
readers use the existing exercise explanation; rich priority cards are web-only.
Installed-iPhone/TestFlight acceptance was not performed by this release.

One live two-week pilot draft passed saved-context, public projection and workout
checks with four workouts and 22 explained exercise entries. It remains ready and
unactivated. Existing reps, active plans, workout logs and schedules are unchanged.
Its 65- and 63-minute sessions include transitions and satisfy the inherited 10%
time tolerance; a requested 60 minutes is a target, not a strict ceiling. Some
supporting exercise selections remain explicitly labeled general practice.

All 592 local files match 593 production inventory entries. The reconciled
baseline protects 560 application/public files and preserves approved marketing
bytes. Validation includes 942 frontend tests, TypeScript, 353 rules assertions,
19 application-release/baseline checks, native contract checks and a successful
full candidate-container test process. Its final numerical pytest total was not
available and is not inferred. The 32 recording archive guards, effective-results
reader, four reviewed estimates, capability settings and repair journals remain
unchanged. Historical receipts below remain records of their original checkpoints.

### Previous release: Reviewed provisional Agility evidence

Deployment `6aac6cc0bfb1ddbe0a73e636` was published at https://posetek.net on
September 17, 2026 at 3:47:35 PM PDT (`2026-09-17T22:47:35.951Z`). Application
source `64b1dca569b43bad319fbc7c116d22717be9ad5b` is pushed on
`codex/provisional-dribbling-recovery`. See
[`deployment/PROVISIONAL_AGILITY_PRODUCTION.json`](deployment/PROVISIONAL_AGILITY_PRODUCTION.json)
and [`docs/PROVISIONAL_AGILITY_RECOVERY.md`](docs/PROVISIONAL_AGILITY_RECOVERY.md).

The capture owner confirmed that a Sprint-labeled recording was the no-ball
agility test. The same-ID classification correction preserves its date, all
31 original session objects and the genuine Sprint attempt. Twenty destination
objects plus two administrative revision before-images retain the reviewed and
original analysis. Unsupported Sprint and movement values are cleared, so the
incomplete recording removes one formerly qualified Sprint result. Its finish
remains unavailable as a measured Change of Direction result.

A separately reviewed conditional Agility estimate was appended to one existing
private document with its previous Dribbling entry and raw fields unchanged.
Both estimates can appear on the authenticated skill map and in optional
low-confidence planning context. They add no measured results, overall rating,
completion count, ranking, Insights value or shared result. Each is suppressed
only by a qualified result for its own drill. The reader is ACTIVE version 4;
post-publication measured responses match the checkpoint after classification.
The source-only update changed one helper and preserved 11 other packaged files,
all 57 checked function IAM policies, 56 other central function definitions and
rules. Preserve all 32 archive guards in `onvideoupload-00027-guw`.

The website contains 542 verified local files matching 543 production inventory
entries. The reconciled baseline protects 510 application/public files and keeps
the approved Players and Coaches marketing bytes. Validation passed 49 focused
frontend tests, a later nine-test assertion suite, TypeScript, 450 preview HTTP
checks across 11 routes and 19 release/baseline tests. The nine-test suite overlaps
the focused run; these are not 58 distinct tests or a full-suite rerun. Backend
checks passed 44 workspace tests and 39 isolated tests, with one private fixture
excluded from the candidate after passing in the workspace. Independent migration
checks passed 99/99; append review passed 12/12 and its runner tests passed 8/8.
Production chart and planner review passed, including one priority-preview
assessment using both stated goals. No workout plan was generated or activated.
Native display and the outstanding
Mac/iPhone/TestFlight acceptance are unchanged.

### Data-only follow-up: additional provisional Dribbling evidence

One additional reviewed Dribbling estimate was created at
`2026-09-17T23:01:06.940559Z`, using the existing authenticated reader and website.
The earlier feasibility summary had confused the proportion of the return leg
observed with the proportion of the full out-and-back course. Independent review
corrected that interpretation: full-course coverage is
`1 - remainingReturnFraction / 2`. The existing 75-percent Dribbling eligibility
threshold and `constant_return_pace_v1` method were retained.

The create-only publication adds one private document and one estimate, bringing
the reviewed total to four entries across three players: three Dribbling and one
Agility. The original detected start remains an explicit assumption and the
finish remains unrecorded. No rep, session, recording or measured result was
rewritten; the existing qualified agility result is preserved. There was no new
deployment or code, rules, configuration or guard change. The current version-4
reader, 510-file baseline and all 32 archive guards remain in place. See the
[data-only receipt](deployment/PROVISIONAL_DRIBBLING_DATA_FOLLOWUP.json) and
[Dribbling handoff](docs/PROVISIONAL_DRIBBLING_RECOVERY.md#additional-data-only-follow-up).
Authenticated readback at `2026-09-17T23:02:24.400Z` matched the reviewed estimate,
preserved measured rows exactly and omitted private provenance. Production
profile and planner checks passed with an explicit estimated label, sensitivity
range and optional low-confidence context. No workout plan was generated or
activated.
Earlier production receipts remain immutable records of their checkpoints.

### Previous release: Reviewed provisional Dribbling evidence

Deployment `6aac666c61025a8e62e8c399` was published at https://posetek.net on
September 17, 2026 at 3:22:58 PM PDT (`2026-09-17T22:22:58.156Z`). Application
source `e1c410153549a0e65dd36738d840391901059807` is pushed on
`codex/provisional-dribbling-recovery`. See
[`deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json`](deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json)
and [`docs/PROVISIONAL_DRIBBLING_RECOVERY.md`](docs/PROVISIONAL_DRIBBLING_RECOVERY.md).

Two reviewed near-finish Dribbling recordings now have explicitly labeled,
conditional estimates on authenticated skill maps and optional low-confidence
planning context. The estimates remain separate from measured results, overall
ratings, qualification, completion counts, rankings, Insights and shared results.
They disappear when a qualified Dribbling result becomes available. No Agility
estimate was published by that release, and it generated or activated no workout plan.

The authenticated `getAthleteEffectiveResults` reader was verified at version 3. Its
source-only deployment preserved configuration, all 57 checked function IAM
policies, 56 unrelated central function definitions and rules releases. The
video processor at that checkpoint was `onvideoupload-00026-bup` with 30 archive guards;
its source and the prior 26 entries remain intact. Two further mislabeled attempts
were moved to one Dribbling session with the same IDs and original recordings.
Both remain incomplete, and the successful original agility attempt is unchanged.
Two separately journaled private estimate documents add no measured results.

The verified website contains 494 local files matching the 495-file production
inventory. The reconciled protected baseline has 462 application/public files.
Approved Players and Coaches marketing bytes are unchanged. Production review
confirmed both labeled estimates, unchanged measured counts and an enabled
planner with the reversible estimate option. Baseline/release checks passed 19/19.
The initial frontend suite passed 928 tests with one five-second home-pose timeout;
that file passed all 10 tests in isolation. After a sixth provisional test was
added, its focused suite passed 6/6. TypeScript, 402 preview HTTP checks and 11
preview routes passed. Backend validation passed 37 workspace tests and 32
immutable-candidate tests, with one private fixture deliberately excluded from
the candidate and already passed in the workspace. These are separate checks,
not a claim that a final complete frontend suite was rerun. Native display and
the outstanding Mac/iPhone/TestFlight acceptance remain unchanged.

### Previous release: Testing audit remediation

Deployment `6aac59bb9c49063e622aa65a` was published at https://posetek.net on
September 17, 2026 at 2:22:42 PM PDT (`2026-09-17T21:22:42.725Z`). See
[`deployment/TESTING_AUDIT_PRODUCTION.json`](deployment/TESTING_AUDIT_PRODUCTION.json)
and [`docs/TESTING_AUDIT_BUILD_HANDOFF.md`](docs/TESTING_AUDIT_BUILD_HANDOFF.md).
Authenticated results, shared results and native team rankings use reviewed
qualification. Failed measurements remain unavailable, proven mirrors are
excluded, and explicit review nulls cannot be replaced by stale metadata.
Original or verified diagnostic media uses exact capture identity; replay respects
confidence, aspect ratio and recorded timestamps. Legacy clips without trustworthy
timing support manual pose inspection rather than invented synchronization.

The unchanged verified candidate contains 445 local files matching the 446-file
production inventory; its protected application baseline contained 413 files.
Approved Players and Coaches marketing bytes remain intact. The original workbook
is unchanged; its 264 overlapping issue rows have a separate private disposition
ledger. The independent post-repair checkpoint above has 258 qualifying results,
27 proven duplicates and all 40 qualifying vertical jumps with available peak
indices. Historical evidence gaps and retests remain explicit.

Native source is pushed at `e2c3736` on `codex/testing-audit-remediation` in
`athelyticsOG/posetek-mobile-app`, based on main `944177b` (which already includes
Insights usage). It retains source video for six tests, journals immutable capture
IDs and frozen ownership, commits idempotently after artifact acknowledgement,
and adds coach Finish plus a 60-second cutoff for COD/dribbling. The native handoff
is `docs/plans/TESTING_AUDIT_REMEDIATION_HANDOFF.md`. It remains code complete with
Mac compilation, XCTest, physical-iPhone acceptance and TestFlight outstanding.
No native rules, Apple signing settings or App Store Connect build were changed.

### Previous release: Expanded Insights

Deployment `6aabc66e9bcc60cc5c2ee12c` was published for https://posetek.net/insights,
published September 17, 2026 at 4:05:05 AM PDT (`2026-09-17T11:05:05.592Z`),
from application source `706f103`. See
[`deployment/EXPANDED_INSIGHTS_PRODUCTION.json`](deployment/EXPANDED_INSIGHTS_PRODUCTION.json)
and [`docs/insights/EXPANDED_INSIGHTS_HANDOFF.md`](docs/insights/EXPANDED_INSIGHTS_HANDOFF.md).

Overview, Testing, Workouts and Usage share current canonical scopes, filters,
local dates, pagination and player-return context. Verified testing uses accepted
revisions and processing evidence; charts distinguish recording documents,
recorded attempts, qualifying results and separate failure reports. The live
September 16 checkpoint matches 36 athletes, 20 boys/16 girls, 16 known ages,
10 fully/24 partially/two unrecorded, 325 documents and 244 qualified results.
Its 101 September 16 documents overlap 23 failure reports. Different explicit
session IDs prevent older calibration failures from disqualifying later captures.
Workout outcomes, prescribed sets, timer coverage and elapsed estimates are
separate from product usage. No original measurements or workouts were rewritten.

Eight additive generation-1 Node 22 functions are deployed and verified. V1 remains
available for compatibility. Server-owned version-2 projections and private
reporting metadata use new client-denied paths. Estimated active use is athlete
self-activity only; overlapping devices count once. Exact intervals expire after
90 days, aggregate summaries after 24 months, and all four TTL policies are active.
Historical absence remains Not collected. Keep these private-path rules and TTL
policies during a website/backend rollback; old rules do not protect new data.

Validation passed 893 frontend tests, 196 backend tests, TypeScript, 216 new rules
assertions, 205 existing planner rules assertions, seven actual Firestore SDK
integration tests and 19 release-tool tests. Fresh hosted admin/manager sessions,
four teams, Daniel's six players, filters, date modes, pagination, context return,
390px layouts and production smoke passed with no browser errors. All 350 local
files match the 351-file production inventory (one platform configuration file);
26 inherited HTML delivery transforms match prior production. The homepage,
Coaches page and 30 marketing assets are preserved. The new application baseline
contains 318 files.

Native usage is prepared and pushed at mobile commit
`4307f13b96a48c6dcc5af53e72a517f4e7773d2e` on
`codex/expanded-insights-usage`; original local mobile edits were preserved.
Eighteen XCTest cases and a shared scheme are supplied, but Xcode compilation,
device validation and TestFlight upload remain for Taiyo's Mac. No invitation or
message was sent to him. The native planner and existing app/widget identities
remain unchanged. The workbook and personalized gateway are unchanged.

### Previous release: Team Insights for admins and club staff

Deployment `6aabb282bcbad486db278962` is live at https://posetek.net, published
September 17, 2026 at 2:31:39 AM PDT (`2026-09-17T09:31:39.235Z`), from source
`55d46ea`. See [`deployment/TEAM_INSIGHTS_PRODUCTION.json`](deployment/TEAM_INSIGHTS_PRODUCTION.json)
and [`docs/insights/INTEGRATION.md`](docs/insights/INTEGRATION.md).

Taiyo's Team Insights prototype is integrated at `/insights`, with persistent
admin navigation and contextual links from canonical organization/team rosters
and coach dashboards. Admins select organizations, managers see every current
organization team, and coaches see only currently assigned teams. Independent
legacy coaches retain their existing dashboard. Organization/team context survives
player results and return navigation; stale roster mirrors cannot populate the
canonical coach dashboard.

The new `getClubInsights` callable (generation 1, Node 22, us-central1, version 1)
returns allowlisted aggregates with bounded reads and final current-access checks.
It counts recording documents, including failed/duplicate outputs, rather than
successful tests or app visits. Metric trends reject explicitly invalid or
incomplete results. Dates and Monday week boundaries use UTC; historical records
follow the current player profile. No athlete data, rules, planner, workbook or
native mobile changes were deployed in this release.

Validation passed 835 frontend tests, TypeScript, 19 handler/wrapper tests,
48 existing backend regressions, 18 release-tool tests and 25 release composition
checks. Live admin/manager reports reconciled all four club teams; cross-club and
signed-out requests were denied. Hosted admin and manager sign-ins, player links,
return context and 390px/26-week layouts passed. Coach restrictions and revocation
use synthetic fixtures. The exact preview was promoted; 302 local files match the
303-file published inventory. The homepage/Coaches page and 30 marketing assets
remain byte-for-byte preserved. That release's application baseline contains 270 files.

### Previous release: Vacaville account hierarchy and personalized web planning

Deployment `6aaba570721b0d41e0eabf90` is live at https://posetek.net, published
September 17, 2026 at 1:33:55 AM PDT (`2026-09-17T08:33:55.137Z`) from application
source `1cc6637`. The gateway, Firestore rules and personalized configuration are
also live; backend serving revision is `gatewayweb43b9da983c41`. The complete
release and recovery record is
[`deployment/VACAVILLE_WEBSITE_PRODUCTION.json`](deployment/VACAVILLE_WEBSITE_PRODUCTION.json).

The approved September 17 follow-up adds a canonical organization/staff/team
account hierarchy and one reviewed personalized-planner workflow across admin,
coach/manager and athlete web surfaces. Named team labels do not create staff
accounts. Current membership and player team ownership take priority over legacy
roster mirrors. That release kept the separate Insights prototype development-only;
the follow-up above now integrates it in production.

The reconciled workbook retains 36 athletes (16 girls, 20 boys): 10 fully tested,
24 partially tested and 2 with no recorded tests; none are classified as having
no successful tests. Its audit preserves 325 source records and prior contacts,
notes and historical sheets. The final OneDrive Operations workbook is
`PoseTek_Testing_Roster_Audit_2026-09-16_Updated.xlsx`; private contents remain outside Git.

Web users explicitly review and activate drafts. The four personalized
capabilities use an explicit unlimited daily policy, while authorization,
feature gates, private-context boundaries and operation ownership remain enforced.
Native mobile `generate_training_plan` behavior is unchanged. Release verification
did not submit plan-generation or activation requests.

Read [`docs/VACAVILLE_WEBSITE_UPDATE.md`](docs/VACAVILLE_WEBSITE_UPDATE.md) for the
superseding web rollout contract, validation status and guarded application
release command. `node scripts/build-application-release.mjs` creates the complete
`production-dist/` artifact; the ordinary homepage build still preserves the
pinned application. The optional `--marketing-snapshot` manifest was used here
to retain exact approved homepage, Coaches entry and 30 marketing asset bytes
from `6aab9fbaa73be75422324ba4`. Concurrent marketing commit `38a817e` remains in
the shared source and history.

The published inventory contains 261 files: all 260 local artifact files plus
platform-generated metadata. The reconciled preservation baseline contains 228
application/public files, including 57 genuinely new asset paths; compiled asset
counts also include reused paths. Frontend validation passed 811 tests across 59
files and TypeScript. The gateway passed 1,353 tests in each of two runs with six
explicit private-fixture skips; authorization checks passed 205 emulator
assertions and seven live permission checks. The production receipt records the
final release-helper counts and exact live browser/preservation checks. Preserve
existing receipts as historical records.

### Vacaville ownership and organization access repair

The September 16 collection cleanup was applied and independently verified on
September 17, 2026 UTC. It corrected organization/team assignments, consolidated
duplicate athlete profiles into the selected existing profile, transferred
misattributed recordings into another existing profile, and restored the director's
canonical manager access. The operator confirmed all four teams are visible in
the mobile app. Recorded measurements and timestamps were preserved; suspected
duplicate processing results remain flagged for a separate audit.

The website and mobile deployments were unchanged. A narrow archive guard was
deployed to the existing legacy Storage upload processor before copying video
objects; its private path/checksum coverage also protects rollback restores.
Read [`docs/VACAVILLE_DATA_REPAIR.md`](docs/VACAVILLE_DATA_REPAIR.md) for the generic
repair tool, verified aggregate results, guard revision and recovery requirements.
Private manifests, athlete data, signup codes, backups and runtime configuration
remain excluded from Git. Historical production and migration receipts remain
unchanged.

### Feed stack recovered for the shared repository

On September 16, 2026, the user requested the complete feed frontend/backend in
`dk242/posetek_website` for the app engineer. At `3f7ecd2`, the repository had only
an old feed mockup; homepage releases preserved the compiled live application
without recovering its source. The initial diagnosis is retained at `2264401`.

The feed feature stack is now recovered and integrated. Editable React source
in `app/src/pages/feed/` reconstructs the exact published component and styles,
with named components, typed contracts for all 14 callables, and source provenance.
Original frontend TSX/comments/history remain unavailable. No deployed React
runtime is imported. The frontend builds without the ignored reference capture.

The original authored backend was recovered from deployed Google Cloud Functions
source archives using the authorized Firebase account: 14 callables, four activity
projection triggers, account deletion, invitation helpers, and original tests.
Live Firestore/Storage rules and all 12 composite indexes are included. Credentials,
runtime config, source archives, production settings and athlete data are excluded.
The newer teammate admission tests and existing homepage changes are preserved.

Both `/feed` and `/feed.html`, player entry/navigation, and staff/admin feed links
are integrated. Root `feed.html` remains historical and is excluded from ordinary
application output. Preview with the Vite dev server at `/feed?preview=1`; read
[`docs/FEED_SOURCE_HANDOFF.md`](docs/FEED_SOURCE_HANDOFF.md) for setup, contracts,
checks, provenance and the release boundary. The normal dev app uses its existing
cloud Firebase configuration unless a developer explicitly changes it.

That source handoff did not deploy frontend/backend or modify production data;
its 171-file preservation baseline was historical. The later application release
above then reconciled that baseline to 228 files. Future application releases
still need a full application review and deliberate baseline reconciliation.

### Previous marketing release: public coaches and clubs page

Deployment `6aab9fbaa73be75422324ba4` was published September 17, 2026 at
1:10:47 AM PDT (08:10:47.595 UTC). `/coaches` is a separate marketing entry,
linked through a persistent Players / Coaches switch on both audience pages.
The player-page body is unchanged. The new page presents a tailored team-by-team
service: discuss the teams, arrange testing, and agree ongoing support.

Fictional Northfield FC examples connect club/team selection, individual profiles,
and Plan / Train / Retest. The phone uses the two approved drill clips. Admin
inspection informed the club hierarchy and assigned-team coach access; admin-only
editing tools are not advertised as coach capabilities. No private club/player
data, fixed packages, cadence promises, or guaranteed improvements are included.
Team enquiries open an email to `dylank@posetek.net` with a team-enquiry subject.

The draft was promoted unchanged. All 171 application/public baseline files and
the navigation bridge remain byte-for-byte preserved; no backend, database, rules,
or authentication changes were deployed. Coaches source lives in
`app/src/pages/coaches/`; metadata is in `coaches/index.html`. See
`deployment/COACHES_PAGE_UPDATE.md` and `deployment/COACHES_PAGE_PRODUCTION.json`
for decisions, verification, and rollback. The work was isolated from concurrent
admin/training changes in the local checkout and based on shared main `609faa0`.

### Previous revision: two drill videos and interactive coach results

Deployment `6aab2fc35884120dc73147f5` was published September 16, 2026 at
5:12:05 PM PDT (September 17, 00:12:05.241 UTC). The homepage sample now uses
only Figure-8 dribble (`DRB-006`) and Wall pass rhythm (`PAS-001`). Approved
Firebase library footage appears beside corrected diagrams on desktop, with
Overview / Demo switching below 760px and inside the phone. Clips preserve their
portrait proportions, start on request and pause when hidden. The phone selects
either drill and resets its local sample progress when selection changes.

Coach Dribbling, Top speed and Sessions cards select the corresponding sample
chart and answer, synchronized with the existing question chips. The figure-eight
route has mirrored loops; wall passes follow one centered straight axis. Mobile
source remains reference-only. The two public derivatives and their provenance
are committed; rebuilding the site requires no Firebase credentials.

The reviewed draft was promoted unchanged, with all 171 application/public
baseline files preserved. Teammate rules commit `abf4106` remains in the shared
history; this release did not deploy Firebase rules or modify catalog data.
Read `deployment/DRILL_VIDEO_COACH_UPDATE.md` and
`deployment/DRILL_VIDEO_COACH_PRODUCTION.json` for details and rollback.

### Previous revision: showing the mobile application

Deployment `6aab00ac8f7bad5e4a2afd2a` was published September 16, 2026 at
1:50:04 PM PDT (20:50:04.855 UTC). The hero now explicitly identifies PoseTek as a
mobile app and links to an upright phone beside the closing invitation. The phone
shows an interactive sample workout, grounded in the mobile source at
`98d8a051f0580785b70610f5c1a29a5246e08bfb`. It uses local sample data, prescribed
duration labels, and manual set/rest progression; it is a web illustration, not a
native screenshot or a saved workout. Existing demos and profile are unchanged.
Read `deployment/MOBILE_APP_SHOWCASE.md` for design decisions and
`deployment/MOBILE_APP_SHOWCASE_PRODUCTION.json` for validation and rollback.

### Previous revision: clearer poses, training and technique

Deployment `6aaafde5fa78fbd0fffdbf1e` was published September 16, 2026 at
1:38:15 PM PDT (20:38:15.094 UTC). The reviewed draft was promoted unchanged.
Read `deployment/HOMEPAGE_CLEANUP_PRODUCTION.json` and
`deployment/HOMEPAGE_CLEANUP_2026-09-16.md` for checks, references and rollback.

The hero asks “What should the player train next?” and shows skeletons only,
with manual rotation and automatic resumption. Mesh, visible camera presets and
pause controls are removed. All six recorded camera playbacks fit uniformly within
their cards, including full-rep motion and real calibration markers where present.
Training uses Setup / Movement / Finish diagrams; AI Coach explanations expand
on request. Technique is the final feature section, with a professional pose
overlaid at saved phases and one cue at a time. The player profile component and
data remain unchanged; its section number is now 02. Application assets remain
the guarded 171-file baseline, and recovered feed source is preserved.

### Previous revision: athletic male anatomy and finer tracking

Deployment `6aaa57d3fe77d22f67611c42` was published to https://posetek.net on
September 16, 2026 at 1:52:03 AM PDT (08:52:03.048 UTC). The validated draft was
promoted unchanged. All 197 local output files match the published inventory,
including the 171 preserved application/public files. Release checks and rollback
are recorded in `deployment/ATHLETIC_MALE_VIEWER_PRODUCTION.json`.

The user selected an **athletic male
anatomical model** in neutral sage and confirmed that all three recorded hero
poses must retain their existing coordinates. References inform body shape and
presentation only; they do not replace recorded evidence.

This revision refines the licensed MHR surface through a reproducible athletic
male rest-shape profile, reduces the tracking line and joint sizes, and replaces
the thick limb-based loading illustration with static renders of the fitted
mesh. The body remains illustrative, not a likeness or calibrated scan.

Recorded 2D pose strokes return to a fine treatment: 1.5 px primary lines,
1 px detail lines and 1.5 px dots, with the heavy outlines and torso fill removed.
Measurement overlays, data, playback and the improved phone metrics layout
remain intact. The hero keeps the same controls, held-pose timing and camera
persistence. Modified keyboard shortcuts retain their native browser behavior;
the tablet controls and two-line keyboard hint have separate vertical space.

Higgsfield installation was authorized and its install prompt confirmed, but
connection completion is still pending. No Higgsfield output is used at this
stage. The design decisions and public photo references are recorded in
`deployment/VIEWER_DESIGN_REFERENCE.md`.

### Historical release: anatomical viewer and clearer recorded tracking

Deployment `6aaa4f0b04a11116d8495374` was published to https://posetek.net on
September 16, 2026 at 1:12:19 AM PDT (08:12:19.763 UTC). The validated draft was
promoted unchanged. All 194 local output files match the published inventory,
including the 171 preserved application/public files. Release checks and rollback
are recorded in `deployment/ANATOMICAL_VIEWER_PRODUCTION.json`.
The reference lock and decision ledger are in
[`deployment/VIEWER_DESIGN_REFERENCE.md`](deployment/VIEWER_DESIGN_REFERENCE.md).
The approved scrolling structure, PoseTek green/lime identity, concise copy and
preserved-application release guard remain in place.

The hero now fits Meta's Apache-2.0 **Momentum Human Rig (MHR)** template locally
to the existing recorded landmarks. Its neutral continuous anatomical surface
has **4,899 vertices and 9,794 triangles**, replacing the earlier segmented
illustrative body. This is template fitting, not SAM 3D image inference, the
athlete's likeness, or a calibrated body scan. Attribution, retained license,
input hashes and reproduction steps are documented in
[`latest-hero/MHR_PROVENANCE.md`](app/src/pages/home/latest-hero/MHR_PROVENANCE.md).

The framed viewer provides **Body + pose** and **Pose only** modes, Front/Side/
Reset camera presets, drag and keyboard orbit, and camera persistence across
offscreen suspension. A finite stage, soft ground shadows and restrained
lighting make the figure's depth and airborne placement easier to see. The
three existing held poses, coordinates, shooting ball and cycle timing remain
unchanged. Reduced motion, visibility suspension and static fallbacks remain
part of the viewer contract.

Recorded 2D movement uses contrasting limb outlines, distinct primary joints,
quieter hand/foot and facial details, and a faint torso plane from exact supplied
landmarks. Playback has a larger target and explicit keyboard focus. Source
coordinates, frames, projection, calibration, telemetry and playback behavior
are unchanged; see
[`movement/PROVENANCE.md`](app/src/pages/home/movement/PROVENANCE.md).
Higgsfield was discovered but is not connected; no Higgsfield output is used.

### Historical release: three-pose hero and coherent homepage copy

Deployment `6aaa45aa0d612bd628335ecf` was published to https://posetek.net on
September 16, 2026 at 12:34:12 AM PDT (07:34:12.757 UTC). The validated draft was
promoted unchanged. See `deployment/HERO_REVISION_PRODUCTION.json` for checks and
rollback. All 193 local output files match the published inventory, including
the 171 unchanged application/public files. The established scrolling layout
and green/lime visual system remain the design reference, with Refero motion
and copy guidance.

The hero now has one exploration action, **“See your game differently,”** with a
circular downward arrow and a tracking line that responds to hover and focus.
The large hero booking button was removed; booking remains in the header and
closing section. Header navigation follows the section order: Tests, Technique,
Athlete profile, Training, AI Coach.

The viewer cycles Shooting → Sprint → Vertical jump at six-second intervals,
with a 450 ms crossfade. Shooting retains the prior reconstruction; sprint and
jump use derived world landmarks from the authorized recordings, verified
against source frames 312 and 158 respectively. Each skeleton has a translucent
illustrative body, not a likeness or calibrated body scan. Only shooting includes
a ball. Public assets contain derived coordinates and technical provenance;
private source recordings, account identifiers and access URLs remain excluded.
See `app/src/pages/home/latest-hero/PROVENANCE.md` for reconstruction details.

Manual pose selection pauses the cycle. Pause/Resume controls automatic cycling
and rotation; dragging and keyboard orbit remain available. Reduced motion
disables automatic motion and crossfades. Hidden/offscreen scenes suspend work,
interrupted drags reset on teardown, and the static fallback supports all poses.

Supporting copy now consistently explains testing → review → profile → training
→ retesting. Technique distinguishes three phases from four coaching stops and
labels its saved measurements “Recorded kick.” Workout context follows the
selected focus, identifies each independent two-drill sample, and distinguishes
available time from actual sample duration. Fixed week/progress claims were
removed; skipped demonstrations no longer claim completed drills. Sample profile
and AI Coach measurements and answers are unchanged.

### Shared repository handoff

The user requested that all website changes be committed to
`https://github.com/dk242/posetek_website.git` and made available to collaborators.
This revision includes the published homepage implementation, recovered source
and data, baseline protection, tests, provenance, and release documentation.
The latest fetched teammate commit, `a5fd57d` (admission-code casing tests), was
fast-forwarded into local `main` without changing the website work.

The root `README.md` now documents fresh-clone installation, the one-time public
reference capture, local preview, checks, and the production build. The editable
homepage no longer depends on unshared source changes in this working directory.
Ignored build output and the public-reference capture are reproducible and are
not source deliverables. Historical production receipts retain their original
manual-release and uncommitted-source descriptions as records of publication.

The handoff review found that Netlify rewrites 25 legacy HTML files when serving
the pinned deployment. Their exact tracked originals are now recorded as
`localPath` entries in the baseline; all original hashes and sizes are retained.
Verification without the local baseline cache resolved all 171 preserved files
from those 25 tracked sources and 146 pinned downloads, with zero mismatches.

### Historical release: nine annotations implemented

Deployment `6aaa2d81f7a768e5e5799ae1` was published to https://posetek.net on
September 15, 2026 at 10:50:58 PM PDT (September 16, 05:50:58.892 UTC).
The validated draft was promoted unchanged. See
`deployment/ANNOTATION_UPDATE_PRODUCTION.json` for verification and rollback.
All 171 application/public files remain unchanged; all 193 local output files
match the published inventory, plus one Netlify-generated metadata file.

The release established Hero → journey bar → six tests with one shared replay →
guided technique → athlete profile → ready-made workout → AI Coach/retesting →
booking. Copy is concise. The hero says “players”; only the keypoints art label
was removed, preserving the separate tracked-joints metric.

The user confirmed `athelyticsOG/posetek-mobile-app` main as the mobile reference,
inspected at `98d8a051f0580785b70610f5c1a29a5246e08bfb` through git objects without
changing its dirty local checkout. Technique follows its forward-play, pause,
Continue and same-frame cue behavior. Recorded pose data and measurements remain
unchanged. Professional references are static saved phases; no follow-through
reference or improved athlete recording is fabricated. Five workout examples
adapt its catalog: DRB-006, DRB-009, PAS-001, SHT-003, SHT-004. Plans open ready
to Start or Customize and distinguish actual sample duration from available time.

The Refero reference lock uses the approved scrolling PoseTek visual system,
mobile walkthrough/catalog behavior, and bundled motion, copy and icon guidance.
All nine original annotation quotations remain in
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`; original browser notes were preserved.
These decisions supersede earlier page order and apostrophe preferences below.

### Historical copy revision before the annotation release

The user requested shorter supporting text beside each bold section heading.
Seven section descriptions in `HomePage.tsx` were reduced to 105 words in total
instead of 168 (38% shorter), preserving the testing-to-training narrative. This
copy revision was subsequently included in the annotation release above. The
marketing build passed and the revised copy was verified in the local browser.
The user also referenced nine saved Codex browser annotations in the original
preview tab. They remain attached to the chat draft; automated submission did not
complete. All nine comments and their highlighted targets have now been read
directly from the original preview and transcribed in
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`. They cover merging the tests and
movement sections, improving technique playback and workout examples, combining
AI Coach with retesting at the end, moving the journey bar, and small hero/icon
changes. Annotation 8 changes `player’s` to `players`, superseding the earlier
apostrophe preference below. The release above now implements these annotation edits.

This folder was initially empty. Its source is based on a clone of
`https://github.com/dk242/posetek_website.git`, branch `main`, at commit
`c5af2e9` (September 13, 2026, captured shooting hero and recording carousel).
The repository history and its existing documentation are included. The published
scrolling update and subsequent annotation changes are included in the shared
repository handoff described above.

**The live homepage was newer than the original checkout.** On September 15,
`https://posetek.net/` showed a “Your game. In focus.” section with Movement,
Technique, Workout, and AI Coach tabs. The original checkout had separate assessment,
analysis/profile, and training sections. Matching page titles alone do not prove
that the versions match. No fetched branch or inspected local copy contained the
newer tabbed section. The user confirmed that the latest work was edited on
another computer or in another project folder, then explicitly chose to use
the deployed site as the reference rather than wait for that source.

**The working homepage now implements the user's scrolling update.** The user
asked to combine the September 13 page's long scrolling structure and product
explanation with September 15's newer visuals and functional demonstrations.
Movement analysis, technique analysis, AI Coach, and workout planning each have
their own section. The user authorized production publication, and the exact
validated draft was promoted to https://posetek.net on September 15, 2026 at
7:25:58 PM PDT (September 16, 02:25:58.402 UTC), deployment
`6aa9fd38c6863f74b02380e9`. This was a manual Netlify release, not a GitHub push.

The five public homepage assets from September 13 matched the initial source build
byte for byte. September 15's newer demonstrations were recovered from its pinned
public output: exact recording data, measurements, sample answers, and workout
logic are now in the editable project with provenance documents. The hero uses
maintained Svelte source adapted to the latest reconstruction. No deployed entry
bundle or duplicate React runtime is imported. Original authored source from the
other computer remains unavailable; recovered JavaScript is not that original source.

For the approved direction and checks, read
`deployment/SCROLLING_HOMEPAGE_UPDATE.md`. Build with
`npm --prefix app run build:marketing`, then run
`node scripts/serve-homepage-preview.mjs` for the update at http://127.0.0.1:4174.
On a fresh clone, first run `node scripts/capture-deployed-reference.mjs` to
download the public reference needed by the preview servers.
Port 4173 remains the unchanged September 15 tabbed reference. See the
[production receipt](deployment/SCROLLING_HOMEPAGE_PRODUCTION.json) for publication
and verification details. Live HTTP and published-file checks passed.

## Historical September 15 reference and application baseline

- Previous production/reference deployment: `6aa9b6f0d8faf6177db8fd97`,
  “Compact interactive homepage preview.” It remains unchanged as the tabbed
  comparison reference. Its rollback and baseline roles below describe that
  historical release; use the current production receipt for recovery now.
- Published: September 15, 2026, 2:44:08 PM PDT (21:44:08 UTC).
- Pinned URL: https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app
- Netlify reports no linked commit and no source archive for this release.
- Previous deployment: `6aa73378185ce440bbf18168`, “Correct mobile admin tab padding,”
  published September 13, 2026, 4:36:28 PM PDT (23:36:28 UTC).
- Capture: `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/`.
- Inventory: `reference-manifest.json` in that directory; 88 captured public files,
  5,487,022 bytes, zero capture failures, all local SHA-256 hashes verified.
- Scope: homepage and application entries, booking page, and statically discoverable
  same-origin bundles/assets. This is compiled output, not recovered original TSX
  or a complete backup of external services, user data, or every legacy page.
- Local preview: `node scripts/serve-deployed-reference.mjs`, then
  http://127.0.0.1:4173. The capture is ignored by Git and is not a deployment folder.
- Recapture: `node scripts/capture-deployed-reference.mjs` pins this same immutable
  release. Change its pinned deployment deliberately if adopting a newer reference.
- Browser review confirmed the local “Your game. In focus.” section and all four
  rendered panels: Movement (six recordings), Technique (recorded kick measurements),
  Workout (sample intake), and AI Coach (sample profile/questions/answer).
  No form was submitted, account used, or data changed.

## Historical production reconciliation (September 15)

During initial preparation, the old production baseline stopped the build with:
`Production application changed; reconcile homepage-baseline.json with its latest deployment.`
That mismatch was resolved for the authorized scrolling release using the full
Netlify file inventory for `6aa9b6f0d8faf6177db8fd97`, not the partial 88-file
browser-reference capture. `deployment/homepage-baseline.json` then specified
`applicationPath: "/application.html"` and 171 preserved application/public files.
All 171 retained files matched their pinned SHA-1 hashes and sizes. The application
entry and existing navigation bridge remain at their original paths without
reinjection or rewriting; only the marketing entry and marketing assets were replaced.

Netlify CLI-generated `/netlify.toml` metadata is tracked separately in the manifest
and excluded from served-asset preservation because the CLI regenerates it.
Its five effective header rules and one `/application.html` fallback redirect
were retained. The production guard now compares the live application entry
directly with the pinned modern baseline; it has not been bypassed. Legacy baseline
support remains tested. Preserve this guard and reconcile any future app drift.

Older copies remain untouched:

- `G:\My Drive\PoseTek Auto Editor\posetek_website`: older static homepage with
  existing uncommitted `index.html` changes. These were not copied over main.
- `C:\Users\dylan\OneDrive\Documents\GitHub\posetek_website`: another older checkout.
- A mobile reference exists at
  `C:\Users\dylan\OneDrive\Documents\GitHub\posetek-mobile-app`. Its currentness and
  parity have not been verified in this review. It is reference-only.

## Product and brand context

PoseTek connects soccer performance testing, movement analysis, an athlete
profile, focused training, and retesting for coaches, clubs, and players.
The documented homepage direction is **Draft B — Test to Next Step**:
six tests → review movement → compare with benchmarks → train → retest.
The private pitch video underlying that direction is not a public website asset.

The six tests are Sprint, Straight Vertical Jump, Standing Broad Jump,
Dribbling Shuttle, Change of Direction, and Side-View Shooting. Athlete profiles
organize results into Speed, Shooting, Power, Control, and Agility.

The established visual identity uses dark green, lime accents, condensed
athletic headings, Inter body copy, and IBM Plex Mono for technical labels.
The hero invites visitors to explore the system; booking remains available in
the header and closing section, and sign-in serves returning users. Use concise,
evidence-based copy. Sample athlete scores and training plans
must stay labeled as samples; do not turn them into customer outcome claims.
Experimental `hypothesis_*` page pricing and older offers are not verified current
commercial terms.

## Where homepage changes belong

| File or directory | Purpose |
| --- | --- |
| `index.html` | Public entry, SEO/social metadata, fonts, favicon, noscript fallback |
| `app/src/home-entry.tsx` | Isolated React homepage entry |
| `app/src/pages/home/HomePage.tsx` | Homepage copy, sections, navigation, booking/sign-in links |
| `app/src/pages/home/home.scss`, `magic.css` | Homepage styling, scoped to `.pt-home` |
| `app/src/pages/home/scrolling-home.scss`, `LazyHomepageDemo.tsx` | Scrolling layout and independent, persistent, visibility-aware lazy demos |
| `app/src/pages/home/TestCards.tsx`, `AthleteProfile.tsx` | Assessment cards and sample profile |
| `app/src/pages/home/movement/` | Recovered current movement controller, six exact recordings, telemetry, tests, and provenance |
| `app/src/pages/home/technique/` | Recovered current technique panel, 71 frames, phase measurements, references, and tests |
| `app/src/pages/home/product/` | Recovered current workout/coach UI, typed reducer/sample data, tests, and recovery tooling |
| `app/src/pages/home/PitchVisual.tsx`, `latest-hero/` | Shooting/sprint/jump hero, derived landmarks, illustrative bodies, cycle/orbit controls, Svelte/Threlte/Three renderer and static fallbacks |
| `app/src/pages/home/LazyPoseDemo.tsx`, `PoseDemo.tsx`, `use-pose-demo.ts`, `pitch/` | Earlier implementation reference; not the main page's active demo/hero imports |
| `app/src/pages/home/pose-*.json`, `landing-pose-demo-data.json` | Earlier recording data used by existing cards/tests; newer playback data lives in `movement/` |
| `app/src/App.tsx` | Application routes and legacy aliases |
| `app/vite.marketing.config.ts` | Isolated marketing build |
| `scripts/build-production.mjs` | Production verification and homepage/application assembly |
| `deployment/homepage-baseline.json` | Pinned application file hashes and deployment source |
| `scripts/serve-homepage-preview.mjs` | Local updated marketing preview over the captured current public app; not a deploy command |

This is now a React/TypeScript/Vite project with Svelte islands and legacy HTML
pages, not a single self-contained `index.html`. Future references to editing
“index.html” will usually mean the public homepage and its components.

## Preserve during future changes

- Keep existing clean routes and `.html` aliases, including booking, `/signin`,
  `/privacy`, and athlete deep links. Preserve `share`, `player`, `returnTo`,
  `view`, and `drill` query meanings.
- Retain keyboard controls, focus behavior, reduced-motion support, rendering
  suspension when hidden/offscreen, and the hero's render-failure fallback.
- Keep recorded measurements, units, frames, and checksum provenance intact.
  The hero retains the September 15 shooting reconstruction and adds source-derived
  sprint/jump world landmarks with estimated depth and illustrative bodies, not
  calibrated body scans. Earlier frame-464 source notes describe the prior hero;
  `latest-hero/PROVENANCE.md` and its data supersede them here.
- Preserve sample labels and the distinction between recorded data and illustrative
  content. Keep private video, account identifiers, and download URLs out of
  public bundles.
- Latest checked-in pose notes supersede earlier details: vertical-jump peak is
  0.554633 m / 21.8 in; dribbling ball trails break at occlusions; the recording
  carousel wraps Shooting to Sprint and previous/next retain pause state.
- The `player’s` apostrophe in the hero introduction is documented as an explicit
  earlier user request. Do not silently treat it as an accidental typo.
- Mobile remains the source of truth for shared player behavior and data
  contracts. Capture, calibration, processing, and new body scans remain mobile.
  Missing metrics remain unavailable, and player document IDs are not auth UIDs.
- Gateway-owned plans, proposals, AI history, analyses, and memory are not
  directly edited by public homepage work. Existing Firebase and athlete-share
  access contracts must remain compatible.

## Build and verification

Node 22.18.0 and npm 10.9.3 were available during review. Frontend dependencies
were installed from `app/package-lock.json` with
`npm --prefix app ci --ignore-scripts --no-audit --no-fund`.

Relevant local checks (run from the repository root):

```powershell
npm --prefix app test -- src/pages/home
node --test scripts/home-navigation.test.mjs scripts/production-baseline.test.mjs
npm --prefix app run check:svelte
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app run build:marketing
```

The production command is `node scripts/build-production.mjs`. It verifies the
live app against the current `deployment/homepage-baseline.json`, preserves every
application/public file recorded there, serves the preserved application through `/application.html`, and
adds the isolated homepage at `/` and `/index.html` with assets under
`/marketing/assets/`. Output is `production-dist`. The ordinary application build
outputs `dist` and is a different path; editing app source alone does not replace
the preserved application in a homepage release.

Do not publish the repository root as if it were the old static site. For the
historical September 15 scrolling release, the verified
`production-dist` artifact was uploaded as a draft, reviewed, then promoted without
rebuilding to deployment `6aa9fd38c6863f74b02380e9`. No backend or authenticated data
change was made. Source was uncommitted at that manual release; it is now included
in the repository handoff together with the later annotation update.

Historical September 15 scrolling-release verification (build, hosted draft, and production):

- Production assembly passed with all 171 preserved files verified.
- Five baseline integration tests and six navigation tests passed; the baseline
  tests cover modern/legacy preservation, drift rejection, corruption rejection,
  and marketing overlap rejection.
- Hosted draft HTTP checks passed for two homepage routes, all 171 preserved
  files, 22 application routes, and 74 application assets.
- Hosted draft browser checks covered the AI Coach's 20-minute workout handoff,
  workout start, and pause, with no browser errors.
- Live HTTP checks passed for the same two homepage routes, 171 preserved files,
  22 application routes, and 74 application assets.
- Live browser smoke checks confirmed movement recording switching, technique
  phase selection, the sign-in screen, and the booking calendar. No form or
  account action was performed.
- The published Netlify inventory contains 195 files. All 194 `production-dist`
  files matched their published SHA-1 hashes and sizes; the additional file is
  platform-generated `netlify.toml`. All 171 preserved application/public files
  remained unchanged.
- The earlier homepage validation remains documented in
  `deployment/SCROLLING_HOMEPAGE_UPDATE.md`; the broader interactive acceptance
  pass was on the hosted draft, followed by the listed live smoke checks.

Initial preparation verification (before the scrolling update):

- Static review: all 48 homepage relative imports resolve; 12 homepage IDs are
  unique; fragment destinations, booking/logo files, sign-in/privacy routes, and
  all six recording/card/thumbnail keys match.
- Homepage tests: 56 passed. Home-navigation tests: 6 passed.
- Svelte: zero errors and zero warnings. TypeScript build passed. Standalone
  marketing build passed and produced `marketing-dist/index.html`; Vite reports
  a large lazy-loaded 3D chunk, which is an existing build warning.
- Production build initially stopped by the baseline mismatch described above;
  the later authorized release resolved it through the modern manifest.
- Initial sandboxed checks encountered subprocess `EPERM`; the local checks were
  rerun with the necessary process access. This was an execution-environment issue.
- Local browser review of the captured deployment confirmed all four current
  showcase panels render. This is not a full responsive, accessibility, backend,
  or authenticated application acceptance test.

## Context documents and precedence

1. `deployment/CONVERSATIONAL_WORKOUTS_PRODUCTION.json`,
   `docs/CONVERSATIONAL_WORKOUTS.md` and `docs/AI_WORKOUT_FLOW_DESIGN.md`: current
   application/gateway release, workout conversation and Community behavior,
   validation and recovery. `deployment/homepage-baseline.json` is the current
   protected-file manifest. `docs/COACH_WORKFLOW.md` defines the connected coach
   workflow; canonical gateway and rules ownership in `AGENTS.md` remains binding.
   `deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json` and
   `docs/PROVISIONAL_DRIBBLING_RECOVERY.md` retain the historical conditional-
   estimate release and its privacy/recovery contract.
   `deployment/TESTING_AUDIT_PRODUCTION.json` and
   `docs/TESTING_AUDIT_BUILD_HANDOFF.md` record the preceding testing remediation.
   `deployment/VACAVILLE_WEBSITE_PRODUCTION.json` and `docs/VACAVILLE_WEBSITE_UPDATE.md`
   retain the earlier application build and hierarchy/planning handoff.
   `deployment/COACHES_PAGE_PRODUCTION.json` records the preserved marketing release.
   `deployment/ATHLETIC_MALE_VIEWER_PRODUCTION.json` is a historical viewer receipt;
   `deployment/VIEWER_DESIGN_REFERENCE.md` records the viewer design decisions.
   `deployment/ANNOTATION_UPDATE_PRODUCTION.json` is the historical annotation
   release; `deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md` records all nine requests.
2. `deployment/SCROLLING_HOMEPAGE_UPDATE.md` and
   `deployment/SCROLLING_HOMEPAGE_PRODUCTION.json`: earlier scrolling direction,
   recovery boundaries, behavior adaptations, reconciliation, and release receipt.
3. `deployment/INTERACTIVE_HOMEPAGE_RELEASE.md`: previous checked-in homepage
   behavior; cumulative notes, with newest sections superseding earlier ones.
4. `deployment/HOMEPAGE_RELEASE.md`: Draft B direction, public entry isolation,
   asset preservation, and recorded release checks.
5. `docs/PLAYER_EXPERIENCE.md`: current player surfaces, ownership, mobile parity,
   and acceptance requirements.
6. `app/PORTING.md`: routing, scoped CSS, shared Firebase/identity conventions.
7. `ATHLETE_RESULTS_LINKS.md`, `functions/CLUB_CONTRACT.md`: share and organization
   contracts when a requested change actually touches those features.
8. `docs/planner/`, `app/PLANNER_PERSONALIZATION_PLAN.md`, and `deployments/`:
   feature plans and historical integration/validation receipts.
9. `docs/FEED_SOURCE_HANDOFF.md`, `app/src/pages/feed/PROVENANCE.md`, and
   `functions/SOCIAL_RECOVERY.md`: recovered feed stack, setup, contracts and
   source provenance. This source handoff is not a production release.
10. `docs/DEVICE_PERFORMANCE_PLAN_HANDOFF.md`: plan-07 device-performance scope for
    this repository (not started); the canonical plan in the mobile repository wins.

Earlier September 9 integration notes describe a unified build with no homepage
bridge; the later homepage release notes and current build script supersede
those build instructions. Old static-site agent descriptions, `images/README.md`,
and parts of `STATIC_JUMP_UPDATES.md` are historical. Previous release test claims
are historical evidence, not a substitute for checking the next changed version.

## Website, UI, and 3D capabilities on this computer

| Skill or tool | Availability and role |
| --- | --- |
| Refero Design | Installed personal skill; primary UI/design methodology, typography, color, responsive layout, accessibility, motion, and copy |
| Figma | Available plugin skills/tools for design files, components, design systems, and code translation |
| ImageGen | Available raster-image generation/editing; not a 3D mesh generator |
| Computer Use | Available browser inspection and interaction testing |
| Netlify | Available configuration, preview, and deployment capabilities |
| Sites | Available complete-site building/hosting workflow; this project currently uses its own React/Netlify setup |
| Visualize | Available inline interactive explanatory tools and diagrams |
| Magic UI | Components are already in this repository; older notes mention a standalone skill that is not installed on this computer |
| Threlte / Three.js | Dependencies already in this project for interactive 3D rendering; no standalone Threlte skill currently installed |
| Meshy | User asked to include it in the 3D tool review; no Meshy skill or direct tool is currently available here |
| Meta SAM 3D | Official browser playground/model repositories exist; no direct local skill/model runtime installed here |

Meta SAM 3D Objects reconstructs textured objects from images; SAM 3D Body focuses
on human mesh/pose reconstruction. See the official
[Objects repository](https://github.com/facebookresearch/sam-3d-objects),
[Body repository](https://github.com/facebookresearch/sam-3d-body), and
[playground](https://www.aidemos.meta.com/segment-anything/editor/convert-image-to-3d).
No new 3D tooling was installed during this review. The user mentioned Meshy,
Threlte, and Meta tools; this was an inventory request, not an installation request.

## Next step

Continue the user's next prompts from the published scrolling implementation and
annotation updates in this repository. Commit website changes here and keep the
shared repository updated for collaborators. Keep the September 15 capture as the unchanged
comparison reference. If newer original source becomes available, reconcile it
with the recovered modules instead of replacing the user's accepted changes.
For any further release, verify the current application against the reconciled
baseline, rebuild, preview, and validate the intended changes before publishing.


## Phone diagnostics implementation (2026-09-23)

The paired mobile/website diagnostics implementation is integrated into local `main`
through `phone-diagnostics-triage` non-fast-forward merges. Physical/deployed acceptance
remains in progress; no release or push has occurred. Read [docs/PHONE_DIAGNOSTICS_HANDOFF.md](docs/PHONE_DIAGNOSTICS_HANDOFF.md)
for the schema-2 upload broker, private viewer/rules, disabled retention service,
code-complete source and explicit device/deployment gates. Automated validation includes
689 canonical rules tests, 58 cross-ruleset assertions and 16 backend tests; mobile
builds, 56 focused XTests and support/recovery empty-state UI pass. Deployed broker/IAM,
retention concurrency, populated viewer/retry and physical-iPhone acceptance remain
unverified. This work does not change the recorded production release or authorize cleanup.

## Phone processing dashboard (2026-10-03)

The admin phone overview and session analytics use backend-derived summaries from existing diagnostic manifests. See [docs/DEVICE_PROCESSING_DASHBOARD.md](docs/DEVICE_PROCESSING_DASHBOARD.md) for schema, comparison semantics and exact verification/release status. Current-algorithm baseline is explicitly pinned to native source e279f408 / 1.1 (31). No new TestFlight build is required for already-recorded fields.
