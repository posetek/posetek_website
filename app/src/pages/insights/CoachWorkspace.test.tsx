import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import CoachRoster from "./CoachRoster";
import { CoachPercentile, assertCoachComparison } from "./CoachPlayer";
import type { CoachComparison } from "./CoachPlayer";
import { InsightTabs, InsightsControls } from "./InsightsPage";
import { expandedQuery, expandedRequest } from "./lib/expandedQuery";
import { assertReportScope, reportPayload, sameScope } from "./lib/expanded";
import { previewInsights } from "./lib/preview";

const request = expandedRequest("orgId=northfield&teamId=harbor&view=overview", new Date("2026-09-29T12:00:00Z"));
const data = previewInsights(request, 0, "normal", "coach");
const comparison: CoachComparison = { schemaVersion: 1, scope: data.scope, player: { id: "player", firstName: "Alex", lastName: "Example", age: 14 }, period: data.period, testingMode: "cumulative", generatedAtMillis: 1, freshness: { complete: true }, roster: data.roster, axes: [{ key: "power", label: "Power", percentile: 75, measuredScore: 80, sampleCount: 4, status: "measured" }, { key: "speed", label: "Speed", percentile: null, measuredScore: 90, sampleCount: 1, status: "insufficientComparison" }, { key: "agility", label: "Agility", percentile: null, measuredScore: null, sampleCount: 3, status: "unmeasured" }] };

describe("unified coach workspace", () => {
  it("retains scope, roster selection and Community links through tab navigation", () => {
    const selected = expandedRequest("orgId=club&teamId=team&view=community&playerId=p&rosterSearch=Alex&page=2&cursor=opaque&panel=people&connect=c&activity=a", new Date("2026-09-29T12:00:00Z"));
    const next = expandedRequest(expandedQuery(selected, { view: "player" }).toString(), new Date("2026-09-29T12:00:00Z"));
    expect(next).toMatchObject({ view: "player", playerId: "p", rosterSearch: "Alex", page: 2, cursor: "opaque", extra: { panel: "people", connect: "c", activity: "a" } });
  });
  it("keeps independent scope identity on readback but never sends a caller-selectable coach", () => {
    expect(reportPayload(request, { kind: "coachRoster", coachId: "bound-coach" }).scope).toEqual({ kind: "coachRoster" });
    expect(sameScope({ kind: "coachRoster", coachId: "a" }, { kind: "coachRoster", coachId: "b" })).toBe(false);
    expect(sameScope({ kind: "coachRoster" }, { kind: "coachRoster", coachId: "b" })).toBe(true);
  });
  it("sends name search only for roster rows and rejects another search response", () => {
    expect(reportPayload({ ...request, rosterSearch: "Alex" }, data.scope)).toMatchObject({ nameSearch: "Alex", filters: {} });
    expect(() => assertReportScope(data, data.scope, { ...request, rosterSearch: "Alex" })).toThrow();
    const searched = previewInsights({ ...request, rosterSearch: "Alex" }, 0, "normal", "coach");
    expect(searched.testing).toEqual(data.testing);
    expect(searched.workouts).toEqual(data.workouts);
    expect(searched.pagination.total).toBeLessThan(data.pagination.total);
  });
  it("shows requested coach tabs and one named, closable player tab", () => {
    const html = renderToStaticMarkup(<InsightTabs coach request={{ ...request, playerId: "player", view: "player" }} playerName="Alex Example" onChange={() => {}} onClosePlayer={() => {}} />);
    for (const label of ["Overview", "Testing", "Workouts", "Active use", "Community", "Alex Example"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('aria-label="Close Alex Example tab"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<InsightTabs request={request} onChange={() => {}} />)).not.toContain(">Community</button>");
  });
  it("keeps the coach roster compact, uses backend age and preserves invitation controls", () => {
    const rows = { ...data, players: [{ ...data.players[0], age: null }] };
    const html = renderToStaticMarkup(<MemoryRouter><CoachRoster preview data={rows} search="" page={0} onSearch={() => {}} onPrevious={() => {}} onNext={() => {}} playerLink={player => `/insights?view=player&playerId=${player.id}`} /></MemoryRouter>);
    for (const label of ["Age", "Testing", "Workouts completed", "Estimated active use", "Signup actions"]) expect(html).toContain(`>${label}</th>`);
    expect(html).not.toContain(">Team</th>"); expect(html).not.toContain("Division · age");
    expect(html).toContain("Not recorded"); expect(html).toContain("view=player");
  });
  it("does not offer a merged team scope to an assigned coach", () => {
    const html = renderToStaticMarkup(<InsightsControls coach choices={data.choices} request={request} scope={data.scope} loading={false} onChange={() => {}} onRefresh={() => {}} />);
    expect(html).not.toContain("All assigned teams"); expect(html).toContain("Harbor U15");
  });
  it("rejects stale player, scope, period, timezone, and incomplete comparison responses", () => {
    const selected = { ...request, playerId: "player" };
    expect(() => assertCoachComparison(comparison, data.scope, selected)).not.toThrow();
    for (const patch of [{ playerId: "other" }, { startDate: "2026-01-01" }, { timezone: "UTC" }, { testingWindow: "period" as const }]) expect(() => assertCoachComparison(comparison, data.scope, { ...selected, ...patch })).toThrow();
    expect(() => assertCoachComparison(comparison, { kind: "team", organizationId: "northfield", teamId: "other" }, selected)).toThrow();
    expect(() => assertCoachComparison({ ...comparison, freshness: { complete: false } }, data.scope, selected)).toThrow();
  });
  it("keeps unavailable percentile axes explicit and never draws them as zero", () => {
    const html = renderToStaticMarkup(<CoachPercentile data={comparison} />);
    expect(html).toContain("Team percentile"); expect(html).toContain("Insufficient comparison data"); expect(html).toContain("No measured result");
    expect(html).not.toContain('class="coach-radar-result"');
    expect(html.match(/class="coach-radar-point"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<CoachPercentile data={{ ...comparison, scope: { kind: "coachRoster" } }} />)).toContain("Roster percentile");
  });
});
