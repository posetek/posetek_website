# Admin section menu

Source candidate, October 6, 2026, based on shared main `7ff5781`.

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

Merge validation: 749 of 750 admin/Insights tests pass. The remaining device
contract parity check requires the unavailable sibling mobile checkout at
`PoseTek-mobile-app/tools/contracts/device-performance-v1`; it is unrelated to
this navigation change. TypeScript passes after integration with current main.
