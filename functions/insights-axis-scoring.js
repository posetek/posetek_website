"use strict";

const { axes, metrics } = require("./athlete-profile-spec.json");
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const mean = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

// The browser athlete profile uses this same specification and the same
// best-per-metric, mean-per-axis method. Only canonical effective reps enter here.
function measuredMetrics(rep) {
  if (!rep.resultStatus?.qualified || rep.resultStatus.duplicate || rep.failedAttempt) return {};
  const output = {};
  for (const metric of metrics) {
    if (metric.placeholder || !metric.drills.includes(rep.repType)) continue;
    const field = metric.fields.find(field => positive(rep[field]));
    if (field) output[metric.key] = rep[field];
  }
  return output;
}
function measuredAxes(events) {
  const scores = new Map();
  for (const metric of metrics) {
    if (metric.placeholder || !metric.reference) continue;
    const values = events.filter(event => event.qualified && !event.duplicate && metric.drills.includes(event.drill))
      .map(event => event.profileMetrics?.[metric.key]).filter(positive);
    if (!values.length) continue;
    const best = metric.direction === "lower" ? Math.min(...values) : Math.max(...values);
    const reference = metric.reference * (1 / (metric.divisor || 1));
    scores.set(metric.key, 100 * (metric.direction === "lower" ? reference / best : best / reference));
  }
  return axes.map(axis => ({ key: axis.key, label: axis.label,
    measuredScore: mean(metrics.filter(metric => metric.axis === axis.key && scores.has(metric.key)).map(metric => scores.get(metric.key))) }));
}
function overallD1(events) {
  const measured = measuredAxes(events).map(axis => axis.measuredScore).filter(value => value !== null);
  return mean(measured);
}
function recentD1Change(events, timeZone = "UTC") {
  const days = new Map();
  for (const event of events) {
    if (!event.qualified || !Number.isFinite(event.at) || !event.profileMetrics) continue;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(event.at));
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(event);
  }
  const snapshots = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, score: overallD1(rows) })).filter(row => row.score !== null);
  if (snapshots.length < 2) return { current: snapshots.at(-1)?.score ?? null, change: null, lastTestDate: snapshots.at(-1)?.date ?? null };
  const [previous, current] = snapshots.slice(-2);
  return { current: current.score, change: current.score - previous.score, lastTestDate: current.date, previousTestDate: previous.date };
}
function comparePlayer(rows, playerId) {
  const profiles = rows.map(row => ({ id: row.id, axes: measuredAxes(row.selected) }));
  const selected = profiles.find(row => row.id === playerId);
  return selected.axes.map(axis => {
    const cohort = profiles.map(row => row.axes.find(value => value.key === axis.key).measuredScore).filter(value => value !== null);
    const sampleCount = cohort.length;
    if (axis.measuredScore === null) return { ...axis, percentile: null, sampleCount, status: "unmeasured" };
    if (sampleCount < 2) return { ...axis, percentile: null, sampleCount, status: "insufficientComparison" };
    const below = cohort.filter(value => value < axis.measuredScore).length;
    const tied = cohort.filter(value => value === axis.measuredScore).length;
    const percentile = 100 * (below + (tied - 1) / 2) / (sampleCount - 1);
    return { ...axis, percentile, sampleCount, status: "measured" };
  });
}
module.exports = { measuredMetrics, measuredAxes, overallD1, recentD1Change, comparePlayer };
