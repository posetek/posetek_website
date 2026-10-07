import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AccountLoad } from "../lib/useAccountLoad";
import type { SummaryOrganization } from "../lib/playerSummaryData";
const lookup = vi.hoisted(() => vi.fn(() => ({ data: null, loading: true, error: "", rebuilding: false, refresh: vi.fn() })));
const organization = vi.hoisted(() => ({ state: { kind: "ready", data: { kind: "canonical", organizationId: "current" } } as AccountLoad<SummaryOrganization>, refresh: vi.fn() }));
vi.mock("../../../lib/firebase", () => ({ db: {}, auth: {} }));
vi.mock("../lib/useAccountLoad", () => ({ useAccountLoad: () => organization }));
vi.mock("../lib/workspaceMetrics", () => ({ useWorkspaceMetrics: lookup }));
import PlayerSummary, { PlayerSummaryContent } from "./PlayerSummary";
import type { PlayerRow } from "../lib/accounts";
import type { ExpandedInsights, ExpandedPlayer } from "../../insights/lib/expanded";
const data = { period: { startDate: "2026-09-01", endDate: "2026-09-30", timeZone: "UTC" }, testingMode: "cumulative" } as ExpandedInsights;
const metric = { organizationName: "Current club", teamName: "Current team", testing: { status: "partiallyTested", exercisesComplete: 2 },
  workouts: { status: "none", completed: 0 }, usage: { collected: false, activeMinutes: 0, activeDays: 0 } } as ExpandedPlayer;
describe("player activity summary", () => {
  it("requests exactly the current player using their canonical ownership and excludes queue filters", () => {
    const player: PlayerRow = { id: "athlete", name: "Player", email: "", registered: false, signupCode: null, coachId: null,
      organizationId: "current", teamId: "current-team", raw: { organizationId: "current" } };
    renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/athlete?orgId=old&reportStart=2026-09-01&reportTestingStatus=noRecordedTests&reportPage=2"]}><PlayerSummary player={player} /></MemoryRouter>);
    expect(lookup).toHaveBeenLastCalledWith({ scope: { kind: "organization", organizationId: "current" }, search: "start=2026-09-01", playerIds: ["athlete"], enabled: true });
    renderToStaticMarkup(<MemoryRouter><PlayerSummary player={{ ...player, raw: {} }} /></MemoryRouter>);
    expect(lookup).toHaveBeenLastCalledWith({ scope: null, search: "", playerIds: ["athlete"], enabled: false });
  });
  it.each(["legacy", "unavailable"] as const)("does not enable a report lookup for %s organization documents", kind => {
    const player: PlayerRow = { id: "athlete", name: "Player", email: "", registered: false, signupCode: null, coachId: null,
      organizationId: "current", teamId: "deleted-team", raw: { organizationId: "current" } };
    organization.state = { kind: "ready", data: { kind } };
    const html = renderToStaticMarkup(<MemoryRouter><PlayerSummary player={player} /></MemoryRouter>);
    expect(lookup).toHaveBeenLastCalledWith({ scope: { kind: "organization", organizationId: "current" }, search: "", playerIds: ["athlete"], enabled: false });
    expect(html).toContain("Recorded results and workouts remain available below");
    organization.state = { kind: "ready", data: { kind: "canonical", organizationId: "current" } };
  });
  it("labels exact server period, cumulative testing and missing usage without fabricating zero use", () => {
    const html = renderToStaticMarkup(<PlayerSummaryContent data={data} metric={metric} status="ready" />);
    expect(html).toContain("2026-09-01"); expect(html).toContain("2026-09-30"); expect(html).toContain("UTC");
    expect(html).toContain("Recorded through 2026-09-30"); expect(html).toContain("Not collected"); expect(html).not.toContain("0 min");
    expect(html).toContain("No workout status"); expect(html).toContain("Current club · Current team");
  });
  it("shows recorded zero usage when collection exists", () => {
    const html = renderToStaticMarkup(<PlayerSummaryContent data={data} metric={{ ...metric, usage: { ...metric.usage, collected: true } }} status="ready" />);
    expect(html).toContain("0 min"); expect(html).toContain("0 active days");
  });
  it.each(["excluded", "unavailable"] as const)("does not convert %s metrics into recorded zeros", status => {
    const html = renderToStaticMarkup(<PlayerSummaryContent data={data} metric={null} status={status} />);
    expect(html).toContain("does not mean zero activity"); expect(html).not.toContain("<dl");
    expect(html.includes("Excluded from reporting")).toBe(status === "excluded");
  });
  it("retains a clear retry and drops stale metrics during errors", () => {
    const html = renderToStaticMarkup(<PlayerSummaryContent data={null} metric={metric} status="error" error="Scope changed" onRetry={() => {}} />);
    expect(html).toContain('role="alert"'); expect(html).toContain("Retry summary"); expect(html).not.toContain("<dl");
  });
});
