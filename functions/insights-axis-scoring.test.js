"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { overallD1, recentD1Change, recentDrillScores } = require("./insights-axis-scoring");
const { EXERCISES } = require("./insights-v2-qualification");
const sprint = (at, seconds, extra = {}) => ({ at, drill: "sprint", qualified: 1,
  profileMetrics: { sprintCompletionTime: seconds }, ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

test("standing keeps the best qualified history while a drill trend uses its latest two measured dates", () => {
  const events = [sprint(Date.UTC(2026, 9, 4, 12), 2), sprint(Date.UTC(2026, 9, 5, 12), 4),
    sprint(Date.UTC(2026, 9, 5, 13), 5)];
  close(overallD1(events), 92);
  const rows = recentDrillScores(events, "UTC"), row = rows.find(value => value.drill === "sprint");
  assert.deepEqual(rows.map(value => value.drill), EXERCISES);
  close(row.score, 46); assert.equal(row.change, -46);
  assert.equal(row.lastTestDate, "2026-10-05"); assert.equal(row.previousTestDate, "2026-10-04");
  assert.deepEqual(rows.find(value => value.drill === "jump"), { drill: "jump", score: null, change: null, lastTestDate: null, previousTestDate: null });
});
test("local midnight determines snapshots independently for each drill", () => {
  const events = [sprint(Date.UTC(2026, 9, 5, 6, 59), 2), sprint(Date.UTC(2026, 9, 5, 7), 4),
    { at: Date.UTC(2026, 9, 3, 12), drill: "jump", qualified: 1, profileMetrics: { verticalJumpHeight: 18 / 39.37007874015748 } }];
  const local = recentDrillScores(events, "America/Los_Angeles");
  assert.deepEqual(local.find(value => value.drill === "sprint"), { drill: "sprint", score: 46, change: -46,
    lastTestDate: "2026-10-05", previousTestDate: "2026-10-04" });
  const utc = recentDrillScores(events, "UTC").find(value => value.drill === "sprint");
  assert.equal(utc.score, 92); assert.equal(utc.change, null); assert.equal(utc.previousTestDate, null);
  assert.equal(local.find(value => value.drill === "jump").lastTestDate, "2026-10-03");
  assert.equal(local.find(value => value.drill === "jump").change, null);
});
test("unqualified, duplicate, undated, invalid and unmeasured rows cannot supply a testing date or score", () => {
  const valid = sprint(Date.UTC(2026, 9, 3, 12), 2);
  const invalid = [sprint(Date.UTC(2026, 9, 4, 12), 0.1, { qualified: 0 }),
    sprint(Date.UTC(2026, 9, 4, 12), 0.1, { duplicate: 1 }), sprint(null, 0.1), sprint(NaN, 0.1),
    sprint(Date.UTC(2026, 9, 4, 12), 0.1, { profileMetrics: {} }),
    { at: Date.UTC(2026, 9, 4, 12), drill: "shooting", qualified: 1, profileMetrics: { shotAccuracy: 100 } }];
  const current = recentD1Change([valid, ...invalid], "UTC");
  assert.equal(current.current, 92); assert.equal(current.lastTestDate, "2026-10-03"); assert.equal(current.change, null);
  assert.equal(recentDrillScores([valid, ...invalid]).find(value => value.drill === "sprint").score, 92);
  assert.equal(recentDrillScores([valid, ...invalid]).find(value => value.drill === "shooting").score, null);
});
