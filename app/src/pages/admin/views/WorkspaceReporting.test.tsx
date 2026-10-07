import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../lib/firebase", () => ({ default: {}, auth: {}, db: {} }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: vi.fn(), clubCall: vi.fn(), invalidateClubContext: vi.fn() }));
import { WorkspaceAttention, WorkspaceMetricCells, WorkspaceReportDetails, WorkspaceReportTabs, WorkspaceSummary } from "./WorkspaceReporting";
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
  it("collapses detailed Overview before mounting charts or a second table", () => {
    const html = renderToStaticMarkup(<MemoryRouter><WorkspaceReportDetails data={data} request={request} onChange={() => {}} /></MemoryRouter>);
    expect(html).toContain("Detailed overview"); expect(html).not.toContain("Players by team"); expect(html).not.toContain("insights-players-heading");
  });
  it("reuses detailed reporting definitions without duplicate summary, filters or roster", () => {
    const testRequest = { ...request, view: "workouts" as const };
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={previewInsights(testRequest)} request={testRequest} hideSummary hidePlayerFilters hidePlayerTable onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#workspace-roster"} /></MemoryRouter>);
    expect(html).toContain("Timer duration and estimated duration have different sources");
    expect(html).not.toContain('aria-label="workouts summary"'); expect(html).not.toContain("included players · current roster"); expect(html).not.toContain("insights-players-heading");
  });
});
