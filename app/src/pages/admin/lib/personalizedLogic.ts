/* eslint-disable @typescript-eslint/no-explicit-any */
import { planV3JobParams } from "./planJobs";
import type { PlanIntakeForm } from "./planJobs";
import { accountContext, accountPlayerPath, accountQuery } from "./accountHierarchy";
import { activeProvisionalEstimates, type ProvisionalEstimate } from '../../../lib/provisional-estimates';
import { coachPlannerReturn, coachWorkspacePath } from '../../../lib/coach-navigation';

export const PERSONALIZED_ENGINE = "personalized-v1";
export const PERSONALIZED_CAPABILITIES = ["generate_personalized_plan", "activate_personalized_plan", "discard_personalized_plan", "assess_personalized_plan"] as const;
export function operationLabel(capability: string) {
  return ({generate_personalized_plan:"Generate draft",activate_personalized_plan:"Activate plan",discard_personalized_plan:"Discard draft",assess_personalized_plan:"Assess priorities"} as Record<string,string>)[capability] ?? capability;
}
export function recentEvidence(reps: any[], now = Date.now()) {
  const recent = reps.filter(rep => Number.isFinite(rep.createdAtMillis) && rep.createdAtMillis > 0
    && rep.createdAtMillis <= now && rep.createdAtMillis >= now - 180 * 86400000);
  return { reps: recent, excluded: reps.length - recent.length,
    window: recent.length ? { oldestAt: new Date(Math.min(...recent.map(r => r.createdAtMillis))).toISOString(),
      newestAt: new Date(Math.max(...recent.map(r => r.createdAtMillis))).toISOString() } : undefined };
}
export function personalizedParams(reps: any[], player: any, age: number | null, intake: PlanIntakeForm, goals: string[] = [], freeTextGoals = "", provisionalEstimates: ProvisionalEstimate[] = [], estimateReps: any[] = reps, useProvisionalEstimates?: boolean): Record<string, any> {
  const evidence = recentEvidence(reps);
  const params = planV3JobParams(evidence.reps, player, age, intake);
  const estimates = activeProvisionalEstimates(provisionalEstimates, recentEvidence(estimateReps).reps);
  const text = freeTextGoals.trim();
  if (text.length > 500) throw new Error('Shorten the training context to 500 characters.');
  // The server loads reviewed estimates itself. Never disguise estimated values
  // as measured stats, coach feedback or extra user-selected goals.
  return { ...params, intake: { ...params.intake, goals: [...goals], freeTextGoals: text || null }, engineVersion: PERSONALIZED_ENGINE,
    useProvisionalEstimates: useProvisionalEstimates ?? estimates.length > 0,
    ...(evidence.window ? { evidenceWindow: evidence.window } : {}) };
}
export function plannerLink(_personalized: boolean, orgId: string, playerIds: Iterable<string>, teamId = "") {
  const query = new URLSearchParams();
  if (orgId) query.set("orgId", orgId);
  if (teamId) query.set("teamId", teamId);
  const ids = [...playerIds];
  if (ids.length) query.set("players", ids.join(","));
  return `/admin/programs${query.size ? `?${query}` : ""}`;
}
export function previewEnabled(config: any, capability = PERSONALIZED_CAPABILITIES[0] as string) {
  const entry = config?.capabilities?.[capability];
  const policy = entry?.dailyLimitPolicy;
  const allowed = policy === "unlimited" ? PERSONALIZED_CAPABILITIES.includes(capability as typeof PERSONALIZED_CAPABILITIES[number])
    : policy == null && Number.isInteger(entry?.dailyLimitPerUser) && entry.dailyLimitPerUser > 0;
  return config?.globalEnabled !== false && config?.programV3Enabled === true
    && (capability === "discard_personalized_plan" || config?.personalizedPlannerEnabled === true)
    && entry?.enabled === true && allowed;
}
export function allocationRows(plan: any, weekNumber: number) {
  const week = plan?.weeks?.find((w: any) => w.weekNumber === weekNumber);
  return week?.check?.allocation?.domains ?? (week?.allocations ?? []).map((row: any) => ({
    domain: row.domain, targetMinutes: row.minutes, actualMinutes: week?.actualMinutesByDomain?.[row.domain] ?? 0,
  }));
}
export function prescriptionSignature(plan: any) {
  return JSON.stringify((plan?.weeks ?? []).map((week: any) => [week.weekNumber,
    (week.workouts ?? []).map((w: any) => [w.order,
      (w.blocks ?? []).map((b: any) => [b.order, b.drillId, b.kind, b.domain, b.sets, b.reps, b.repUnit,
        b.perSide === true, b.restSeconds, b.restScope, b.restBetweenSetsSeconds, b.familiarizationReps ?? 0])])]));
}

/** A refresh must reauthorize before callbacks or queued submissions can resume. */
export function createPlannerAccessGuard() {
  let revision = 0, authorized = false;
  return {
    begin() { authorized = false; return ++revision; },
    capture() { return revision; },
    isCurrent(token: number) { return token === revision; },
    authorize(token: number) { if (token === revision) authorized = true; },
    block() { authorized = false; ++revision; },
    permits(token = revision) { return authorized && token === revision; },
  };
}

export function isPlannerAuthorizationError(error: any) {
  const code = String(error?.code ?? "").toLowerCase().split("/").at(-1);
  return code === "permission-denied" || code === "unauthenticated"
    || code === "user-token-expired" || code === "invalid-user-token" || code === "user-disabled";
}

/** Older completed jobs predate the public intake projection. Never invent their schedule. */
export function normalizeAssessment(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (v: any) => typeof v === "string" ? v : "";
  const intake = value.intake;
  const scheduleAvailable = Number.isFinite(intake?.sessionsPerWeek) && intake.sessionsPerWeek > 0
    && Number.isFinite(intake?.minutesPerSession) && intake.minutesPerSession > 0 && !!text(intake?.setting);
  const split = value.focusSplit?.final ?? value.focusSplit;
  return {
    assessedAt: value.assessedAt,
    priorities: methodologyPriorities(value),
    schedule: scheduleAvailable ? { sessionsPerWeek: intake.sessionsPerWeek, minutesPerSession: intake.minutesPerSession, setting: intake.setting } : null,
    evidenceReason: text(value.evidencePolicy?.reason ?? value.inputs?.evidencePolicy?.reason) || "Historical evidence details are unavailable.",
    findings: (Array.isArray(value.findings) ? value.findings : []).filter((f: any) => f && typeof f === "object").map((f: any) => ({
      domain: text(f.domain) || "Unspecified", confidence: text(f.confidence) || "unavailable",
      statement: text(f.statement), limitation: text(f.limitation),
      targetBeforePct: Number.isFinite(f.targetBeforePct) ? f.targetBeforePct : "—",
      targetFinalPct: Number.isFinite(f.targetFinalPct) ? f.targetFinalPct : "—",
    })),
    focusSplit: Object.fromEntries(Object.entries(split && typeof split === "object" ? split : {}).filter(([, n]) => typeof n === "number" && Number.isFinite(n) && n > 0)),
  };
}

export const PLANNER_GOALS = [
  { id: "speed", label: "Speed" }, { id: "agility", label: "Agility" },
  { id: "dribbling", label: "Dribbling" }, { id: "passing", label: "Passing" },
  { id: "firstTouch", label: "First touch" }, { id: "shooting", label: "Shooting" },
  { id: "strengthPower", label: "Strength & power" },
] as const;
export const METHODOLOGY_VERSION = "evidence-objectives-v1";
const EVIDENCE_LABELS = { measured: "Measured test", conditionalEstimate: "Conditional estimate", goal: "Selected goal", baseline: "Training baseline" } as const;
export type EvidenceBasis = keyof typeof EVIDENCE_LABELS;
export const evidenceBasisLabel = (basis: EvidenceBasis) => EVIDENCE_LABELS[basis];
export interface TrainingPriority {
  id: string; rank: number; domain: string; objectiveId: string; label: string;
  role: "primary" | "support" | "maintain"; evidenceBasis: EvidenceBasis;
  confidence: string; reason: string; limitation: string; metricIds: string[];
  targetPct: number | null; weeklyTargetMinutes: number | null;
  progressCheck: string; eligibleDrillCount: number | null;
}
const object = (value: any) => value && typeof value === "object" && !Array.isArray(value);
const text = (value: any): string => typeof value === "string" ? value : "";
const nonnegative = (value: any): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
/** Only the versioned server contract supplies priorities. Old plans stay readable
 * without invented rationale, confidence or progress targets. */
export function methodologyPriorities(assessment: any): TrainingPriority[] {
  if (!object(assessment) || assessment.methodologyVersion !== METHODOLOGY_VERSION || !Array.isArray(assessment.priorities)) return [];
  const ids = new Set<string>();
  return assessment.priorities.filter((row: any) => {
    if (!object(row) || !text(row.id) || ids.has(row.id) || !text(row.label) || !text(row.reason)
      || !Object.hasOwn(EVIDENCE_LABELS, row.evidenceBasis) || !["primary", "support", "maintain"].includes(row.role)
      || !Number.isInteger(row.rank) || row.rank < 1) return false;
    ids.add(row.id); return true;
  }).map((row: any) => ({
    id: row.id, rank: row.rank, domain: text(row.domain), objectiveId: text(row.objectiveId), label: row.label,
    role: row.role, evidenceBasis: row.evidenceBasis, confidence: text(row.confidence),
    reason: row.reason, limitation: text(row.limitation), metricIds: Array.isArray(row.metricIds) ? row.metricIds.filter((id: any) => typeof id === "string") : [],
    targetPct: nonnegative(row.targetPct), weeklyTargetMinutes: nonnegative(row.weeklyTargetMinutes),
    progressCheck: text(row.progressCheck), eligibleDrillCount: nonnegative(row.eligibleDrillCount),
  })).sort((a: TrainingPriority, b: TrainingPriority) => a.rank - b.rank);
}
export function blockTrainingRationale(block: any) {
  const value = block?.trainingRationale;
  if (!object(value) || value.methodologyVersion !== METHODOLOGY_VERSION
    || !Object.hasOwn(EVIDENCE_LABELS, value.evidenceBasis) || !text(value.reason)) return null;
  return { reason: value.reason as string, progressCheck: text(value.progressCheck), evidenceBasis: value.evidenceBasis as EvidenceBasis,
    objectiveId: text(value.objectiveId), priorityId: text(value.priorityId), confidence: text(value.confidence) };
}

export function plannerPlayerDetailsLink(role: string, player: any, search: string) {
  const prior = accountContext(search);
  const coachId = (prior.orgId ?? "") === (player.organizationId ?? "") ? prior.coachId : undefined;
  const context = { orgId: player.organizationId || undefined, teamId: player.teamId || undefined,
    coachId: coachId || (!player.organizationId ? player.coachId : undefined) || undefined };
  if (role === "admin") return accountPlayerPath(player.id, context);
  if (role === "staff") {
    const priorWorkspace = new URL(coachPlannerReturn(search), "https://posetek.net");
    return coachWorkspacePath(priorWorkspace.search, { view: "player", playerId: player.id,
      orgId: context.orgId, teamId: context.teamId });
  }
  return `/athlete?player=${encodeURIComponent(player.id)}${accountQuery(context).replace(/^\?/, "&")}`;
}
export function activationParams(draft: any) {
  if (draft?.status !== "ready" || !draft.comparisonToken || !Array.isArray(draft.expectedActivePlans)) {
    throw new Error("Choose a ready draft and review its comparison first.");
  }
  return { engineVersion: PERSONALIZED_ENGINE, draftId: draft.draftId,
    comparisonToken: draft.comparisonToken, expectedActivePlans: draft.expectedActivePlans };
}

/** Compare the draft baseline with current active plans, independent of serialization. */
export function activePlansMatch(expected: unknown, plans: any[]): boolean {
  if (!Array.isArray(expected)) return false;
  const active = plans.filter(p => p?.status === "active");
  if (expected.length !== active.length) return false;
  const revisions = new Map(active.map(p => [p.id, p.planRevision ?? 1]));
  if (revisions.size !== active.length) return false;
  const seen = new Set<string>();
  return expected.every(row => {
    if (!row || typeof row.planId !== "string" || !row.planId || seen.has(row.planId)) return false;
    seen.add(row.planId);
    return revisions.has(row.planId) && revisions.get(row.planId) === row.planRevision;
  });
}
