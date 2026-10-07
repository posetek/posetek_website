# Admin roster and reporting workspace

<!-- admin-hierarchy-current:start -->
The current [organization/team hierarchy and complete reporting workspace](ADMIN_HIERARCHY_REPORTING.md) is recorded in [its production receipt](../deployment/ADMIN_HIERARCHY_REPORTING_PRODUCTION.json). Organization selection now opens graphs and a team directory; people require a team, explicit All teams/Unassigned destination or supported review/lookup action. The experience below records the earlier release. Its metric, invitation and management contracts remain in force.
<!-- admin-hierarchy-current:end -->

This follow-up connects People & organizations to the existing Insights metrics. Website `6ac5a02e62dff64d89f511e0`, source `5907d44`, was published October 6, 2026 at 6:38:19 PM PDT from the exact reviewed candidate. It follows main `eb67366` and website `6ac5905069994ecfbad5e391`. See [the confirmed receipt](../deployment/ADMIN_WORKSPACE_METRICS_PRODUCTION.json) and [PR #34](https://github.com/posetek/posetek_website/pull/34).

## Experience

People & organizations is the single admin header entry. Players opens with a scoped summary and the roster. The flat organization list and team filter apply to both account membership and supported reporting. Staff, Teams and Organization settings remain request-only panels. Within Players, Overview, Testing, Workouts and Usage change reporting presentation without leaving the workspace.

Summary cards show players, testing coverage, completed workouts and estimated active use. Player rows retain age, team, signup status, existing codes, Copy code, Copy signup link, Results, Workouts and Profile, adding the three reporting metrics. The selected player's detail shows the same period-specific metrics beside its existing tabs and Prescribe workouts action. Canonical player ownership wins over a stale organization or team in a URL.

The design target is the already-approved PoseTek admin application: existing green surfaces and typography, lime selections, readable tables and spacious evidence panels. [Carbon's data-table guidance](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) supplies contextual row actions and a clear toolbar; [W3C tabs guidance](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) supplies focus and activation behavior. Refero's bundled craft references guide visible keyboard focus, scanning hierarchy and mobile spacing. No new fonts, decorative imagery, brand colors or component framework are introduced.

## Authority and metric meaning

Account membership and invitation services remain authoritative for the account roster. Insights remains authoritative for testing qualification, workout outcomes, reporting inclusion and estimated active use. They join only by player document ID; no name, email or Auth UID is used to infer a player match.

Defaults remain eight weeks, America/Los_Angeles and cumulative testing through the selected end date. Workouts and estimated active use use the selected period. Testing coverage is qualified coverage, not an attempt count. Workout completion is the existing logged outcome, not a newly invented compliance score. Estimated active use remains separate from workout timer duration and uses existing simultaneous-platform deduplication. Uncollected use is labeled Not collected; reporting exclusion and unsupported legacy reporting are unavailable evidence, not measured zero.

Directory search and pagination do not change summary totals. Ordinary organization browsing remains independent of the bounded first-500-profile global lookup. Reporting attention queues retain the existing server filters, name-search meaning and opaque cursors; email directory search and numeric directory pages remain separate. Unsupported legacy organizations and accounts retain management functionality with explicit reporting limitations; global figures are never labeled as that legacy organization's metrics.

## Additive interface and loading

`getClubInsightsV2` accepts an optional, admin-only `rosterPlayerIds` array of 1–20 unique canonical player IDs. Its optional `rosterMetrics` response returns either the existing allowlisted public player row with included status, or only playerId and excluded status. Requested IDs must remain in the freshly authorized scope. Unknown, deleted or transferred IDs receive a generic denial. Manager/coach requests and player comparison requests cannot use the extension. See [the V2 contract](insights/V2_CONTRACT.md).

The lookup does not change aggregate totals, legacy response shape, report filters, pagination or cursor identities. Per-ID metrics use the same unfiltered scope calculations for the selected dates and testing mode. Excluded history is not read or returned. No endpoint, persisted schema, projection version, rule, index, gateway or catalog is added.

The directory requests summary and metrics for its visible 20 rows together after the selected account roster is ready. Global summaries do not load the athlete lookup index. Reporting queues use the existing server page and at most 20 current profile reads where global hydration is needed. Private requests share only identical concurrent work; settled reports are not cached across screens. Identity, scope, permission and successful-management changes invalidate applicable reads and UI state.

Typed navigation retains directory scope/search/page independently from reporting view, dates, filters/search and cursor/page. Legacy entry links translate into the canonical workspace. Player details, planner and read-only preview returns retain supported filters, scroll and focus.

## Verification and release

Verify canonical metric parity, partial/empty records, reporting exclusions, lookup bounds, denial and transfer races, legacy compatibility, invitation copying, request counts and keyboard/history/refresh recovery. Review 360/390/430px and desktop. Use owned synthetic accounts for live acceptance; no real athlete results, plans, access or invitation codes are modified.

The reporting change follows the prescribed nine-function Expanded Insights preparation, source/configuration/IAM verification and acceptance workflow. Reconcile live source first and preserve unrelated behavior and its release gates. The deliberate Astro candidate preserves current marketing, feedback, icons, Kai's coach workspace and all protected assets. Promote only the exact verified candidate, verify production, remove all synthetic data and credentials, reconcile the preservation baseline and merge confirmed records into GitHub main. No rules, indexes, gateway, native or catalog publication belongs to this pass.

## Confirmed acceptance

All 1,803 frontend tests, 964 backend tests (three existing private-history skips), 19 backend preparation tests, 289 canonical rules assertions and 54 release guard checks passed. TypeScript, scoped lint and guarded Astro checks passed. Isolated synthetic UI review covered 56 workspace checks and six player-summary/navigation groups at 360/390/430/1440px with no page errors; 32 workspace screenshots covered four views at all widths. Selecting an organization combines summary and 20 visible metrics in one report call; switching report views adds zero calls. These are fixture measurements, not production latency claims.

The exact candidate passed 32 live browser checks and production passed 32, with no page or console errors. The scoped nine-function release passed immutable source, trigger/runtime/configuration/IAM and full-region unrelated-function checks. 12 owned live backend checks verified admin parity, excluded minimal responses, filters/pagination independence and staff/ownership denials. Synthetic membership/team changes were restored before browser review; all three Auth accounts and owned descendants were removed, followed by delayed independent zero-residue readback. No emails, feedback submissions, workout generation or starts were performed.

All 1,785 website artifact files match 1,786 provider records. Among predecessor records only application HTML and generated provider metadata change; 42 runtime assets are added. Feedback/marketing/icon bytes and coach defaults are preserved. The reconciled 1,783-file baseline passed the ordinary preservation build. Populated histories, transfer races and unavailable/legacy paths use controlled tests; live fixtures do not modify real athlete evidence.
