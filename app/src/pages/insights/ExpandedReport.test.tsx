import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ExpandedReport from "./ExpandedReport";
import { expandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";
import type { ExpandedRequest } from "./lib/expandedQuery";
const base = expandedRequest("", new Date("2026-09-17T04:00:00Z"));
const render = (request: ExpandedRequest = base, page = 0, state = "normal") => renderToStaticMarkup(<MemoryRouter><ExpandedReport data={previewInsights(request, page, state)} request={request} page={page} onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={player => `/athlete?player=${player.id}&orgId=${player.organizationId}&teamId=${player.teamId || ""}`} /></MemoryRouter>);
describe("four-view Insights report", () => {
  it("keeps totals independent of the displayed player page", () => {
    const first = previewInsights(base), next = previewInsights(base, 1);
    expect(first.players).toHaveLength(25); expect(next.players).toHaveLength(25);
    expect(first.players[0].id).not.toBe(next.players[0].id);
    expect(first.roster).toEqual(next.roster); expect(first.testing).toEqual(next.testing);
    expect(render(base, 1)).toContain("26–50 of 84"); expect(render()).toContain("84 matching players");
  });
  it("shows current division rather than inferred gender and retains unknown age", () => {
    const html = render(); expect(html).toContain("Verified roster classification, not gender");
    expect(html).toContain("Missing or stale age is Unknown"); expect(html).toContain("Players by team");
  });
  it("qualifies six exercises and labels cumulative versus period separately", () => {
    const html = render({ ...base, view: "testing" });
    expect(html).toContain("All six exercises"); expect(html).toContain("Cumulative through 2026-09-16");
    expect(html).toContain("No qualified result"); expect(html).toContain("Duplicate documents");
    expect(render({ ...base, view: "testing", testingWindow: "period" })).toContain("In selected period");
  });
  it("does not call unfinished logs currently training or sum timing sources", () => {
    const html = render({ ...base, view: "workouts" }); expect(html).toContain("No ending record");
    expect(html).toContain("A completed workout log may still contain skipped or partial blocks");
    expect(html).toContain("Timer duration and estimated duration have different sources and are not added together");
    expect(html).toContain("All prescribed sets recorded");
  });
  it("shows missing usage as not collected including platform charts", () => {
    const html = render({ ...base, view: "usage" }, 0, "uncollected");
    expect(html).toContain("Website: Not collected · iOS app: Not collected");
    expect(html).toContain("Earlier time cannot be reconstructed"); expect(html).not.toContain("NaN");
  });
  it("filters on server-equivalent dimensions rather than the current page only", () => {
    const request = { ...base, division: "girls", usagePlatform: "both", view: "usage" as const };
    const data = previewInsights(request);
    expect(data.pagination.total).toBeLessThan(84); expect(data.players.every(row => row.division === "girls" && row.usage.iosMinutes > 0)).toBe(true);
    expect(render(request)).toContain("Both at once"); expect(render(request)).toContain("Clear all filters");
  });
  it("does not expose other clubs or unassigned athletes to an assigned coach preview", () => {
    const data = previewInsights({ ...base, orgId: "northfield" }, 0, "normal", "coach");
    expect(data.choices.global).toBe(false); expect(data.choices.organizations).toHaveLength(1);
    expect(data.players.every(row => row.teamId === "harbor")).toBe(true);
  });
  it("offers useful empty states without invalid percentages", () => {
    const html = render(base, 0, "empty"); expect(html).toContain("No players match these filters"); expect(html).not.toContain("NaN"); expect(html).toContain("0 players");
  });
  it("flags undated attempts separately from dated coverage", () => {
    const data = previewInsights(base);
    data.players[0].testing = { ...data.players[0].testing, status: "noSuccessfulTests", hasDateUnknownAttempts: true, dateUnknownAttempts: 1 };
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={data} request={base} onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#player"} /></MemoryRouter>);
    expect(html).toContain("Date unknown · needs review");
  });
  it("shows all workout outcomes with independent event and evidence coverage denominators", () => {
    const request = { ...base, view: "workouts" as const }, data = previewInsights(request);
    data.workouts = { ...data.workouts, started: 4, completed: 1, endedEarly: 1, inProgress: 3, abandoned: 0, unknownEnding: 0, outcomeEvents: 5, timerRecords: 1, estimatedRecords: 1, unknownDuration: 3, knownPrescription: 2, unknownPrescription: 3, allPrescribedSetsCompleted: 1 };
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={data} request={request} onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#player"} /></MemoryRouter>);
    expect(html).toContain("Workout outcomes"); expect(html).toContain("5 distinct workout logs");
    expect(html).toContain("Completed as logged"); expect(html).toContain("1/5 logs with timers");
    expect(html).toContain("3/5 logs have unknown duration"); expect(html).toContain("2/5 logs have a known prescription");
    expect(html).toContain("different outcomes for the same player");
  });
  it("keeps selected-period diagnostic failures separate from saved recording attempts", () => {
    const html = render({ ...base, view: "testing" });
    expect(html).toContain("Distinct recorded attempts"); expect(html).toContain("Failure reports");
    expect(html).toContain("Linked to recorded reps"); expect(html).toContain("Unmatched reports");
    expect(html).toContain("They are not added to recording documents");
  });
  it("uses server-provided participation union and the requested product terminology", () => {
    const data = previewInsights(base); data.participation = { testingPlayers: 4, workoutPlayers: 3, anyPlayers: 5 };
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={data} request={base} onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#player"} /></MemoryRouter>);
    expect(html).toContain("5/84 players"); expect(html).toContain("The combined count includes each player once");
    expect(html).toContain("Boys/Girls divisions"); expect(html).toContain("Estimated active use");
  });
  it("adds the admin overview triage panel and daily KPI trends without changing report totals", () => {
    const data = previewInsights(base);
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={data} request={base} adminOverview onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#player"} /></MemoryRouter>);
    expect(html).toContain("Needs attention");
    expect(html).toContain("reps need review");
    expect(html).toContain("unmatched failure reports");
    expect(html).toContain("players not tested");
    expect(html).toContain('href="/admin/analysis"');
    expect(html).toContain('aria-label="Daily completed workouts"');
    expect(html).toContain("Players by team");
    expect(html).toContain("84 matching players");
  });
  it("puts the admin roster after summary and attention, before detailed breakdowns", () => {
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={previewInsights(base)} request={base} adminOverview onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "/admin/accounts/player/sample/results"} /></MemoryRouter>);
    expect(html.indexOf('aria-label="overview summary"')).toBeLessThan(html.indexOf("Needs attention"));
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf('id="insights-players-heading"'));
    expect(html.indexOf('id="insights-players-heading"')).toBeLessThan(html.indexOf("Detailed breakdowns"));
    expect(html.indexOf("Detailed breakdowns")).toBeLessThan(html.indexOf("Testing coverage"));
    expect(html.match(/id="insights-players-heading"/g)).toHaveLength(1);
    expect(render().indexOf('id="insights-players-heading"')).toBeGreaterThan(render().indexOf("Players by team"));
  });
  it("labels general technique review honestly without forwarding unsupported scope filters", () => {
    const request = { ...base, orgId: "northfield", teamId: "harbor" };
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={previewInsights(request)} request={request} adminOverview onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#player"} /></MemoryRouter>);
    expect(html).toContain('href="/admin/analysis"');
    expect(html).not.toContain('/admin/analysis?');
    expect(html).toContain("General technique review");
    expect(html).toContain("these counts are not a filtered queue");
    expect(html).toContain("Show these players");
    expect(html).not.toContain('href="/admin/accounts');
  });
  it("disables the exact no-recorded-tests action when there are no matching players", () => {
    const data = previewInsights(base);
    data.testing.statuses = data.testing.statuses.map(row => row.key === "noRecordedTests" ? { ...row, count: 0 } : row);
    const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={data} request={base} adminOverview onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={() => "#player"} /></MemoryRouter>);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Show these players<\/button>/);
  });
  it("offers one-action Workouts and Profile beside admin player names in every report view", () => {
    for (const view of ["overview", "testing", "workouts", "usage"] as const) {
      const request = { ...base, view };
      const html = renderToStaticMarkup(<MemoryRouter><ExpandedReport data={previewInsights(request)} request={request} adminOverview onChange={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={player => `/admin/accounts/player/${player.id}/results`} playerActionLink={(player, tab) => `/admin/accounts/player/${player.id}/${tab}`} /></MemoryRouter>);
      expect(html).toContain('/workouts"');
      expect(html).toContain('/profile"');
      expect(html).toContain('class="insights-player-actions"');
      expect(html.match(/id="insights-players-heading"/g)).toHaveLength(1);
    }
    expect(render()).not.toContain('class="insights-player-actions"');
  });
});
