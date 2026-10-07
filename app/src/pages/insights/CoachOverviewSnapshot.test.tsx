import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoachOverviewSnapshot from "./CoachOverviewSnapshot";
import PlayerFilters from "./PlayerFilters";
import { expandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";

const request = expandedRequest("orgId=northfield&teamId=harbor&division=boys&usageStatus=returning&rosterSearch=Alex", new Date("2026-09-29T12:00:00Z"));
describe("coach snapshot", () => {
  it("keeps the snapshot player links without the removed review section", () => {
    const data = previewInsights(request, 0, "normal", "coach");
    const html = renderToStaticMarkup(<MemoryRouter><CoachOverviewSnapshot data={data} /></MemoryRouter>);
    expect(html).toContain("Team snapshot");
    expect(html).toContain("view=player");
    expect(html).not.toContain("Worth reviewing");
    expect(html).not.toContain("Review testing");
    expect(html).not.toContain("Review workouts");
  });

  it("distinguishes unavailable workout status from a player with recorded activity", () => {
    const selected = { ...request, division: "", usageStatus: "", workoutStatus: "none", rosterSearch: "" };
    const data = previewInsights(selected, 0, "normal", "coach");
    // A start in this period with an ending outside it retains status none.
    data.players[0].workouts.started = 1;
    data.workouts.started = 1;
    data.participation = { testingPlayers: 0, workoutPlayers: 1, anyPlayers: 1 };
    const html = renderToStaticMarkup(<MemoryRouter><CoachOverviewSnapshot data={data} /></MemoryRouter>);
    expect(html).toContain('<strong>1</strong> recorded workout activity');
    expect(html).toContain("No workout status");
    expect(html).not.toContain("Missing records, unrecognized endings and workouts ending outside this period can fall here.");
    expect(html).not.toContain("with no workout activity");
    const filters = renderToStaticMarkup(<PlayerFilters data={data} request={selected} onChange={() => {}} />);
    expect(filters).toContain("No workout status");
    expect(data.players[0].workouts.status).toBe("none");
    expect(data.players[0].workouts.started).toBe(1);
  });
});
