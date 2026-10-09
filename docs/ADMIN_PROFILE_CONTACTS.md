# Administrator player contact details

The administrator player **Profile** tab shows a read-only **Contact details**
card before profile inputs and coach notes. Email uses the existing player-row
mapping (`signupEmail`, then `email`); phone uses the canonical `phone_number`
string already loaded with the player document. Missing or blank contacts display
**Not recorded** independently. No Auth lookup, profile write or new data request
is introduced. These are recorded profile contacts, not verified Auth identities.

This change applies to administrator-facing player profiles. It does not add
contact UI to coach/manager workspaces or change their existing data permissions.
Existing inputs, notes, Results/Workouts/AI incidents panels, signup actions and
navigation keep their behavior. The contact card uses the existing admin card
palette and typography; labels and selectable values use a definition list,
two columns on desktop and one on phones, with long values wrapping.

The reference target is the current admin profile and player-summary cards,
following the Refero direct-build workflow and bundled craft guidance. Source is
based on GitHub main `92c4e36403122939de62f7c2df53489ab2c9a259`. Its engineering
pipeline and test-emulator changes are retained; provider activation, backend
dependency releases and native/content gates are separate. Normal production
Firebase configuration remains active outside the explicit test build mode.

Release acceptance must bind the guarded artifact to its source commit, inspect
the hosted and production contact UI with synthetic contacts, test missing and
long values and account/player changes, and verify administrator access gates.
Preserve approved marketing, isolated feedback, icons, account recovery and all
unrelated live files. A source merge alone does not publish this UI. Confirmed
publication and preservation-baseline evidence are recorded below.

## Confirmed release

The exact hosted candidate `6ac95bd8769320160da44176` was promoted to
Posetek.net on October 9, 2026 at 2:28:04 PM PDT, with runtime source
`4b5cc6804732588dd0284d85634237b27b1d2107`. [Production evidence](../deployment/ADMIN_PROFILE_CONTACTS_PRODUCTION.json)
records full inventory and serving verification, 1,904 passing frontend tests,
green hosted source CI, ten candidate and ten production live checks and five
captures per environment. Visual review covered mobile and desktop; saved contact
readback was unchanged after refresh, player changes, tabs and account changes.

The original marketing and feedback bytes and all 1,873 unchanged predecessor
provider records remain exact. The reconciled 1,927-file baseline passed the
ordinary build. Both synthetic Auth accounts, player profiles, admin identity
record and derived descendants were removed; a delayed separate operator read
confirmed no owned records or temporary credentials. No storage objects were
created. Verification used only run-owned player contacts; no real contact data
was modified.

The completed advisory review was local Codex review by the implementing assistant,
not an independently hosted or paid provider review. Hosted reviewer activation,
backend dependency patches, canonical rules and native/content gates remain
separate. PR [#46](https://github.com/posetek/posetek_website/pull/46) carries the
source and confirmed release records; its final revision must pass CI before merge.
