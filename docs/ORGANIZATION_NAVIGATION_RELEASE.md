# Organization manager navigation release

Website `6ac6c5c6cebb1cb580004fae`, runtime source `0a7fe6d`, was published
October 7, 2026 at 3:28:24 PM PDT. It includes Kai's
[PR #39](https://github.com/posetek/posetek_website/pull/39), integrated with the
preceding coach/admin release. Read the
[production evidence](../deployment/ORGANIZATION_NAVIGATION_PRODUCTION.json).

After manager sign-in, Organization, Insights, Planner and Community retain the
organization header. Overview opens reporting; Coaching hub contains People &
teams, Planner and Community feed. Organization access stays in the account menu.
Navigation retains the currently verified organization/team. Admin tools remain
in the admin header, and assigned coaches retain their existing workspace.

The Planner integration corrects stale header scope after a team selection:
the header follows the currently authorized Planner selection without changing
its URL or remounting the Planner. Unsaved intake and draft state remain intact.
Pending or denied scope clears manager navigation, and foreign teams are omitted.

All 1,856 artifact files match 1,857 provider records. The release retains 1,824
predecessor provider records exactly, changing only the application document and
generated provider metadata and adding 31 runtime assets. Freshly verified Players
and Coaches documents, isolated feedback and stable P icons retain their original
bytes. Astro's regenerated feedback entry was replaced with the checksum-verified
predecessor entry before draft upload; its existing protected runtime assets remain
available. Do not replace approved feedback bytes merely because a shared build
produces another renderer/chunk filename.

Validation covers 1,870 unique frontend tests, TypeScript, 55 release guards and
the guarded Astro build. The first full test run lacked a configured canonical
mobile checkout for one device-contract assertion; the complete 68-test suite
then passed against reviewed mobile `a2928a0`. Four new Planner scope regressions
cover team/organization changes, default scope, foreign teams and denied scope.

An owned empty manager organization verified sign-in, all four workspaces,
Organization access, team retention, unsaved Planner intake, sign-out and four
anonymous route guards. Shared menus passed viewport, panel positioning, 44px
target, exclusive-open and outside-dismissal checks at 360/390/430px. Admin and
coach separation was checked with local synthetic previews. After promotion,
fresh manager sign-in/reporting and organization navigation passed on the exact
published immutable artifact; primary-origin provider and served-route verification
passed separately. The existing real primary-origin session was preserved.
Physical-device acceptance remains unverified. The existing manager report-table
phone overflow is outside this header change.

The one temporary Auth account, five owned documents and asynchronous Auth-deletion
tombstone were removed. Independent delayed readback found zero owned documents,
zero Auth accounts and no credential file. No players, training, storage objects
or notifications were created. Read-only before/after inventories confirm all
124 function versions/configurations are unchanged. No backend, rules, indexes,
gateway, catalog or native deployment was included; their separate acceptance
gates remain intact.

The reconciled baseline protects 1,854 files. Its ordinary preservation build
passed before merging the source and confirmed release records.
