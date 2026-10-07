# Organizations, teams and people with complete reporting

This follow-up starts from GitHub main `cf6674a` and website `6ac5a02e62dff64d89f511e0`. They are predecessor records. Candidate and production evidence will be added after this implementation is accepted and published.

## Confirmed experience

The administrator follows one nested navigator: Organizations → Organization → Team → Player. Selecting an organization opens its aggregate reporting and team directory without a player table. Selecting a team opens that team's reporting and people. All teams and Unassigned / unavailable team are explicit destinations. Global lookup, independent accounts and legacy organizations remain reachable; no canonical team is invented for legacy relationships.

Overview, Testing, Workouts and Usage show the complete existing metric cards, graphs, explanations and accessible evidence tables above People. No Detailed overview disclosure hides the charts. Jump to people and Back to graphs links make the account actions accessible without removing reporting. The compact scope header distinguishes account count and reporting inclusion/exclusion from filtered reporting totals. Players, Staff, Manage teams and Organization settings retain their existing management functions; staff remains explicitly organization-wide with team assignments visible.

Names still open Results. Workouts and Profile remain direct row actions. Signup code/link copying, explicit saves, email-free staff access and Prescribe workouts retain their existing contracts. A player's current profile supplies its parent links and planner ownership. Its explicit return link keeps the original directory/report filters and position.

## Design lock

| Decision | Source | Applied role |
| --- | --- | --- |
| Green surfaces, existing typography, lime selected states | Approved PoseTek application | Preserve current tokens and icon assets; no new framework or imagery. |
| Nested organization/team navigator; choose a team before people | User's confirmed choices | One workspace, explicit levels and parent navigation. |
| Full charts above People | User's confirmed choice | Keep all original reporting content visible in the active view. |
| Native disclosure button semantics and mobile navigation | [W3C disclosure guidance](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) | Visible focus, Enter/Space, accurate expanded state and controlled content. |
| Spacious evidence tables and contextual account actions | [Carbon table guidance](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) | Preserve readable columns, roster toolbar and deliberate management actions. |
| Focus, touch targets and responsive clearance | Refero bundled craft references | At least 44px actions, keyboard access, long-label wrapping and no page overflow. |

## State and authority

The optional frontend-only `directoryLevel` query field distinguishes the organization overview from its explicit All teams people view. Without it, no organization opens Organizations; an organization opens its teams; a team opens People. Searches and compatible reporting queues retain their people destination. Existing route aliases, results/rep links and validated sign-in/return destinations remain supported.

Selecting a new organization/team preserves dates, timezone, testing window and reporting view, and clears cohort/search/page/cursor state. Organization/team chart segments use the same scope transition. Category chart segments retain scope and reveal the matching reporting queue with visible filters and a clear action. Unassigned reporting uses the existing organization scope and supported team-assignment filter; it is not labeled with whole-organization totals. Deleted/inaccessible selected teams do not silently broaden reporting.

Canonical memberships remain authoritative for accounts and team assignments. Existing Insights summaries and the optional visible-ID roster lookup remain authoritative for reporting. All qualification, workout, duration and usage definitions stay unchanged. Missing collection, excluded reporting and unsupported legacy scope remain distinct from zero evidence. Directory name/email search and numeric pagination stay separate from reporting filters, name-only search and opaque cursors.

No new API, persisted schema, index, rule, gateway, catalog or native change is required. Only the active reporting view mounts its presentation. The organization team's navigator and directory share the already-authorized context; no separate team request or eager global player index is introduced. Requests and retained private data remain invalidated on account, scope, permission and management changes.

## Acceptance and release

Compare all reporting sections with the pre-workspace `ExpandedReport` source, including summary trends, demographic/participation distributions, testing audits and performance tables, workout outcomes and prescription/duration coverage, and usage platform/feature/weekly coverage. Verify populated and empty fixtures, graph-driven scope and filtering, every hierarchy level, invitation copying, management, ownership changes and restored navigation.

Review 360/390/430px and desktop, keyboard disclosure/tabs/anchors and loading/error/empty states. Record request assertions proving shared context reads, no eager global index and no inactive-panel reads. Use owned synthetic accounts for candidate and production; preserve all real athlete evidence and account access.

Use the guarded Astro application release with exact marketing/feedback/icon preservation. Review a fresh hosted candidate and promote that exact artifact. Verify production, remove owned fixtures and credentials, independently audit cleanup, reconcile the preservation baseline and merge source plus confirmed release records. The nine live Insights function versions are preserved; this pass does not deploy a backend. Kai's coach workspace and separate native/content/replay/diagnostics gates remain unchanged.
