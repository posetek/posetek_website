# Outlook item identity and retained issue evidence

The latest [verification checkpoint](../deployment/OUTLOOK_IDENTITY_AUTOMATION_PROGRESS.json)
confirms cloud-only operation and removal of the former Codex updater. All five
Power Automate flows were observed enabled, and the six tracker functions passed
exact version-six source, configuration and IAM checks. The identity settings
cutover is still pending. Excel publication remains at the independently verified
native revision 266: its next 40-ticket batch exceeds the existing 700 KB limit.
The tested adaptive writer reduces only capacity failures to a fitting prefix,
retains all unselected work and preserves frozen replay and receipt checks. This
candidate is not yet deployed; current physical workbook readback and backlog
publication remain acceptance gates. An enabled flow does not establish completion.

The tracker must distinguish another capture of one email from another user
attempt. Outlook can expose different Exchange item-ID formats for the same
mailbox item. Similar subjects, identical error text, a requested `Prefer` header,
and matching Internet-Message-ID alone cannot establish that identity.

The fixed-mailbox Power Automate verification flow supports two different-type
conversions: REST item ID to immutable item ID, and immutable item ID to REST item
ID. Microsoft rejects a conversion with identical source and target types.
The prepared resolver starts with a declared REST conversion. It changes that
declaration only after the authenticated flow returns the exact request-bound,
known Graph type-mismatch result. The immutable fallback requires a two-way
conversion that returns the exact original immutable ID. Other errors remain
retryable failures; they cannot authorize an identity guess or advance source
completeness.

The flow retains the existing tenant/caller restriction, Dylan connection,
fixed `/me` and translation operations, secure action data, and disabled HTTP
action retries. Its complete read-only acceptance checks actual message contents
and headers through the existing mailbox reader, replay, a distinct item, the
known mismatch result, malformed inputs and unauthenticated rejection. An On or
Succeeded badge does not substitute for those checks or for workbook publication.

The new native flow has passed read-only semantic acceptance. That establishes
the tested connection and conversion behavior at its recorded checkpoint; it does
not activate its settings or repair historical rows. The exact version-six
source release is separately verified; the capacity repair, additive identity-binding cutover and fresh shared-workbook
acceptance remain separate gates. Use their actual receipts for current state.

## What the programmer sees

All original Emails rows remain. After activation, when exact Exchange identity
and full message contents prove that historical rows are captures of the same
item, the native writer annotates the retained alias rows and any separate
unmatched-email action with the canonical row/action and evidence digest. It
preserves original source IDs, display IDs, historical wording, source links,
and Status, Owner, Due and Fix
notes. The annotations identify an alias as another capture of the same item,
not another user attempt. Retained row totals still include those historical
records; they are not unique-message or unique-user totals. A later arrival
alias uses the established primary row.

Discovery by Internet-Message-ID is only a bounded way to find candidate records.
Every candidate must pass exact translation and message-content verification;
distinct physical copies with the same Internet ID remain distinct. Discovery
includes a sentinel and refuses a truncated set before freezing a group. A saved
group's exact members and proof remain frozen. Pending or published proofs are
reused; a competing proof cannot silently replace an existing group.

The existing actor, target-athlete and identity-basis columns still distinguish
the authenticated account from the athlete involved in an action. Current contact
details come from the recorded Auth UID. Unknown, unavailable and unverified
contacts stay explicit. Backend occurrences with different IDs remain separate
unless exact compatible request evidence establishes duplicate reporting. An
alias repair does not resolve the underlying application problem or a team's
manual action status.

## Capture and publication

Outlook arrival events trigger ordinary cloud capture. The existing five-minute
source recovery and fifteen-minute delivery/queue recovery provide automatic
cloud catch-up independently of this chat, Codex and Dylan's computer. Capture
retains fixed upper bounds, full pagination, overlap and separate Outlook/backend
capture and publication checkpoints. A failed page keeps its cursor unchanged.

Alias proof work is bounded: three concurrent Graph reads, a sixty-second
operation budget, at most twenty historical candidates and forty unique item
lookups per operation. Historical reconciliation examines forty source tickets
per pass. Partial durable evidence and queued repairs survive retries, while a
failed pass cannot claim complete historical coverage. Catch-up and the separate
outstanding-delivery scan can continue after a current window publishes.

The shared master remains **PoseTek > Technology > Website > User Issue Tracker >
PoseTek Issue Tracker.xlsx**. Dylan owns it; Nolan and Taiyo retain editing access.
New notifications go to Dylan alone. The schema and ordinary native writer stay
unchanged. Physical cloud readback must match the frozen native batch and receipt;
an HTTP acknowledgement, local save or successful flow badge alone is insufficient.

## Release and cutover checks

The source release changes the six existing tracker endpoints and adds the one
pinned identity endpoint-secret version to the two mailbox endpoints. Exact
deployed source, static configuration, raw IAM, unrelated functions and existing
native rows, receipt chain, seed and capture windows must pass preservation
checks. The existing writer queue is held during that release; source capture
continues. Newly captured work then drains through the ordinary native writer.

Before the additive settings transaction, both sources must have complete,
matching capture and publication cutoffs, no active window or lease, and no
pending native work. A fresh full snapshot must match a fresh physical cloud
download, formulas, links and all saved human fields by stable Action ID. Capture
progress during preparation invalidates the exact-state transaction and requires
new evidence. A source-only deployment or queued alias repair is not activation
or publication. Restore the reviewed queue configuration after the maintenance
hold; do not reset cursors or replace the master. The native cloud writer remains
the sole publisher.

Deployment and additive identity settings require separately verified source,
endpoint-secret, current cloud workbook, saved human fields and capture-binding
receipts. Do not infer activation from this source document. Historical release
receipts remain records of their respective checks. Native crash coverage still
requires a genuine symbolicated Mac/iPhone/TestFlight acceptance; generic device
diagnostics do not prove a crash. The mailbox correction changes neither native
instrumentation nor coach permissions. Handled coach/team load errors may display
in the page without producing an automatic incident when their direct reads are
not instrumented. Dylan handles user outreach manually.
