import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../lib/firebase", () => ({ default: {}, auth: {}, db: {} }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: vi.fn(), clubCall: vi.fn(), invalidateClubContext: vi.fn() }));
const chartInteractions = vi.hoisted(() => [] as { title: string; onSelect?: (key: string) => void }[]);
vi.mock("../../insights/BreakdownChart", async importOriginal => {
  const actual = await importOriginal<typeof import("../../insights/BreakdownChart")>();
  return { ...actual, BreakdownChart(props: Parameters<typeof actual.BreakdownChart>[0]) {
    chartInteractions.push({ title: props.title, onSelect: props.onSelect });
    return <actual.BreakdownChart {...props} />;
  } };
});
import { WorkspaceAttention, WorkspaceMetricCells, WorkspaceReportDetails, WorkspaceReportTabs, WorkspaceScopeSummary, WorkspaceSummary } from "./WorkspaceReporting";
import { DirectoryPlayersTable, supportedWorkspacePlayerIds } from "./MonitorAccounts";
import ExpandedReport from "../../insights/ExpandedReport";
import { previewInsights } from "../../insights/lib/preview";
import { expandedRequest } from "../../insights/lib/expandedQuery";
import type { AdminDirectoryState } from "../lib/adminNavigation";
import type { PlayerRow } from "../lib/accounts";

const request = expandedRequest("", new Date("2026-10-06T18:00:00Z"));
const data = previewInsights(request);
const state: AdminDirectoryState = { directoryTab: "players", search: "", page: 1, reportView: "usage", reportWeeks: 8, reportTestingWindow: "period" };
const account = (id: string): PlayerRow => ({ id, name: `Player ${id}`, email: "player@example.test", registered: true, coachId: null, organizationId: "northfield", teamId: "harbor", signupCode: null, raw: { organizationId: "northfield", birthDate: "2011-01-01" } });
const metricState = { data, loading: false, error: "" };
const renderCells = (props: Partial<Parameters<typeof WorkspaceMetricCells>[0]> = {}) => renderToStaticMarkup(<table><tbody><tr><WorkspaceMetricCells {...metricState} {...props} /></tr></tbody></table>);
beforeEach(() => { chartInteractions.length = 0; });
const renderReport = (view: "overview" | "testing" | "workouts" | "usage", onChange = vi.fn(), fixture = "normal") => {
  const selection = { ...request, view };
  return renderToStaticMarkup(<MemoryRouter><WorkspaceReportDetails data={previewInsights(selection, 0, fixture)} request={selection} onChange={onChange} /></MemoryRouter>);
};

describe("unified workspace reporting", () => {
  it("provides precisely four manual report tabs, with one selected focus target", () => {
    const html = renderToStaticMarkup(<WorkspaceReportTabs active="testing" onChange={() => {}} />);
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-controls="workspace-report-panel-testing"');
    expect(html).not.toContain("Roster");
  });
  it("displays current account counts independently from report exclusion and activity", () => {
    const html = renderToStaticMarkup(<WorkspaceSummary {...metricState} accountCount={91} scopeLabel="Current team" request={request} />);
    expect(html).toContain("<strong>91</strong>");
    expect(html).toContain(`${data.roster.included} included in reporting`);
    expect(html).toContain("Testing coverage"); expect(html).toContain("Completed workouts"); expect(html).toContain("Estimated active use");
    expect(html).toContain(`through ${request.endDate}`);
  });
  it("keeps missing legacy metrics unavailable while preserving account totals", () => {
    const html = renderToStaticMarkup(<WorkspaceSummary data={null} loading={false} error="" legacy accountCount={12} scopeLabel="Legacy organization" request={request} />);
    expect(html).toContain("<strong>12</strong>");
    expect(html.match(/<strong>Unavailable<\/strong>/g)).toHaveLength(3);
  });
  it("keeps the scope header compact and leaves activity cards to the reporting view", () => {
    const html = renderToStaticMarkup(<WorkspaceScopeSummary {...metricState} accountCount={91} scopeLabel="Current team" request={request} />);
    expect(html).toContain('aria-label="Current reporting scope"'); expect(html).toContain("Current team");
    expect(html).toContain("<strong>91</strong> player accounts");
    expect(html).toContain(`${data.roster.included} included in reporting · ${data.roster.excluded} excluded`);
    for (const label of ["Testing coverage", "Completed workouts", "Estimated active use", "workspace-summary-card"]) expect(html).not.toContain(label);
  });
  it("uses complete current scope totals when a separate account count is unavailable", () => {
    const html = renderToStaticMarkup(<WorkspaceScopeSummary {...metricState} scopeLabel="All organizations" request={request} />);
    expect(html).toContain(`<strong>${data.roster.total}</strong> player accounts`);
    expect(html).not.toContain("0 included in reporting");
  });
  it.each([
    { teamAssignment: "unassigned", accountCount: 3 },
    { testingStatus: "fullyTested", accountCount: 91 },
  ])("qualifies parent reporting totals when the visible selection is narrower: %o", ({ accountCount, ...filter }) => {
    const parent = { ...data, scope: { ...data.scope, label: "Northfield FC" }, roster: { ...data.roster, total: 91, included: 90, excluded: 1, filtered: 3 } };
    const html = renderToStaticMarkup(<WorkspaceScopeSummary {...metricState} data={parent} accountCount={accountCount} scopeLabel="Selected players" request={{ ...request, ...filter }} />);
    expect(html).toContain(`<strong>${accountCount}</strong> player accounts`);
    expect(html).toContain("Selected players");
    expect(html).toContain("Across Northfield FC: 90 included in reporting · 1 excluded");
    expect(html).not.toContain("3 included in reporting");
  });
  it.each([
    { loading: true, text: "Loading reporting…" },
    { loading: true, rebuilding: true, text: "Preparing complete reporting…" },
    { loading: false, error: "Denied", text: "Complete reporting is unavailable." },
    { loading: false, legacy: true, text: "Reporting unavailable for this legacy organization." },
  ])("reports scope readiness without stale activity or invented zeros: $text", ({ text, ...status }) => {
    const html = renderToStaticMarkup(<WorkspaceScopeSummary {...metricState} {...status} accountCount={12} scopeLabel="Known accounts" request={request} />);
    expect(html).toContain("<strong>12</strong> player accounts"); expect(html).toContain(text);
    expect(html).not.toContain("included in reporting"); expect(html).not.toContain("0 excluded");
  });
  it("labels real zero activity and absent collection independently", () => {
    const player = { ...data.players[0], workouts: { ...data.players[0].workouts, completed: 0 }, usage: { ...data.players[0].usage, collected: false, activeMinutes: 0 } };
    const html = renderCells({ metric: { playerId: player.id, status: "included", player } });
    expect(html).toContain('data-label="Completed workouts"'); expect(html).toContain("<span>0</span>"); expect(html).toContain("Not collected"); expect(html).not.toContain("Unavailable");
  });
  it("distinguishes exclusions, missing projection, failures and loading from zero", () => {
    expect(renderCells({ metric: { playerId: "excluded", status: "excluded" } }).match(/Excluded from reporting/g)).toHaveLength(3);
    expect(renderCells().match(/Unavailable/g)).toHaveLength(3);
    expect(renderCells({ loading: true }).match(/Loading…/g)).toHaveLength(3);
    expect(renderCells({ error: "No access" }).match(/Unavailable/g)).toHaveLength(3);
  });
  it("shows all three activity columns in the same bounded identity roster", () => {
    const players = Array.from({ length: 45 }, (_, index) => account(`p${index}`));
    const html = renderToStaticMarkup(<MemoryRouter><DirectoryPlayersTable players={players} state={state} choose={() => {}} metrics={metricState} metricRows={[]} /></MemoryRouter>);
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html.match(/data-label="Testing"/g)).toHaveLength(20);
    expect(html.match(/data-label="Completed workouts"/g)).toHaveLength(20);
    expect(html.match(/data-label="Estimated active use"/g)).toHaveLength(20);
    expect(html).toContain("playerTab=workouts"); expect(html).toContain("playerTab=profile"); expect(html).toContain("reportView=usage"); expect(html).toContain("reportTestingWindow=period");
    expect(html).not.toContain("Player p20");
  });
  it("does not reinterpret server queue pages as account roster pages", () => {
    const players = Array.from({ length: 20 }, (_, index) => account(`q${index}`));
    const html = renderToStaticMarkup(<MemoryRouter><DirectoryPlayersTable players={players} state={{ ...state, page: 3 }} choose={() => {}} metrics={metricState} serverPage /></MemoryRouter>);
    expect(html).toContain("Player q0"); expect(html).toContain("Player q19"); expect(html).not.toContain("Player pages");
  });
  it("requests global metrics only for current canonical organizations while preserving mixed account rows", () => {
    const players = [account("supported"), { ...account("null-org"), organizationId: null, raw: { organizationId: null } }, { ...account("legacy"), organizationId: "legacy", raw: { organizationId: "legacy" } }, { ...account("deleted"), organizationId: "deleted", raw: { organizationId: "deleted" } }];
    expect(supportedWorkspacePlayerIds(players, { kind: "global" }, ["northfield"])).toEqual(["supported"]);
    const html = renderToStaticMarkup(<MemoryRouter><DirectoryPlayersTable players={players} state={state} choose={() => {}} metrics={metricState} /></MemoryRouter>);
    for (const player of players) expect(html).toContain(`Player ${player.id}`);
    expect(html.match(/data-label="Testing"/g)).toHaveLength(4);
    expect(html.match(/Unavailable/g)).toHaveLength(12);
  });
  it("keeps general review honest and scope-free", () => {
    const html = renderToStaticMarkup(<MemoryRouter><WorkspaceAttention data={data} onChange={() => {}} /></MemoryRouter>);
    expect(html).toContain('href="/admin/analysis"'); expect(html).not.toContain("/admin/analysis?");
    expect(html).toContain("these counts do not open a filtered queue");
  });
  it("renders Overview summaries, trends and every existing breakdown immediately", () => {
    const html = renderReport("overview");
    expect(html).toContain('aria-label="overview summary"');
    for (const label of ["Fully tested", "Workouts completed", "Estimated active use", "Daily recording activity", "Daily qualifying results", "Daily completed workouts", "Daily estimated active use", "Recent participation", "Testing coverage", "Boys/Girls divisions", "Current age", "Player engagement", "Players by organization", "Players by team"]) expect(html).toContain(label);
    expect(html).not.toContain("Detailed overview");
    expect(html).not.toContain("insights-players-heading"); expect(html).not.toContain("Clear all filters");
  });
  it("restores Testing totals, activity, audit, failure counts and qualified-performance tables", () => {
    const html = renderReport("testing");
    expect(html).toContain('aria-label="testing summary"');
    for (const label of ["Fully tested", "Partially tested", "Qualifying results", "Distinct recorded attempts", "Testing coverage", "Players qualified by exercise", "Testing activity by week", "Recording audit", "Failure reports", "Qualified performance by week", "qualified performance by week", "Players contributing", "data table marks weeks with no qualified result"]) expect(html).toContain(label);
    expect(html).toContain("View chart data"); expect(html).not.toContain("insights-players-heading");
  });
  it("restores Workouts totals, independent outcomes, prescription coverage and activity tables", () => {
    const html = renderReport("workouts");
    expect(html).toContain('aria-label="workouts summary"');
    for (const label of ["Workouts completed", "Workouts started", "Timer duration", "Estimated duration", "Player workout status", "Workout outcomes", "Work completed", "All prescribed sets recorded", "Unknown prescription", "Workout activity by week", "View chart data"]) expect(html).toContain(label);
    expect(html).toContain("Timer duration and estimated duration have different sources");
    expect(html).not.toContain("insights-players-heading"); expect(html).not.toContain("Clear all filters");
  });
  it("restores Usage totals, coverage, platform/feature breakdowns and weekly data tables", () => {
    const html = renderReport("usage");
    expect(html).toContain('aria-label="usage summary"');
    for (const label of ["Active players", "Returning players", "Estimated active use", "Collection coverage", "Player engagement", "Active use by platform", "Estimated active use by week", "Estimated active use by feature", "View chart data", "Total estimated active use counts simultaneous use once"]) expect(html).toContain(label);
    expect(html).not.toContain("insights-players-heading"); expect(html).not.toContain("Clear all filters");
    const unavailable = renderReport("usage", vi.fn(), "uncollected");
    expect(unavailable).toContain("Not collected"); expect(unavailable).toContain("Earlier time cannot be reconstructed"); expect(unavailable).not.toContain("NaN");
  });
  it.each(["overview", "testing", "workouts", "usage"] as const)("keeps exactly the canonical %s reporting content without a duplicate people table", view => {
    const selection = { ...request, view }, fixture = previewInsights(selection);
    const actual = renderToStaticMarkup(<MemoryRouter><WorkspaceReportDetails data={fixture} request={selection} onChange={() => {}} /></MemoryRouter>);
    const canonical = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={fixture} request={selection} hidePlayerFilters hidePlayerTable onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#workspace-roster"} /></MemoryRouter>);
    expect(actual).toContain(canonical);
    expect(actual.match(new RegExp(`aria-label="${view} summary"`, "g"))).toHaveLength(1);
    expect(actual).not.toContain("insights-players-heading");
  });
  it("retains graph selections for organization/team scopes and current reporting filters", () => {
    const onChange = vi.fn();
    renderReport("overview", onChange);
    const select = (title: string, key: string) => {
      const chart = chartInteractions.find(row => row.title === title);
      expect(chart?.onSelect, title).toBeTypeOf("function"); chart!.onSelect!(key);
    };
    select("Testing coverage", "noRecordedTests"); expect(onChange).toHaveBeenLastCalledWith({ testingStatus: "noRecordedTests" });
    select("Boys/Girls divisions", "girls"); expect(onChange).toHaveBeenLastCalledWith({ division: "girls" });
    select("Current age", "13-15"); expect(onChange).toHaveBeenLastCalledWith({ ageBand: "13-15" });
    select("Player engagement", "returning"); expect(onChange).toHaveBeenLastCalledWith({ usageStatus: "returning" });
    select("Players by organization", "northfield"); expect(onChange).toHaveBeenLastCalledWith({ orgId: "northfield", teamId: undefined, coachId: undefined, teamAssignment: "" });
    const team = data.scopeBreakdown.teams.find(row => row.id)!;
    select("Players by team", `${team.organizationId}:${team.id}`); expect(onChange).toHaveBeenLastCalledWith({ orgId: team.organizationId, teamId: team.id, coachId: undefined, teamAssignment: "" });
    renderReport("workouts", onChange); select("Player workout status", "completed"); expect(onChange).toHaveBeenLastCalledWith({ workoutStatus: "completed" });
    renderReport("usage", onChange); select("Active use by platform", "both"); expect(onChange).toHaveBeenLastCalledWith({ usagePlatform: "both" });
    select("Estimated active use by feature", "training"); expect(onChange).toHaveBeenLastCalledWith({ usageFeature: "training" });
    select("Active use by platform", ""); expect(onChange).toHaveBeenLastCalledWith({ usagePlatform: "" });
  });
});
