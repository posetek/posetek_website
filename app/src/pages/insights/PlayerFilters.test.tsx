import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlayerFilters from "./PlayerFilters";
import InsightsPreview from "./InsightsPreview";
import { expandedQuery, expandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";

const request = expandedRequest("orgId=northfield&teamId=harbor&testingStatus=noRecordedTests&workoutStatus=none&rosterSearch=Alex&view=overview&testingWindow=period&timezone=UTC", new Date("2026-09-29T12:00:00Z"));

function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join("");
}
function clickButton(node: ReactNode, label: string): boolean {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
    if (child.type === "button" && text(child.props.children).startsWith(label)) { child.props.onClick?.(); return true; }
    if (clickButton(child.props.children, label)) return true;
  }
  return false;
}

afterEach(() => vi.unstubAllGlobals());

describe("shared Insights player filters", () => {
  it("keeps review filters visible on the compact coach Overview", () => {
    const search = `?preview=1&${expandedQuery(request)}`;
    vi.stubGlobal("window", { location: { search } });
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/insights${search}`]}><InsightsPreview /></MemoryRouter>);
    const data = previewInsights(request, 0, "normal", "coach");
    expect(html).toContain(`${data.roster.filtered} of ${data.roster.included} included players`);
    expect(html).toContain('aria-label="Active player filters"');
    expect(html).toContain("No recorded tests"); expect(html).toContain("No workout status");
    expect(html).toContain("Clear all filters"); expect(html).toContain('aria-label="Team snapshot"');
    expect(html).not.toContain("Worth reviewing");
    expect(html).not.toContain("coach-roster-disclosure");
    expect(html).toContain("coach-roster-search");
    expect(html).not.toContain("Testing coverage by exercise");
    expect(html).not.toContain("Players by team");
  });

  it("removes a selected chip without clearing the other filter, name search or report context", () => {
    let next = request;
    const controls = PlayerFilters({ data: previewInsights(request, 0, "normal", "coach"), request, onChange: patch => { next = expandedRequest(expandedQuery(request, patch).toString(), new Date("2026-09-29T12:00:00Z")); } });
    expect(clickButton(controls, "No recorded tests")).toBe(true);
    expect(next.testingStatus).toBe(""); expect(next.workoutStatus).toBe("none");
    expect(next).toMatchObject({ orgId: request.orgId, teamId: request.teamId, rosterSearch: "Alex", view: "overview", testingWindow: "period", timezone: "UTC", startDate: request.startDate, endDate: request.endDate });
  });

  it("clears reporting filters together while preserving name search, scope, window and dates", () => {
    const selected = { ...request, division: "girls", ageBand: "13-15", usageStatus: "active", usagePlatform: "both", usageFeature: "workout", teamAssignment: "assigned" };
    let next = selected;
    const controls = PlayerFilters({ data: previewInsights(selected, 0, "normal", "coach"), request: selected, onChange: patch => { next = { ...selected, ...patch }; } });
    expect(clickButton(controls, "Clear all filters")).toBe(true);
    expect(next).toMatchObject({ division: "", ageBand: "", testingStatus: "", workoutStatus: "", usageStatus: "", usagePlatform: "", usageFeature: "", teamAssignment: "", rosterSearch: "Alex", orgId: request.orgId, teamId: request.teamId, view: "overview", testingWindow: "period", timezone: "UTC", startDate: request.startDate, endDate: request.endDate });
  });

  it("reports the full reporting population rather than name-matched rows", () => {
    const unfiltered = { ...request, testingStatus: "", workoutStatus: "" };
    const data = previewInsights(unfiltered, 0, "normal", "coach");
    expect(data.pagination.total).toBeLessThan(data.roster.filtered);
    const html = renderToStaticMarkup(<PlayerFilters data={data} request={unfiltered} onChange={() => {}} />);
    expect(html).toContain(`${data.roster.filtered} of ${data.roster.included} included players`);
    expect(html).not.toContain("Clear all filters");
    expect(html).not.toContain('aria-label="Active player filters"');
  });
});
