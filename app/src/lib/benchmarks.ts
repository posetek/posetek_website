import { finiteNumber } from "./result-values";
import profileSpec from "../../../functions/athlete-profile-spec.json";
// Port of athlete-benchmarks.js (window.PoseTekBenchmarks). Pure data + math, no DOM.


export interface BenchmarkMetric {
  label: string;
  reference: number | null;
  direction: "higher" | "lower";
  format: (value: number) => string;
  placeholder: boolean;
}

function seconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

function metric(
  key: string,
  label: string,
  format: (value: number) => string,
): BenchmarkMetric {
  const spec = profileSpec.metrics.find(metric => metric.key === key)!;
  const reference = spec.reference === null ? null : spec.reference * (1 / (spec.divisor || 1));
  const direction = spec.direction as "higher" | "lower";
  return Object.freeze({ label, reference, direction, format, placeholder: spec.placeholder === true });
}

export const metrics = Object.freeze({
  ballSpeed: metric("ballSpeed", "Ball Speed", value => `${(value * 2.23694).toFixed(1)} mph`),
  shotAccuracy: metric("shotAccuracy", "Accuracy", value => `${value.toFixed(0)}%`),
  broadJumpDistance: metric("broadJumpDistance", "Broad Jump", value => `${(value * 3.28084).toFixed(1)} ft`),
  verticalJumpHeight: metric("verticalJumpHeight", "Vertical Jump", value => `${(value * 39.37007874015748).toFixed(1)} in`),
  sprintMaxAcceleration: metric("sprintMaxAcceleration", "Acceleration", value => `${value.toFixed(1)} m/s²`),
  sprintMaxSpeed: metric("sprintMaxSpeed", "Max Speed", value => `${(value * 2.23694).toFixed(1)} mph`),
  sprintCompletionTime: metric("sprintCompletionTime", "Time to Complete", seconds),
  dribbleTotalTime: metric("dribbleTotalTime", "Completion Time", seconds),
  dribbleBallControl: metric("dribbleBallControl", "Ball Proximity", value => `${(value * 3.28084).toFixed(1)} ft`),
  dribbleOutboundTime: metric("dribbleOutboundTime", "Outbound", seconds),
  dribbleTurnTime: metric("dribbleTurnTime", "Turn", seconds),
  dribbleReturnTime: metric("dribbleReturnTime", "Return", seconds),
  codTotalTime: metric("codTotalTime", "Total Time", seconds),
  codOutboundTime: metric("codOutboundTime", "Outbound", seconds),
  codTurnTime: metric("codTurnTime", "Turn", seconds),
  codReturnTime: metric("codReturnTime", "Return", seconds),
} as const);

export type BenchmarkKey = keyof typeof metrics;

export function get(key: string): BenchmarkMetric | null {
  return (metrics as Record<string, BenchmarkMetric>)[key] || null;
}

export function score(key: string, value: unknown): number | null {
  const definition = get(key);
  const measured = finiteNumber(value);
  if (!definition || measured === null || measured <= 0 || !definition.reference) return null;
  return 100 * (definition.direction === "lower" ? definition.reference / measured : measured / definition.reference);
}

export function format(key: string, value: unknown): string {
  const definition = get(key);
  const measured = finiteNumber(value);
  return definition && measured !== null ? definition.format(measured) : "—";
}

export const generation = 2;
export const profile = "senior|unspecified";

export default { generation, profile, metrics, get, score, format };
