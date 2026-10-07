# Admin section menu

<!-- coach-release-alignment-current:start -->
## Current combined coach and admin-menu release

Website `6ac6a6bd448852167e52d189`, runtime source `69e51f5`, was published October 7, 2026 at 1:14:12 PM PDT from the exact reviewed candidate. Kai's always-visible coach roster and player summary now share authoritative cumulative D1 standing through the selected end, latest-two-local-test-date change and current fourteen-day plan progress. Missing summaries remain unavailable. Signup copying, scope/filter/history returns, player records and prescribing remain connected. The admin header groups Overview, Coaching hub and System & User Insights while retaining the existing tools and hierarchy.

All 1,825 artifact files match 1,826 provider records; 1,809 predecessor provider records remain exact and 15 runtime assets are added. The nine scoped Expanded Insights functions from `4ceba70` passed immutable source, configuration, IAM and dependency-closure verification; all 115 unrelated functions remain unchanged. Verified versions are getClubInsightsV2 version 7, getCoachPlayerComparison version 4, recordInsightUsage version 6, all six projectInsight writers version 7. Owned additive candidate and production acceptance passed 35 and 35 checks, with 13 and 13 captures. The reconciled baseline protects 1,823 files and passed the ordinary preservation build.

Owned active accounts/documents, current and noncurrent storage objects and notification outboxes are absent after delayed independent cleanup; verification credentials were removed. Deleted run-owned synthetic JSON generations remain recoverable under the unchanged seven-day bucket soft-delete policy until automatic expiry; zero active/current/noncurrent objects is verified, not physical erasure of retained soft-deleted generations.

Marketing, isolated feedback, stable P icons, real athlete evidence, active plans, coach assignments and private drafts/conversations are preserved. Rules, indexes, gateway, catalog and native were not deployed. The eighty held drills and their device/content acceptance hold, default-disabled gateway-first native voice, diagnostics, historical replay and other native release gates remain unchanged. Read [the coach handoff](../docs/COACH_RELEASE_READINESS.md), [menu handoff](../docs/ADMIN_SECTION_MENU.md), [production evidence](../deployment/COACH_RELEASE_ALIGNMENT_PRODUCTION.json) and [PR #38](https://github.com/posetek/posetek_website/pull/38). The earlier admin hierarchy release and candidate receipts below remain historical checkpoints.
<!-- coach-release-alignment-current:end -->


## Historical implementation checkpoint

Source candidate, October 6, 2026, based on shared main `7ff5781`. The production release recorded above supersedes this candidate status; its implementation and dated validation remain preserved below.

The logo row has three primary entries:

- **Overview** opens the Insights page (`/insights?from=organization&view=overview`), retaining synthetic preview mode locally.
- **Coaching hub** groups People & organizations, Planner, Technique review and Drill library.
- **System & User Insights** groups AI incidents, Device performance, User issues and App feedback.

Overview links to the existing Insights page; People & organizations remains
in Coaching hub. No new reporting page or route is introduced. The existing
navigation helper retains organization/team scope, saved filters and validated
player return destinations. Nested device and player links remain unchanged.
Account access, Community feed and sign out remain in the account menu.

The two grouped menus use native keyboard-operable disclosures. Opening one
closes the other; choosing a link, clicking outside or pressing Escape closes it.
On phones the primary entries wrap below the logo and the open panel fits the
header width. Signed-out users do not see the admin menu.

Validation: 56 focused header/navigation tests and TypeScript pass. Repository
lint exits successfully with existing warnings, and `git diff --check` passes.
Chrome interaction and screenshot checks pass at 1440, 1024 and 390 px: each
group exposes four links, only one group stays open and there is no horizontal
page overflow. Generated captures stay outside Git.

Production publication is separate: preserve the reviewed-draft workflow, the
1,808-file protected baseline, and the existing coach source release hold.
No backend, rules, gateway, catalog or native change is included.

Overview explicitly selects the overview report and organization entry context.
The shared example URL’s opaque cursor, page and fixed dates are not pinned to
the menu. Local synthetic preview mode remains enabled when following the link.

Standalone Insights now renders the same admin header when its existing service-
verified access role is admin. Coaches and managers retain their existing header;
embedded Insights does not add a second header. The development preview role
selector also shows this distinction. Authorization failures clear the role.

Header dropdowns have a subtle 160 ms fade/5 px slide on opening and rotating
chevrons. These effects run only when reduced motion is not requested; closing
remains immediate so navigation and dismissal stay responsive.

The header organization/team selector and its context fetch are removed. Scope
selection remains within the relevant pages, and navigation still retains existing
scope parameters.

Merge validation: all 1,847 frontend tests and TypeScript pass after integration
with current main. The device contract parity check runs against a fresh temporary
sparse checkout of canonical `posetek/posetek-mobile-app` main using
`POSETEK_MOBILE_REPO`; it is no longer blocked by the absent sibling checkout.
