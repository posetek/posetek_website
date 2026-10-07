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

## Organization header candidate — October 7, 2026

A shared `WorkspaceHeader` provides the same logo-row layout, grouped disclosures,
account menu, keyboard dismissal and reduced-motion-aware animation for admin and
organization pages. Each wrapper supplies its own destinations; the organization
wrapper never uses admin navigation state or admin routes.

Organization management and service-verified manager Insights show Overview
and Coaching hub. Coaching hub contains People & teams,
the existing staff Planner, and Community feed. Testing, Workouts, and Usage remain within Overview; their duplicate header
dropdown was removed at the user’s request. The account menu retains
Organization access (the existing team/staff management page), Community feed,
and Sign out. Existing organization/team selection carries into links. No new
technique, drill-editing, incident, device, user-issue or private-feedback access
is granted. Staff Planner and standalone Community feed retain the organization header for
verified managers, with the original headers as fallback for other roles.

Membership loaders, coach redirects, mutation guards and server permissions are
unchanged. Manager navigation appears only after role resolution; coaches keep
their current Insights header. Development synthetic role switching supports
previewing the organization header without real account changes.

Validation: 114 focused navigation, organization and Insights tests pass, along
with TypeScript. Source is prepared for the organization navigation PR; production is unchanged.

Chrome synthetic checks pass for manager scope retention and report navigation,
admin/coach separation, and header layout at 1440, 1024 and 390 px with no browser
errors. The existing manager report table extends beyond the phone viewport;
header bounds fit correctly. This pass does not change report-table layout.

Planner/feed follow-up: a shared authenticated header wrapper resolves current
manager membership through the existing organization service, rejects stale
identity/scope responses, and only retains a team returned for that organization.
Feed preview, player impersonation, embedded coach community and admin feed do
not invoke the manager wrapper's membership lookup. Organization feed links now
carry `teamId` for return navigation; feed audience/access behavior is unchanged.
Validation: 71 focused organization/feed/navigation tests and TypeScript pass.

Mobile verification follow-up (October 7): fixed the account panel positioning so
it opens below the full wrapped header instead of obscuring Coaching hub. All
shared dropdowns now close on outside taps, Escape or navigation, and opening
one closes the others. Phone controls have at least 44 px touch targets.

Fifteen touch-enabled Chrome emulation cases pass at widths 320, 360, 390, 430
and 768 px using synthetic manager content and the actual organization, Planner
and feed styles. Checks cover visible dropdown links, viewport bounds, touch
targets, outside dismissal, organization access and reduced-motion behavior.
169 focused tests, TypeScript and diff whitespace checks pass. Screenshots and
the temporary visual harness stay under ignored artifacts/mobile-header. This
is browser emulation, not a physical iPhone/Android acceptance test.

Final PR validation: all 1,850 frontend tests and TypeScript pass. The canonical
mobile device contract is verified via the temporary sparse checkout described
above. Generated test artifacts remain excluded from Git.

## Integrated organization navigation release preparation

The organization navigation candidate includes the October 7 coach/admin release
from `664b8fd`, preserving its authoritative summaries, private boundaries and
current production baseline. The shared header refactor retains existing admin
destinations and exposes organization tools only after verified manager access.

The staff Planner now supplies its currently authorized organization/team scope
to the header. Changing Planner selections updates navigation without changing
the URL or remounting the Planner, preserving entered intake and draft state.
Pending or denied organization scope clears the manager navigation; foreign team
IDs are omitted. This addresses the older URL hints remaining in header links
after a manager selected another team. No backend, rules, gateway, catalog or
native publication is included in this website release.
