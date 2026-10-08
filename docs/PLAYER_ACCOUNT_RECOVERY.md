# Player password recovery and administrator assistance

Implementation handoff, October 7, 2026. This document describes the player
recovery extension. Publication and live acceptance must be recorded separately;
the existing [email-free account access](EMAIL_FREE_ACCOUNT_ACCESS.md) receipt
does not establish deployment of these additions.

## Player and administrator process

Players use **Forgot password?** at `/signin` to request the existing Firebase
reset email. If that does not help, **Request sign-in help** accepts the remembered
account email, name, organization hint and contact details. Submission returns a
generic acknowledgement and reference, without confirming whether an account
exists. Submitted identity and contact information remain unverified claims.

Only an exact current Auth email and unique canonical player binding route a
request to that player's organization managers. Unmatched or conflicting cases
remain with PoseTek. PoseTek administrators can see all requests. Organization
managers see only requests and player recovery grants within their current scope.
The organization name typed into a public form never grants routing or authority.

An administrator selects the exact player record, checks the backend-resolved
account, verifies the person's identity through an established organization
relationship or trusted contact, and confirms their own recent sign-in. Contact
information supplied by an unauthenticated requester alone is not identity proof.
Issuing a link requires explicit identity confirmation and sign-in within five
minutes. Share the private, one-time, 30-minute link directly; **Copy link** does
not establish that it was delivered. **Mark shared** records that separate action.

The player opens `/join`, chooses a password only they know, and signs in as the
same account. Administrators see password-update confirmation separately from
fresh sign-in confirmation. An interrupted confirmation must not prevent access
or replay the password write. Expired, revoked and uncertain operations offer
truthful recovery instructions instead of a success claim.

For an affected player, first confirm the exact player record and account UID
through the privileged lookup. A matching name or roster email is insufficient.
Do not create a replacement account or set a password on the player's behalf.
Real account details and case evidence stay outside this shared handoff.

## Authority and backend contract

The extension adds `inspectPlayerRecovery`, `issuePlayerRecovery`,
`submitAccountRecoveryRequest`, `listAccountRecoveryRequests`,
`updateAccountRecoveryRequest` and `confirmAccountRecovery`. It extends the
existing grant listing, revocation and recipient read/completion callables.
Public intake is separate from engineering issue reports.

Player recovery resolves agreeing explicit `authenticationUID` / `userUID`
fields and verifies the inverse player binding is unique. Missing or conflicting
bindings require PoseTek review. Account email and creation identity are read
from Firebase Auth. The client selects a player; it does not select the reset UID.

Active canonical organization managers may recover enabled, password-based player
accounts in their own schema-2 organization. Assigned coaches cannot issue
recovery. OAuth-only accounts retain their original provider and require PoseTek
review. Staff or company targets, disabled accounts and unresolved ownership require PoseTek.
Existing global account recovery and internal-admin activation remain PoseTek-only.

Grants bind the exact account, player, organization and issuer. Permission and
ownership are checked again during redemption and operation recovery. Transfers,
revoked manager membership or account changes cannot retain reset authority.
Managers cannot list, revoke or replace global or staff grants. The settled
blocked-operation replacement rule is restricted to the same player/org scope.

Recovery retains the existing durable reservation and Auth-write stages. It
changes the password and revokes refresh sessions while preserving player,
membership, verification and training records. Existing ID tokens may remain
valid until expiry under the current rules; this is not instant global logout.

## Requests, privacy and status

The request queue is server-only and bounded. Public retries retain their UUID
and are duplicate-safe; admin handling updates use an expected revision to avoid
overwriting another administrator's work. Public responses contain no account
match, account UID, player ID or recovery link.

Request handling and grant evidence are separate: **Needs review**, **Link ready**,
**Shared**, **Password updated** and **Sign-in confirmed** describe different
events. The backend derives credential-change progress from durable grant stages.
Sign-in confirmation requires the exact target UID with a fresh password sign-in
in a later Auth timestamp second than password application, session revocation
and completion. The recipient waits briefly before sign-in; an interrupted
operation is acknowledged with its code before obtaining a fresh session. The
confirmation acknowledgement is bounded to three seconds and never gates access
or repeats a password write. Manually closing a request is not recovery proof.

Requests expire after 90 days through `expiresAt` TTL. Recovery codes, passwords
and authentication tokens stay out of persistent browser storage, logs and Git.
The link fragment is removed before application tracking; recovery forms mask
contact and credential fields. Private acceptance journals and fixture identifiers
remain in ignored operator storage. Account/privacy erasure must include bound
recovery requests using the verified exact UID, in addition to existing feedback
erasure; TTL does not replace a verified deletion request.

## Validation and publication

Test canonical player/account uniqueness, current organization-manager authority,
privileged-target exclusion, scoped listing/revocation/replacement, ownership
transfers, issuer removal, expiry, concurrent issuance and interrupted Auth writes.
Test public intake acknowledgement/routing/rate limits/retries and concurrent
request handling. Validate the public, organization and PoseTek-admin website
flows at phone widths and desktop, with keyboard navigation and stale account
changes. Live acceptance uses owned synthetic accounts and verifies unchanged
player/training records; remove fixtures and independently confirm zero residue.

Publish only the scoped account-recovery backend before exposing the frontend.
Verify exact deployed source, configuration/IAM, TTL/index readiness and unchanged
unrelated functions. Use the guarded Astro application build with freshly verified
marketing and existing feedback bytes, validate the hosted draft, promote that
exact artifact, reconcile the preservation baseline and run its ordinary build.
Record publication evidence without player identities, contact details or secrets.

Canonical Firestore/Storage rules are tested through the mobile-owned suite and
are never published from this website checkout. Gateway, native UI, training
catalog and held content remain separate release scopes. Push source and handoff
changes with `[skip netlify]` so an ordinary Git build does not substitute for
the reviewed application release.
