# Managed account activation and recovery

Implementation handoff, September 26, 2026. Publication and acceptance are recorded
separately in the release receipt; source changes alone do not establish a live release.

## Account ownership and authority

`/signin` is the everyday entry for all accounts. `/join` accepts privately shared
activation or recovery links. Staff access is assigned by an authorized issuer;
there is no public privileged-role selector and no automatic email delivery in
the new managed flow.

| Account | Issuer | Authority after activation |
| --- | --- | --- |
| Coach | Organization manager or PoseTek administrator | Active canonical membership and assigned teams |
| Organization admin | Organization manager or PoseTek administrator | Existing `manager` membership in that organization |
| PoseTek administrator | Existing PoseTek administrator after identity/address confirmation | Verified exact `@posetek.net` Auth identity, as before |
| Assisted recovery | PoseTek administrator after identity confirmation | Existing authority only; password changes do not restore or increase access |

Ordinary staff setup never sets Auth email verification and refuses the reserved
PoseTek domain. Internal-admin setup records the issuer's explicit confirmation
of the person and company address before its dedicated server operation verifies
that bound identity. The `admins/{uid}` profile remains a record, not authority.

New identities are provisioned disabled and unverified with an immutable UID.
The recipient chooses their own password. Existing-account activation requires
sign-in to the bound UID and never accepts a replacement password. Existing
player bindings, populated independent rosters and other-organization conflicts
retain their protections. Recovery cannot enable disabled accounts, change email,
set verification or change memberships/provider bindings.

## Experience and delivery

Issuers create staff access from organization management, or internal-admin and
recovery links from **Account access** in the PoseTek admin account menu. They
share the link directly; success says **No email was sent**. Copy link, copy code
and copy instructions all refer to the same one-time grant.

Activation links last seven days for staff and 24 hours for internal admins.
Recovery links last 30 minutes. Links use `/join#accessCode=ACCESS-…`; the fragment
is removed before React/analytics. Codes and passwords stay out of logs, telemetry
and persistent browser storage. Issuers retain the returned secret in memory
before refreshing their list, so a failed list read cannot lose a successful issue.
After a page refresh, replace a lost pending link; hashes cannot recover its secret.

Legacy `CLUB-…` invitations keep their existing verification contract. An issuer
can explicitly replace a pending legacy invitation with a manual activation link.
Player signup and independent/legacy coach signup remain separate existing flows.
The new website managed activation and assisted recovery do not depend on email.

## Server contract and recovery

The existing `createClubStaffInvitation` accepts optional `activationMode: manual`.
New endpoints are `issueInternalAdminAccess`, `issueAccountRecovery`,
`listAccountAccessLinks`, `revokeAccountAccessLink`, `getAccountAccessLink` and
`completeAccountAccessLink`. Roles, target UID, purpose, primary-email snapshot,
team scope, expiry and issuer are bound on the server. Client input never chooses
verification or administrator authority during redemption.

`accountAccessGrants`, `accountAccessTargets`, `accountAccessRateLimits` and
`accountAccessAudit` are server-only. Canonical rules already default-deny these
paths; no rule relaxation or gateway authority change is required. Public
preflight/completion is rate limited. Privileged issuance requires recent login
and identity confirmation; consumption rechecks current issuer and target state.

Consumption is reserved transactionally before Auth changes. Auth and Firestore
are not atomic: durable operation stages prevent replaying a password change or
granting duplicate membership after an interrupted response. A successful normal
sign-in to the same bound UID and current server readback establish recovery.
An uncertain write is never converted back to an unused link; unresolved states
require PoseTek review. Revocation stops pending grants; an operation already
consuming reports that state instead of falsely claiming cancellation.

Password recovery revokes old refresh sessions. Previously issued ID tokens can
remain valid until expiry under the existing rules; this release does not claim
instant invalidation of every active token. Expiry/revocation does not delete an
account. Account suspension remains a separate existing administrative action.

## Design and verification

The existing dark-green canvas, Inter typography, lime actions and restrained
portal cards are the design lock. Refero craft/copy guidance supplies progressive
forms, explicit next actions, labelled password controls, visible focus and 44px
targets. No live Refero research tool was available. The memorable interaction is
a single clear handoff card with recipient, access scope and direct-sharing actions.

Acceptance covers new/existing accounts, all three staff roles, email-free
activation/recovery, wrong identities, expiry/revocation, races, lost responses,
UID/email changes, canonical team boundaries and no privilege gain through recovery.
Review at 360/390/430px and desktop, including focus, keyboard, Back and refresh.

Publish scoped Firebase functions before exposing the frontend. Use the guarded
application build, verified current marketing snapshot, draft acceptance and exact
draft promotion. Reconcile the protected baseline and run its ordinary preservation
build. Every source/release commit uses `[skip netlify]`. Retain private verification
journals outside Git and remove all temporary accounts/documents after acceptance.
Native UI and unpublished training-content approval remain outside this release.
