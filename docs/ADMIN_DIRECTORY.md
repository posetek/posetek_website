# Admin directory and reporting

The current [metrics and roster workspace](ADMIN_WORKSPACE_METRICS.md) combines reporting and account management in People & organizations. Its [production receipt](../deployment/ADMIN_WORKSPACE_METRICS_PRODUCTION.json) supersedes the separate Overview entry described in this historical introduction. Invitation and management contracts below remain in effect.

Historical introduction: this frontend pass addressed [Admin dashboard: fewer clicks, clear and concise #26](https://github.com/posetek/posetek_website/issues/26). At that release, Overview was the reporting home and **People & organizations** was the account-management home. Both had direct header destinations. Existing green surfaces, lime selections and readable tables are retained.

## Directory

`/admin/accounts` defaults to Players, with Staff, Teams and Organization settings alongside it. `/admin/organizations` redirects to the Teams view while preserving compatible organization/team query fields. Selecting an organization opens its roster across teams immediately. Canonical memberships remain authoritative; legacy organizations, independent coaches and unassigned accounts remain reachable without mixing legacy pointers into canonical membership.

Organizations load first. Global lookup loads only after a lookup is requested, and its notice explicitly retains the first-500-profile index and 40-match display limits. Selected organization rosters do not depend on that index. Roster pages show 20 players to bound invitation reads. Existing organization and legacy readers retain their limits and incomplete-list notices. Staff, team and management data load when those views open.

Add, move, team rename, staff invite/access and logo forms open only on request. Saves stay explicit. Replacement and revocation retain confirmations. Player signup links/codes use the existing invitation issuer and do not rotate valid codes during copying. Staff activation remains email-free; this pass does not alter activation, recovery or invitation contracts. The shared organization-manager/coach page is unchanged.

## Player evidence

Player names open full-width Results by default. Workouts and Profile are direct row actions; AI incidents is the fourth detail tab. Only the selected panel mounts its reader. Results reuses the already-authorized athlete profile; Workouts reads its plan/history once; Profile owns its private-note and coach reads. A failed private read never becomes empty editable evidence.

Prescribe workouts is in the player header and carries the current player's ID and current organization/team into the existing planner. Current profile ownership wins after a transfer. Results/drill/rep and saved-workout notification links remain compatible. The admin athlete preview remains read-only and returns to the selected player panel.

## Navigation and authorization

`adminNavigation.ts` owns typed directory query state, player panels, planner handoffs and validated local return destinations. Directory scope, search and pagination survive refresh and history. Reporting return links retain reporting dates, filters, search and opaque cursors; those fields are never interpreted as directory pagination or phone filters. Phone, team-event and advanced-device tools keep separate query namespaces. AI incidents retains its own `q`/`incident` meaning and does not claim organization filtering. Technique review links explicitly identify a general review rather than an unsupported exact queue.

Directory and player tabs use manual keyboard activation: Arrow keys/Home/End move focus; Enter/Space opens the panel. Within the current Players workspace, reporting tabs also use manual activation and reuse loaded data. Other existing Insights tabs retain their established keyboard behavior. Explicit return links and browser history restore saved viewport and row focus. Only URL/viewport/focus state is stored in browser session storage, scoped to the signed-in identity; account changes discard retained destinations and private results. Authorization still comes from the existing verified, nonanonymous PoseTek-admin guard and canonical services.

Identical concurrent organization-context calls share one in-flight request. Responses are not cached after settlement. Identity changes, denied access and explicit mutation invalidation discard pending results; successful management mutations also refresh header choices.

## Reporting and verification

Admin Overview orders summary, attention and the player list before detailed breakdowns. Testing, Workouts and Usage calculations and definitions remain unchanged. The admin report uses its existing authorized reporting API directly instead of repeating a full club-context read on each filter change. Coach/manager context resolution and Kai's coach workspace are unchanged.

Controlled same-fixture comparisons distinguish API payload/timing from component layout. At 390px the player-list top moves from 2,919px to 646px; at desktop from 1,474px to 396px. The directory's initial fixture reads change from three to one and serialized response payload from 94,442 to 213 bytes. Opening takes 544ms before and 438ms after; the request window falls from 177.2ms to 41.4ms. The fixture uses a 40ms request floor plus 700 bytes/ms simulated transfer and excludes shared header reads; these are controlled measurements, not production latency claims. Visible player Results, Workouts and Profile each take one action. Organization-to-Results navigation falls from three actions to two because selecting an organization requires no coach/team expansion.

Acceptance covers phone widths 360/390/430px and desktop, keyboard/focus, errors/empty states, private-data invalidation, bounded lookup, legacy membership, invitation copying, planner preselection and read-only preview. Exact source/test/browser counts and production IDs belong in the confirmed release receipt, not inferred from these design decisions.

## Release boundaries

Implementation starts at GitHub main `879324a`, retaining Device performance, team sessions, replay and diagnostics source/history. Actual production `6ac5324b4ab5d8f3d69e6fdc` was ahead of the supplied notes. Its 1,704 provider records retain all 1,697 predecessor protected paths; only application/feedback documents differ among those records, with four added runtime assets. Fresh capture verified 1,701 protected files and original Players/Coaches document hashes at that reconciliation. Generated Svelte scope IDs and bundle references vary with build location; normalized runtime comparison is separate from exact original-byte inventory verification.

The deliberate Astro application release preserves freshly verified marketing and the exact current feedback document. Every unrelated protected file and effective site configuration must remain verified. A fresh hosted candidate is reviewed before that exact artifact is promoted, followed by production readback, temporary-account/data cleanup and preservation-baseline reconciliation. Superseded drafts are never promoted.

## Confirmed publication

Source `afb52a0` is published as `6ac5905069994ecfbad5e391` at [Posetek.net](https://posetek.net/admin/accounts), October 6, 2026 at 5:26:55 PM PDT. Read [the production receipt](../deployment/ADMIN_DIRECTORY_PRODUCTION.json). Candidate and production each passed the same 23 real-auth checks using owned synthetic accounts, including staff access saves, invitation copying, planner preselection/return, read-only player preview and account-switch denial. No workout generation, training writes, activation emails or feedback submissions occurred. Local checks cover request counts, inactive panels, keyboard/history/focus behavior, legacy links, transfers and 360/390/430px/desktop layouts.

All 1,743 reviewed artifact files match 1,744 provider records. The current baseline protects 1,741 files. The frontend suite passed 1,747 tests across 150 files; TypeScript, 54 release guards and 289 canonical admin/Insights rules assertions passed. Canonical rules were tested locally and were not published.

This is frontend-only. No Firebase functions, endpoints, rules, indexes, gateway, persisted schemas, catalog, active plans, coach assignments or native configuration are changed or published. Existing native/diagnostic/replay backend acceptance and training-content holds retain their original scope; publication of this admin adjustment does not accept or enable those separate releases. Feedback attribution/isolation, approved marketing and stable P icons remain protected.
