// Pure logic port of athlete-stats-view.js (window.PoseTekAthleteStats.buildProfile
// and its helpers): axes, metric slots, drill mapping, availability, and scoring via
// lib/benchmarks. No DOM — the markup/interactivity lives in AthleteStats.tsx.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { metricValue as effectiveMetric, resultUsable } from "../../lib/result-values";
import * as benchmarks from "../../lib/benchmarks";
import type { BenchmarkKey } from "../../lib/benchmarks";
import profileSpec from "../../../../functions/athlete-profile-spec.json";

export const RADAR_CEILING = 130;

export interface StatsAxis {
  key: string;
  label: string;
  icon: string;
  /** Human description of the drills feeding this axis (legacy `drills` string). */
  drills: string;
}

export const AXES: StatsAxis[] = profileSpec.axes;

export interface StatsMetricDefinition {
  key: BenchmarkKey;
  axis: string;
  drills: string[];
  fields: string[];
  label: string;
  reference: number | null;
  lowerIsBetter: boolean;
  placeholder: boolean;
  format: (value: unknown) => string;
}

export interface StatsMetricResult extends StatsMetricDefinition {
  best: number;
  score: number;
  repCount: number;
  delta: number | null;
}

export interface StatsSection {
  key: string;
  title: string;
  icon: string;
  reps: any[];
  slots: StatsMetricDefinition[];
  availableByKey: Map<string, StatsMetricResult>;
  metrics: StatsMetricResult[];
  score: number | null;
}

export interface ProfileAxis extends StatsAxis {
  score: number | null;
  repCount: number;
}

export interface AthleteProfile {
  axes: ProfileAxis[];
  overall: number | null;
  totalReps: number;
  totalSessions: number;
  sections: Record<string, StatsSection>;
}

export const METRICS: StatsMetricDefinition[] = profileSpec.metrics.map(metric =>
  definition(metric.key as BenchmarkKey, metric.axis, metric.drills, metric.fields));

function definition(key: BenchmarkKey, axis: string, drills: string[], fields: string[]): StatsMetricDefinition {
  const benchmark = benchmarks.metrics[key];
  return {
    key,
    axis,
    drills,
    fields,
    label: benchmark.label,
    reference: benchmark.reference,
    lowerIsBetter: benchmark.direction === "lower",
    placeholder: benchmark.placeholder,
    format: (value: unknown) => benchmarks.format(key, value)
  };
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function drillFor(rep: any): string {
  return rep._statsDrill || rep.repType || rep.drillType;
}

function metricValue(rep: any, definition: StatsMetricDefinition): number | null {
  for (const field of definition.fields) {
    const value = effectiveMetric(rep, field);
    if (value !== null) return value;
  }
  return null;
}

function scoreDelta(reps: any[], definition: StatsMetricDefinition): number | null {
  const values = [...reps]
    .sort((left, right) => (left.createdAtMillis || 0) - (right.createdAtMillis || 0))
    .map(rep => metricValue(rep, definition))
    .filter((value): value is number => value !== null)
    .map(value => benchmarks.score(definition.key, value) as number);
  if (values.length < 2) return null;
  const split = Math.floor(values.length / 2);
  const recent = mean(values.slice(split));
  const earlier = mean(values.slice(0, split));
  return recent === null || earlier === null ? null : recent - earlier;
}

function bestMetric(reps: any[], definition: StatsMetricDefinition): StatsMetricResult | null {
  if (definition.placeholder || !definition.reference) return null;
  const values = reps.map(rep => metricValue(rep, definition)).filter((value): value is number => value !== null);
  if (!values.length) return null;
  const best = definition.lowerIsBetter ? Math.min(...values) : Math.max(...values);
  return {
    ...definition,
    best,
    score: benchmarks.score(definition.key, best) as number,
    repCount: values.length,
    delta: scoreDelta(reps, definition)
  };
}

export function sessionCount(reps: any[]): number {
  return new Set(reps.map(rep => `${rep._statsDrill || rep.repType || rep.drillType}:${rep.sessionNumber || 1}`)).size;
}

export function buildProfile(sourceReps: any[]): AthleteProfile {
  const reps = sourceReps.filter(resultUsable);
  const sections: Record<string, StatsSection> = {};
  AXES.forEach(axis => {
    const slots = METRICS.filter(metric => metric.axis === axis.key);
    const drillKeys = new Set(slots.flatMap(metric => metric.drills));
    const sectionReps = reps.filter(rep => drillKeys.has(drillFor(rep)));
    const availableByKey = new Map<string, StatsMetricResult>();
    slots.forEach(slot => {
      const metricReps = sectionReps.filter(rep => slot.drills.includes(drillFor(rep)));
      const result = bestMetric(metricReps, slot);
      if (result) availableByKey.set(slot.key, result);
    });
    const availableMetrics = slots
      .map(slot => availableByKey.get(slot.key))
      .filter((metric): metric is StatsMetricResult => Boolean(metric));
    sections[axis.key] = {
      key: axis.key,
      title: axis.label,
      icon: axis.icon,
      reps: sectionReps,
      slots,
      availableByKey,
      metrics: availableMetrics,
      score: mean(availableMetrics.map(metric => metric.score))
    };
  });
  const axes: ProfileAxis[] = AXES.map(axis => ({
    ...axis,
    score: sections[axis.key].score,
    repCount: sections[axis.key].reps.length
  }));
  const scoredAxes = axes.filter(axis => axis.score !== null);
  return {
    axes,
    overall: mean(scoredAxes.map(axis => axis.score as number)),
    totalReps: reps.length,
    totalSessions: sessionCount(reps),
    sections
  };
}

export interface ScoreBand {
  key: string;
  label: string;
  icon: string;
}

export function band(scoreValue: number): ScoreBand {
  if (scoreValue >= 100) return { key: "standard", label: "At standard", icon: "verified" };
  if (scoreValue >= 85) return { key: "approaching", label: "Approaching", icon: "trending_up" };
  if (scoreValue >= 65) return { key: "developing", label: "Developing", icon: "monitoring" };
  return { key: "early", label: "Early stage", icon: "pending" };
}

export function formatHeight(value: unknown): string {
  const centimeters = number(value);
  if (centimeters === null) return "—";
  const totalInches = Math.round(centimeters / 2.54);
  return `${Math.floor(totalInches / 12)}' ${totalInches % 12}"`;
}

export function formatWeight(value: unknown): string {
  const kilograms = number(value);
  return kilograms === null ? "—" : `${Math.round(kilograms * 2.20462)} lbs`;
}

export function athleteInitials(name: unknown): string {
  return String(name || "Athlete").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}
