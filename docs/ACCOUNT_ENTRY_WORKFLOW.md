# Account entry and staff activation

**Current managed-account implementation:** read
[Email-free account access](EMAIL_FREE_ACCOUNT_ACCESS.md). It replaces the
website's email-dependent managed-staff setup with manually shared, UID-bound
activation links and PoseTek-assisted recovery. Player and independent/legacy
signup contracts remain as described below. The remainder of this document is
the historical acceptance record for deployment `6ab788d1c138322f8f9b9911`, not
evidence that the new activation flow has been published.

## Historical September 26 account-entry release

Updated September 26, 2026. Deployment and cleanup evidence are recorded in the
[production receipt](../deployment/CONFIRMED_TRAINING_ACCESS_PRODUCTION.json).

## Entry paths

`/signin` and its existing `/kickai.html` alias remain the universal sign-in.
The primary new-account choices distinguish **Player — use your player signup
code** from **Invited coach or organization admin — activate staff invitation**.
The secondary disclosure retains independent-coach and organization-code signup.

| Audience | Provisioning and activation | Authority |
| --- | --- | --- |
| Player | A coach/organization creates the player profile and shares its signup code. The existing player flow creates Auth and binds that same canonical profile. | Existing player claim and ownership checks. |
| Invited coach | Organization manager or PoseTek administrator issues an email-bound staff invitation. The recipient creates or signs into Auth at `/join`, verifies that email, then claims access. | Active canonical organization membership and assigned teams. |
| Organization admin (manager) | Same invitation flow; the issuer assigns the manager role. | All teams within that organization. This is not a PoseTek global administrator. |
| Independent coach | Existing public signup creates an empty self-owned coach record and opens the independent roster. | Existing independent-coach rules and admission operations. |
| Legacy organization-code signup | Existing player/coach join and coach create-organization callables remain available. | Legacy organization access only; no managed-club manager privilege is granted. |
| PoseTek administrator | Existing sign-in requires a verified `@posetek.net` identity. | Existing exact-domain verified-email predicate. There is no public privileged role selector. |

Managed schema-2 organization creation remains PoseTek-administrator-only.
Managers and PoseTek administrators issue staff invitations; assigned coaches
cannot grant staff access. Codes are shared manually and expire after seven days.
The issuer receives the raw code once. This work adds no account provisioning API,
Firestore fields, role changes, rules changes, or invitation email service.

Public independent/legacy paths are intentionally preserved. They are active
handlers, not placeholders. Removing them or making every coach invite-only would
be a separate product decision.

## Staff activation and recovery

The `/join` flow explains three steps: use the invited email, verify it, claim
staff access. The account selector chooses create/sign-in only. The server assigns
the role and teams from the invitation.

- Creating an Auth account requires a syntactically complete staff code in the
  form. Only the server can validate its existence, recipient, expiry and status.
- Existing-email errors switch to sign-in while retaining the typed code and
  email. Password reset is available on the same page.
- Verification and password-reset emails use a same-origin `/join` continuation.
  The email URL carries no invitation code, email address or arbitrary return URL.
  The Firebase email action page's Continue link returns to activation.
- Invitation codes remain in component memory only, masked from session replay.
  A refresh/verification return may require pasting the supplied code again.
  No code is written to browser storage or added to a URL.
- Verification, invalid/expired code, wrong-email and existing-profile conflicts
  never delete the Auth account. Errors explain the next step. Existing linked
  players, populated rosters or other clubs still require PoseTek reconciliation.
- A successful claim is followed by `getClubContext` for the returned
  organization. Navigation requires the current canonical organization and role
  to match the claim response.
- On a failed/lost acknowledgement, a fresh context read may offer **Open
  organization** for the account's current active staff membership. It explicitly
  says that the invitation could not be confirmed. Existing membership in another
  organization never becomes a false successful claim. Without membership, the
  error remains and the user can retry.
- Auth epochs and current-UID checks ignore late verification/claim/context
  responses after account changes or unmount. No client readback grants access.

An unlinked account signing in on `/signin` receives **Finish staff activation**
instead of “Account not found in system.” Copy also directs users who expected a
player profile to their coach, without assuming every unlinked Auth user is staff.

## Return destinations

The same-origin allowlist now includes `/join`, `/organization`, `/programs` and
`/insights`, preserving context queries. External URLs, credentials in URLs and
unsupported routes remain rejected. Existing legacy return paths remain valid.

Admin, manager and coach sign-in honors a supported return destination. Players
can return to Training but are routed home instead of into roster, organization
or Insights surfaces. Independent coaches can open their organization entry/help
page but cannot use a return URL to enter managed-club Insights. Unlinked accounts
can return to `/join` only. Existing route, server and membership checks continue
to authorize the selected player/team; this redirect policy grants no data access.
Organization links use the existing `orgId` parameter.

## Design lock

The approved target is the existing PoseTek auth/portal design: dark green canvas,
Inter typography, lime primary actions, restrained borders and compact forms.
The Refero skill was applied using its bundled craft-details and copywriting
references (live Refero tools unavailable). The direct-build decision ledger is:

| Decision | Source | Purpose |
| --- | --- | --- |
| Preserve auth and portal tokens/surfaces | Existing product and approved task direction | Keep familiar account entry; no new visual system. |
| Distinguish invitation activation from independent signup | Audited admission/club contract | Explain the actual paths without silently changing permissions. |
| Three visible activation steps and actionable errors | Refero craft/copy guides; existing verification contract | Explain what is saved and what remains to do. |
| Visible keyboard focus, signup dialog focus containment, 44px targets | Refero craft guide; approved accessibility constraint | Support keyboard and small-screen use. |

## Source and verification

Account-entry source: `app/src/pages/landing/` and `app/src/pages/staff-invite/`.
Backend authority remains `functions/admission.js`, `functions/clubs.js`,
`functions/club-access.js`; canonical Firebase rules remain mobile-repository-only.
Read `docs/PLAYER_INVITATION_LINKS.md` for the unchanged robust player redemption
workflow and `docs/COACH_WORKFLOW.md` for canonical team membership.

Verified locally with synthetic tests:

- 95 frontend tests across existing landing helpers, player invitation claims,
  new account destinations, and staff invitation transitions/recovery.
- 32 existing Node admission/club tests, including legacy organization creation,
  team isolation, staff email verification, wrong-email/expired code rejection,
  race conditions and canonical membership.

Browser checks covered anonymous `/signin` and `/join` at 360, 390, 430 and
1280 pixels. The existing visual tokens and primary player/invited-staff choices
were preserved, with independent-coach and organization-code signup retained as
secondary paths. No horizontal overflow was observed. Signup modal Tab containment
and Escape, the staff account selector, and password-reset guidance for a missing
email were verified. An existing unlinked synthetic Auth account signed in with
`returnTo=/join` and reached staff activation.

TypeScript checks passed, and the final candidate application build and 95 account
tests passed. Source review confirmed that the deferred login-focus callback checks
the committed overlay state: closing signup can return focus to sign-in, while an
open overlay blocks delayed login focus. Pending focus timers are cleared on
unmount. At 390 pixels on the final candidate, Tab entered the signup close control;
**Already have an account? Sign in** closed the dialog and restored focus to the
email field, confirmed through the active DOM element.

All four authenticated invitation checks passed using a temporary organization:
wrong-email refusal, matching verified-email redemption, exact team scope and
malformed/used-code refusal. Browser acceptance confirmed the invited coach's
assigned-team dashboard and saved personal-workout history; the manager retained
organization/staff controls and the scoped player preview. The independent coach
path and unlinked-account activation return also passed.

Production sign-in returned the temporary athlete to Training, where saved
workouts, the resource setup and the six-tab Community navigation were verified.
These checks do not establish physical-device or native-app acceptance. No real
accounts or invitations were claimed, and no verification or password-reset
emails were sent during account-entry verification.
