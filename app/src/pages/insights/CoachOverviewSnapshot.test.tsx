import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoachOverviewSnapshot from "./CoachOverviewSnapshot";
import PlayerFilters from "./PlayerFilters";
import { expandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";

const request = expandedRequest("orgId=northfield&teamId=harbor&division=boys&usageStatus=returning&rosterSearch=Alex", new Date("2026-09-29T12:00:00Z"));
type ButtonProps = { children?: ReactNode; onClick?: () => void; disabled?: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join("");
}
function button(node: ReactNode, label: string): ButtonProps | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<ButtonProps>(child)) continue;
    if (child.type === "button" && text(child.props.children) === label) return child.props;
    const found = button(child.props.children, label);
    if (found) return found;
  }
}

describe("coach snapshot review destinations", () => {
  it.each([
    { label: "Review testing", status: "noRecordedTests", field: "testingStatus" as const, view: "testing", group: "testing" as const },
    { label: "Review workouts", status: "none", field: "workoutStatus" as const, view: "workouts", group: "workouts" as const },
  ])("keeps the $label destination equal to its shown population", ({ label, status, field, view, group }) => {
    const data = previewInsights(request, 0, "normal", "coach");
    const count = data[group].statuses.find(row => row.key === status)!.count;
    expect(count).toBeGreaterThan(0);
    let destination = request;
    const tree = CoachOverviewSnapshot({ data, onChange: patch => { destination = { ...request, ...patch }; } });
    const action = button(tree, label);
    expect(action?.disabled).toBe(false); action?.onClick?.();
    expect(destination).toMatchObject({ view, [field]: status, rosterSearch: "", division: "boys", usageStatus: "returning", orgId: request.orgId, teamId: request.teamId, startDate: request.startDate, endDate: request.endDate, testingWindow: request.testingWindow, timezone: request.timezone });
    const next = previewInsights(destination, 0, "normal", "coach");
    expect(next.roster.filtered).toBe(count);
    expect(next.pagination.total).toBe(count);
  });

  it("disables a zero-count review so replacing a conflicting status cannot widen the report", () => {
    const selected = { ...request, testingStatus: "fullyTested", workoutStatus: "completed" };
    const data = previewInsights(selected, 0, "normal", "coach");
    const tree = CoachOverviewSnapshot({ data, onChange: () => {} });
    expect(button(tree, "Review testing")?.disabled).toBe(true);
    expect(button(tree, "Review workouts")?.disabled).toBe(true);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('disabled="">Review testing</button>');
    expect(html).toContain('disabled="">Review workouts</button>');
  });

  it("distinguishes unavailable workout status from a player with recorded activity", () => {
    const selected = { ...request, division: "", usageStatus: "", workoutStatus: "none", rosterSearch: "" };
    const data = previewInsights(selected, 0, "normal", "coach");
    // A start in this period with an ending outside it retains status none.
    data.players[0].workouts.started = 1;
    data.workouts.started = 1;
    data.participation = { testingPlayers: 0, workoutPlayers: 1, anyPlayers: 1 };
    const html = renderToStaticMarkup(<CoachOverviewSnapshot data={data} onChange={() => {}} />);
    expect(html).toContain('<strong>1</strong> recorded workout activity');
    expect(html).toContain("with no available workout status in this period");
    expect(html).toContain("Missing records, unrecognized endings and workouts ending outside this period can fall here.");
    expect(html).not.toContain("with no workout activity");
    const filters = renderToStaticMarkup(<PlayerFilters data={data} request={selected} onChange={() => {}} />);
    expect(filters).toContain("No workout status");
    expect(data.players[0].workouts.status).toBe("none");
    expect(data.players[0].workouts.started).toBe(1);
  });
});
