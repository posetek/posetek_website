import { describe, expect, it } from "vitest";
import { expandedRequest } from "./expandedQuery";
import { previewInsights, previewInsightPlayer, previewPlayerSummary } from "./preview";

const request = expandedRequest("orgId=northfield&teamId=harbor", new Date("2026-10-07T12:00:00Z"));
describe("coach preview scope and source alignment", () => {
  it("preserves best D1 standing when testing coverage changes", () => {
    const cumulative = previewInsights(request, 0, "normal", "coach");
    const period = previewInsights({ ...request, testingWindow: "period" }, 0, "normal", "coach");
    for (const player of cumulative.players) expect(period.players.find(row => row.id === player.id)?.performance).toEqual(player.performance);
    expect(period.players.some(player => player.testing.exercisesComplete !== cumulative.players.find(row => row.id === player.id)?.testing.exercisesComplete)).toBe(true);
  });
  it("finds the selected player beyond the visible page and ignores roster-only filters", () => {
    const secondPage = previewInsights({ ...request, orgId: undefined, teamId: undefined }, 1, "normal", "admin").players[0];
    expect(previewInsightPlayer({ ...request, orgId: undefined, teamId: undefined, rosterSearch: "not a player", division: "unknown" }, secondPage.id, "normal", "admin")?.id).toBe(secondPage.id);
    expect(previewInsightPlayer(request, "synthetic-49", "normal", "coach")).toBeUndefined();
    expect(previewInsightPlayer(request, "missing", "normal", "coach")).toBeUndefined();
    expect(previewInsightPlayer(request, "synthetic-2", "empty", "coach")).toBeUndefined();
  });
  it("never borrows the first fixture's plans, notes, reps or sessions", () => {
    const player = previewInsights(request, 0, "normal", "coach").players[2], summary = previewPlayerSummary(player);
    expect(summary.athlete).toMatchObject({ id: player.id, firstName: player.firstName, lastName: player.lastName });
    expect(summary.plan).toBeNull(); expect(summary.logs).toEqual([]); expect(summary.reps).toEqual([]);
  });
});
