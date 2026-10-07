# Admin directory and reporting

This frontend pass addresses [Admin dashboard: fewer clicks, clear and concise #26](https://github.com/posetek/posetek_website/issues/26). Overview remains the reporting home; **People & organizations** is the account-management home. Both have direct header destinations. Existing green surfaces, lime selections and readable tables are retained.

## Directory

`/admin/accounts` defaults to Players, with Staff, Teams and Organization settings alongside it. `/admin/organizations` redirects to the Teams view while preserving compatible organization/team query fields. Selecting an organization opens its roster across teams immediately. Canonical memberships remain authoritative; legacy organizations, independent coaches and unassigned accounts remain reachable without mixing legacy pointers into canonical membership.

Organizations load first. Global lookup loads only after a lookup is requested, and its notice explicitly retains the first-500-profile index and 40-match display limits. Selected organization rosters do not depend on that index. Roster pages show 20 players to bound invitation reads. Existing organization and legacy readers retain their limits and incomplete-list notices. Staff, team and management data load when those views open.

Add, move, team rename, staff invite/access and logo forms open only on request. Saves stay explicit. Replacement and revocation retain confirmations. Player signup links/codes use the existing invitation issuer and do not rotate valid codes during copying. Staff activation remains email-free; this pass does not alter activation, recovery or invitation contracts. The shared organization-manager/coach page is unchanged.

## Player evidence

Player names open full-width Results by default. Workouts and Profile are direct row actions; AI incidents is the fourth detail tab. Only the selected panel mounts its reader. Results reuses the already-authorized athlete profile; Workouts reads its plan/history once; Profile owns its private-note and coach reads. A failed private read never becomes empty editable evidence.

Prescribe workouts is in the player header and carries the current player's ID and current organization/team into the existing planner. Current profile ownership wins after a transfer. Results/drill/rep and saved-workout notification links remain compatible. The admin athlete preview remains read-only and returns to the selected player panel.

## Navigation and authorization

`adminNavigation.ts` owns typed directory query state, player panels, planner handoffs and validated local return destinations. Directory scope, search and pagination survive refresh and history. Reporting return links retain reporting dates, filters, search and opaque cursors; those fields are never interpreted as directory pagination or phone filters. Phone, team-event and advanced-device tools keep separate query namespaces. AI incidents retains its own `q`/`incident` meaning and does not claim organization filtering. Technique review links explicitly identify a general review rather than an unsupported exact queue.

Tab controls use manual keyboard activation: Arrow keys/Home/End move focus; Enter/Space opens the panel. Explicit return links and browser history restore saved viewport and row focus. Only URL/viewport/focus state is stored in browser session storage, scoped to the signed-in identity; account changes discard retained destinations and private results. Authorization still comes from the existing verified, nonanonymous PoseTek-admin guard and canonical services.

Identical concurrent organization-context calls share one in-flight request. Responses are not cached after settlement. Identity changes, denied access and explicit mutation invalidation discard pending results; successful management mutations also refresh header choices.

## Reporting and verification

Admin Overview orders summary, attention and the player list before detailed breakdowns. Testing, Workouts and Usage calculations and definitions remain unchanged. The admin report uses its existing authorized reporting API directly instead of repeating a full club-context read on each filter change. Coach/manager context resolution and Kai's coach workspace are unchanged.

Controlled same-fixture comparisons distinguish API payload/timing from component layout. At 390px the player-list top moves from 2,919px to 646px; at desktop from 1,474px to 396px. The directory's initial fixture reads change from three to one and serialized response payload from 94,440 to 213 bytes; simulated transfer timing is reported separately in release evidence and is not a production latency claim. Visible player Results, Workouts and Profile each take one action. Selecting an organization requires no coach/team expansion.

Acceptance covers phone widths 360/390/430px and desktop, keyboard/focus, errors/empty states, private-data invalidation, bounded lookup, legacy membership, invitation copying, planner preselection and read-only preview. Exact source/test/browser counts and production IDs belong in the confirmed release receipt, not inferred from these design decisions.

## Release boundaries

Implementation starts at GitHub main `879324a`, retaining Device performance, team sessions, replay and diagnostics source/history. Actual production `6ac5324b4ab5d8f3d69e6fdc` was ahead of the supplied notes. Its 1,704 provider records preserve all 1,697 predecessor protected files; only application/feedback documents differ among those records, with four added runtime assets. Fresh capture verifies 1,701 protected files and original Players/Coaches document hashes. Generated Svelte scope IDs and bundle references vary with build location; normalized runtime comparison is separate from exact original-byte inventory verification.

The deliberate Astro application release preserves freshly verified marketing and the exact current feedback document. Every unrelated protected file and effective site configuration must remain verified. A fresh hosted candidate is reviewed before that exact artifact is promoted, followed by production readback, temporary-account/data cleanup and preservation-baseline reconciliation. Old drafts are never promoted.

This is frontend-only. No Firebase functions, endpoints, rules, indexes, gateway, persisted schemas, catalog, active plans, coach assignments or native configuration are changed or published. Existing native/diagnostic/replay backend acceptance and training-content holds retain their original scope; publication of this admin adjustment does not accept or enable those separate releases. Feedback attribution/isolation, approved marketing and stable P icons remain protected.
