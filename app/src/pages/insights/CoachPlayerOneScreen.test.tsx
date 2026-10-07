import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CoachPlayerOneScreen from "./CoachPlayerOneScreen";
import { coachPlanLabel, coachSessionRows } from "./lib/coachPlayerSummary";
import type { AthleteSummary } from "../coach-dashboard/lib/logic";
import type { ExpandedPlayer } from "./lib/expanded";

const now = Date.parse("2026-10-07T06:30:00Z");
const plan = { id: "plan", planId: "plan", status: "active", schemaVersion: 3, startDate: "2026-09-29", timezone: "America/Los_Angeles", horizonWeeks: 6, sessionsPerWeek: 1,
  intake: { trainingContext: { startDate: "2026-09-29", scheduleConfirmed: true, sessionDays: [2] } },
  weeks: [1, 2, 3].map(weekNumber => ({ weekNumber, workouts: [{ workoutId: `w${weekNumber}`, order: 1, title: "Recorded prescription" }] })), notes: "Generic AI plan description" };
const summary = { athlete: { firstName: "Alex", lastName: "Example" }, profile: { overall: 999 }, reps: [{ createdAtMillis: 0 }, { createdAtMillis: now + 1000 }], plan, logs: [] } as unknown as AthleteSummary;
const performance: NonNullable<ExpandedPlayer["performance"]> = { d1: 92, change: -46, lastTestDate: "2026-09-16", previousTestDate: "2026-09-09", activePlan: true, sessionsDone: 1, sessionsPlanned: 2, planAgeDays: 8, needsYouReasons: ["D1 down at least 5 points"] };
const render = (value: ExpandedPlayer["performance"] = performance) => renderToStaticMarkup(<CoachPlayerOneScreen summary={summary} performance={value}
  testScores={[{ drill: "sprint", score: 46, change: -46, lastTestDate: "2026-09-16", previousTestDate: "2026-09-09" }]}
  generatedAtMillis={now} period={{ endDate: "2026-09-16", timeZone: "UTC" }} onPrescribe={() => {}} />);

describe("authoritative coach player summary", () => {
  it("matches roster standing and follow-up while distinguishing latest test score", () => {
    const html = render();
    expect(html).toContain("92%"); expect(html).toContain("46%"); expect(html).toContain("▼ −46"); expect(html).not.toContain("999%");
    expect(html).toContain("best measured results through 2026-09-16"); expect(html).toContain("latest two test dates in UTC");
    expect(html).toContain("D1 down at least 5 points"); expect(html).not.toContain("missed scheduled sessions");
    expect(html).toContain("Training / 14 days"); expect(html).toContain("Last 14 days"); expect(html).toContain("week 2 of 6");
  });
  it("never replaces absent additive fields with raw current data or no-follow-up claims", () => {
    const html = renderToStaticMarkup(<CoachPlayerOneScreen summary={summary} generatedAtMillis={now} onPrescribe={() => {}} />);
    for (const label of ["Standing unavailable", "Change unavailable", "Training unavailable", "Follow-up unavailable", "Test summary unavailable"]) expect(html).toContain(label);
    expect(html).not.toContain("999%"); expect(html).not.toContain("No active plan"); expect(html).not.toContain("Nothing flagged"); expect(html).not.toContain("1970");
  });
  it("preserves observed zero/null values and never invents a coach note or retest date", () => {
    const html = render({ ...performance, d1: 0, change: 0, sessionsDone: 0, sessionsPlanned: 0, needsYouReasons: [] });
    expect(html).toContain("0%"); expect(html).toContain("Same"); expect(html).toContain("Nothing flagged"); expect(html).toContain("No coach note recorded");
    expect(html).not.toContain("Generic AI plan description"); expect(html).toContain("Not scheduled");
    expect(render({ ...performance, sessionsPlanned: null })).toContain("Schedule unavailable");
    expect(render({ ...performance, sessionsDone: null })).toContain("Completion unavailable");
    expect(render({ ...performance, activePlan: false })).toContain("No active plan");
  });
});

describe("current plan calendar and session evidence", () => {
  it("uses plan timezone and intake start rather than host date or a conflicting legacy start", () => {
    const selected = { ...plan, startDate: "2026-09-20", intake: { trainingContext: { ...plan.intake.trainingContext, startDate: "2026-09-30" } } };
    expect(coachPlanLabel(selected, now)).toBe("1 per week · week 1 of 6");
    expect(coachPlanLabel({ ...selected, timezone: "UTC" }, now)).toBe("1 per week · week 2 of 6");
    expect(coachPlanLabel({ ...plan, timezone: "invalid/zone" }, now)).toContain("schedule unavailable");
    expect(coachPlanLabel({ ...plan, timezone: null }, now)).toContain("schedule unavailable");
    expect(coachPlanLabel({ ...plan, timezone: undefined }, now)).toBe("1 per week · week 2 of 6");
    expect(coachPlanLabel({ ...plan, intake: { trainingContext: { startDate: "2026-10-20" } } }, now)).toContain("starts Oct 20");
  });
  it("does not treat future, undated, zero-time or inverted endings as completed sessions", () => {
    const rows = coachSessionRows({ ...summary, plan: null, logs: [
      { id: "future", startedAt: now, endedAt: now + 1, endReason: "completed" },
      { id: "zero", startedAt: 0, endedAt: 0, endReason: "completed" },
      { id: "undated", endReason: "completed" },
      { id: "inverted", startedAt: now, endedAt: now - 1, endReason: "completed" },
      { id: "done", startedAt: now - 2000, endedAt: now - 1000, endReason: "completed" },
      { id: "abandoned", startedAt: now - 4000, endedAt: now - 3000, endReason: "abandoned" },
    ] }, now, "UTC");
    expect(rows.map(row => row.status).sort()).toEqual(["Abandoned", "Done"]); expect(rows.every(row => row.date === "2026-10-07")).toBe(true);
  });
  it("requires confirmed weekday slots and suppresses attempted slots without fabricating missed sessions", () => {
    const asOf = Date.parse("2026-10-08T12:00:00Z");
    const confirmed = coachSessionRows(summary, asOf, "UTC");
    expect(confirmed.map(row => row.status)).toContain("Missed");
    const attempted = coachSessionRows({ ...summary, logs: [{ planId: "plan", workoutId: "w2", startedAt: asOf - 86400000, endReason: "endedEarly" }] }, asOf, "UTC");
    expect(attempted.some(row => row.id.includes("w2"))).toBe(false);
    expect(coachSessionRows({ ...summary, plan: { ...plan, intake: { trainingContext: { ...plan.intake.trainingContext, scheduleConfirmed: false } } } }, asOf, "UTC")).toEqual([]);
    expect(coachSessionRows({ ...summary, plan: { ...plan, timezone: "invalid/zone" } }, asOf, "UTC")).toEqual([]);
    expect(coachSessionRows({ ...summary, plan: { ...plan, timezone: null } }, asOf, "UTC")).toEqual([]);
  });
  it("uses the reporting timezone for sessions without a plan", () => {
    const value = { ...summary, plan: null, logs: [{ id: "done", startedAt: now - 2000, endedAt: now - 1000, endReason: "completed" }] };
    expect(coachSessionRows(value, now, "America/Los_Angeles")[0].date).toBe("2026-10-06");
    expect(coachSessionRows(value, now, "invalid/zone")[0].date).toBe("2026-10-07");
  });
  it("accepts canonical plan aliases and rejects colliding legacy log identities", () => {
    const asOf = Date.parse("2026-10-08T12:00:00Z"), value = { ...summary, plan: { ...plan, id: "document", planId: "authored" } };
    for (const planId of ["document", "authored"]) {
      const logs = [{ id: `${planId}_w2`, planId, workoutId: "w2", startedAt: asOf - 86400000 }];
      expect(coachSessionRows({ ...value, logs }, asOf, "UTC").some(row => row.id.includes("w2"))).toBe(false);
      expect(coachSessionRows({ ...value, logs: [{ ...logs[0], id: "colliding_legacy" }] }, asOf, "UTC").some(row => row.id.includes("w2"))).toBe(true);
    }
  });
});
