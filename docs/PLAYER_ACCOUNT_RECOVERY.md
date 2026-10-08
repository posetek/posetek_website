# Player password recovery and administrator assistance

Production handoff, October 8, 2026. Website `6ac73b9c8091f2ef117b22bf`, runtime
source `293acca795c4baddf279a23e9792404f97336326`, was published at 12:03:50 AM PDT
from the exact reviewed draft. Tracked help, scoped organization-manager recovery
and fresh same-account sign-in confirmation are live. Read [production evidence](../deployment/PLAYER_ACCOUNT_RECOVERY_PRODUCTION.json),
[PR #40](https://github.com/posetek/posetek_website/pull/40) and the
[scoped operations procedure](../deployments/account-recovery/README.md).
The existing [email-free account access](EMAIL_FREE_ACCOUNT_ACCESS.md) remains
the foundation. This website-first release supports the same Firebase account's
existing mobile password sign-in without changing or releasing native recovery UI.

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

Requests expire after 90 days through `expiresAt` TTL. The recovery UI keeps
codes, passwords and contact inputs in memory without adding browser storage.
Normal Firebase Auth session persistence remains. Recovery secrets, contact
details and authentication tokens are excluded from logs and Git.
The link fragment is removed before application tracking; recovery forms mask
contact and credential fields. Private acceptance journals and fixture identifiers
remain in ignored operator storage. Account/privacy erasure must include bound
recovery requests using the verified exact UID, in addition to existing feedback
erasure; TTL does not replace a verified deletion request.

## Validation and publication

The verified release covers player/account uniqueness, current canonical manager
authority, privileged-target exclusion, scoped list/revoke/replacement, ownership
transfers, issuer removal, expiry, concurrent issuance and interrupted Auth writes.
It also covers generic public acknowledgement, exact-account routing, rate limits,
duplicate-safe retries, concurrent request handling and account/selection changes.
Owned synthetic browser acceptance exercised public, organization and PoseTek-admin
flows at desktop and phone widths, keyboard controls, manual sharing, actual
same-UID password sign-in, fresh confirmation and dashboard access. Account providers and verification were preserved. Four player records and three
canonical memberships matched exactly; fixture results and workouts started empty
and remained empty. This does not establish preservation of nonempty training data.

Validation passed:

- 1,012 backend and 1,895 frontend tests, TypeScript, and 32 local rendered checks.
- 313 assertions against canonical mobile-owned rules and 353 against the exact
  read-only capture of published rules, including private recovery client denials.
- 34 live callable/API checks, 50 hosted draft checks and 43 positive production checks.
- 47 release guards, 36 operator tests, four transport tests and 15 artifact tests.

The ten scoped functions passed exact deployed-source, configuration/IAM and
transport verification; all 120 unrelated functions remain unchanged. Required
indexes are READY and TTL policies ACTIVE. The reviewed application preserved
freshly captured Players/Coaches marketing, isolated feedback, stable P icons,
teammate navigation and effective routing/headers. All 1,874 artifact files match
1,875 provider records, with only the prior application/generated metadata changed
and 18 runtime assets added. That exact hosted draft was promoted, verified in
production, and reconciled into the 1,872-file baseline; its ordinary preservation
build passed. See [production evidence](../deployment/PLAYER_ACCOUNT_RECOVERY_PRODUCTION.json).

All seven owned synthetic accounts were removed. Delayed independent readback
found zero known, descendant or scoped-query documents, including after removal
of four late Insight projections. Temporary browser and copied owner credential
files were removed; the original authorized Firebase CLI configuration was
retained. Acceptance does not claim that any real player's password was changed. Private journals, fixture identifiers, credentials
and case details remain outside Git. Shared operational rate counters retain their
ordinary TTL.

No Firestore/Storage rules, gateway, native UI, training catalog or held content
was published. The exact published rules were captured and tested locally without
production data writes; their unrelated testing/diagnostic differences from mobile
main do not change the verified recovery default denials. Existing native/content
acceptance gates remain unchanged. Future releases follow the
[scoped operations procedure](../deployments/account-recovery/README.md), including
pushed source with `[skip netlify]`, backend verification before frontend exposure,
immutable hosted acceptance, exact draft promotion, cleanup readback and baseline
preservation.
