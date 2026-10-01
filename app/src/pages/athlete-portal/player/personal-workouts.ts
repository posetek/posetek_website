import type { CatalogDrill } from '../../../lib/contracts/drillV2';
import { blockEstimatedMinutes, blockInputErrors, workoutEstimatedMinutes } from '../../../lib/contracts/expectedMinutes';
import { blockFromDrill, doseBoundsFor } from '../../admin/lib/editor';
import { EQUIPMENT } from '../../../lib/contracts/types';
import type { BlockV3 } from '../../../lib/contracts/types';
import type { Row } from './execution';
import type { TrainingAccess } from './training-access';

export const PERSONAL_CAPABILITIES = ['save_personal_workout', 'generate_personal_workout', 'assess_personal_workout', 'start_personal_workout', 'update_personal_workout_log'] as const;
export type PersonalCapability = typeof PERSONAL_CAPABILITIES[number];
export type PersonalIntake = { age?: number; equipment: string[]; setting: 'solo' | 'partner'; painFlag: boolean; access?: TrainingAccess; focusDomains?: string[] };
export type PersonalDraft = { workoutId: string; order: number; title: string; intent: string; focusDomains: string[]; budgetMinutes: number; estimatedMinutes: number; blocks: BlockV3[]; nextBlockSequence: number };
export type SourceWorkout = { planId: string; workoutId: string; revision: number };
export type PendingPersonalJob = { schemaVersion: 1; uid: string; playerId: string; capability: PersonalCapability; jobId: string; params: Row; signature: string; terminalFailed?: boolean };
export function personalCapabilityEnabled(config: Row | null, capability: PersonalCapability, preview = false) {
  const cap = config?.capabilities?.[capability];
  if (capability === 'assess_personal_workout') return preview || !!(config && config.globalEnabled === true && !config.unavailable && config.personalWorkoutsEnabled === true && cap?.enabled === true);
  return preview || !!(config && config.globalEnabled === true && !config.unavailable && config.personalWorkoutsEnabled === true && cap?.enabled === true && Number.isInteger(cap.dailyLimitPerUser) && cap.dailyLimitPerUser > 0);
}
export function personalWorkoutsEnabled(config: Row | null, preview = false) {
  return ['save_personal_workout', 'start_personal_workout', 'update_personal_workout_log'].every(c => personalCapabilityEnabled(config, c as PersonalCapability, preview));
}
export const personalExecutionId = (id: string) => `personal_${id}`;
export function personalExecution(workout: Row, log: Row): Row {
  return { ...log.workoutSnapshot, id: personalExecutionId(workout.workoutId), workoutId: workout.workoutId,
    source: 'personal', planId: '__personal__', workoutRevision: log.workoutRevision,
    recoveredActiveSeconds: Math.max(0, Number(log.elapsedSeconds || 0)), timerStartedHere: true };
}
export function personalProgress(logs: Row[]) {
  const unique = [...new Map(logs.filter(l => typeof l.workoutId === 'string').map(l => [l.workoutId, l])).values()];
  return { sessions: unique.filter(l => !!l.endedAt).length,
    sets: unique.reduce((sum, l) => sum + (l.blocks || []).reduce((n: number, b: Row) => n + Math.max(0, Number(b.setsCompleted) || 0), 0), 0),
    seconds: unique.reduce((sum, l) => sum + Math.max(0, Number(l.elapsedSeconds) || 0), 0) };
}
export function personalAge(athlete: Row, now = new Date()): number | undefined {
  const date = (v: any): Date | null => { const d = v?.toDate?.() || (v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null); return d && Number.isFinite(d.getTime()) ? d : null; };
  for (const field of ['birthDate', 'dateOfBirth']) {
    const calendar = typeof athlete[field] === 'string' ? athlete[field].match(/^(\d{4})-(\d{2})-(\d{2})(?=T|$)/) : null;
    if (calendar) {
      const check = new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3])));
      if (check.getUTCFullYear() !== Number(calendar[1]) || check.getUTCMonth() + 1 !== Number(calendar[2]) || check.getUTCDate() !== Number(calendar[3])) continue;
    }
    const birth = date(athlete[field]);
    if (!birth || birth > now) continue;
    const age = now.getUTCFullYear() - birth.getUTCFullYear() - (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate()) ? 1 : 0);
    if (age >= 5 && age <= 80) return age;
  }
  const recorded = date(athlete.ageRecordedAt), gap = recorded ? now.getTime() - recorded.getTime() : null;
  return Number.isInteger(athlete.age) && athlete.age >= 5 && athlete.age <= 80 && gap !== null && gap >= 0 && gap <= 365 * 86400000 ? athlete.age : undefined;
}
export function eligiblePersonalDrill(drill: CatalogDrill, intake: PersonalIntake, maxDifficulty = 5): boolean {
  return drill.status === 'published' && !drill.trainingPolicy && Number.isInteger(intake.age) &&
    intake.age! >= drill.minAge && intake.age! <= drill.maxAge && drill.difficultyLevel <= maxDifficulty &&
    (!drill.requiresPartner || intake.setting === 'partner') && drill.equipment.every(e => intake.equipment.includes(e));
}
export function personalDraft(source?: Row, preserveIds = false): PersonalDraft {
  const blocks: BlockV3[] = (source?.blocks || []).map((b: Row, index: number) => ({
    ...b, blockId: preserveIds ? b.blockId : `b${index + 1}`, order: index + 1, kind: b.kind || 'main', perSide: b.perSide === true,
    restScope: b.restScope === 'reps' ? 'reps' : 'sets', restSeconds: b.restSeconds || 0,
    restBetweenSetsSeconds: b.restBetweenSetsSeconds ?? null, familiarizationReps: b.familiarizationReps || 0, whyIncluded: b.whyIncluded || '',
  }));
  return recomputePersonalDraft({ workoutId: preserveIds ? source?.workoutId || '' : '', order: 1, title: source?.title ? `${source.title}`.slice(0, 80) : 'My workout',
    intent: source?.intent || 'A personal training session.', focusDomains: [], budgetMinutes: source?.budgetMinutes || 30,
    estimatedMinutes: 0, blocks, nextBlockSequence: preserveIds ? Number(source?.nextBlockSequence) || Math.max(0, ...blocks.map(b => Number(b.blockId.replace(/^b/, '')) || 0)) + 1 : blocks.length + 1 });
}
export function recomputePersonalDraft(draft: PersonalDraft): PersonalDraft {
  const blocks = draft.blocks.map((b, i) => ({ ...b, order: i + 1, estimatedMinutes: blockInputErrors(b).length ? 0 : blockEstimatedMinutes(b) }));
  return { ...draft, blocks, estimatedMinutes: workoutEstimatedMinutes(blocks.map(b => b.estimatedMinutes)), focusDomains: [...new Set(blocks.map(b => b.domain))].slice(0, 4) };
}
export function addPersonalDrill(draft: PersonalDraft, drill: CatalogDrill): PersonalDraft {
  return recomputePersonalDraft({ ...draft, blocks: [...draft.blocks, blockFromDrill(drill, `b${draft.nextBlockSequence}`, draft.blocks.length + 1)], nextBlockSequence: draft.nextBlockSequence + 1 });
}
export function personalDraftErrors(draft: PersonalDraft, catalog: CatalogDrill[], intake: PersonalIntake, maxDifficulty = 5): string[] {
  const errors: string[] = personalIntakeErrors(intake);
  if (!draft.title.trim() || draft.title.length > 80) errors.push('Name your workout using 1–80 characters.');
  if (!draft.blocks.length || draft.blocks.length > 12) errors.push('Choose between 1 and 12 drills.');
  if (!Number.isInteger(draft.budgetMinutes) || draft.budgetMinutes < 1 || draft.budgetMinutes > 135 || draft.estimatedMinutes > 135) errors.push('Keep this session within 1–135 minutes.');
  if (draft.blocks.length && Math.abs(draft.estimatedMinutes - draft.budgetMinutes) > Math.max(5, draft.budgetMinutes / 10)) errors.push(`These drills take about ${draft.estimatedMinutes} minutes, outside your ${draft.budgetMinutes}-minute target. Adjust the drills or use the estimated time.`);
  if (new Set(draft.blocks.map(b => b.drillId)).size !== draft.blocks.length) errors.push('Use each drill once. Adjust its sets instead of adding it again.');
  for (const block of draft.blocks) {
    errors.push(...blockInputErrors(block).map(e => `${block.name}: ${e}`));
    const drill = catalog.find(d => d.drillId === block.drillId);
    if (!drill || !eligiblePersonalDrill(drill, intake, maxDifficulty)) { errors.push(`${block.name} is unavailable for these training conditions. Remove it or update your equipment and setting.`); continue; }
    const bounds = doseBoundsFor(drill);
    for (const field of ['sets', 'reps', 'restSeconds'] as const) if (block[field] < bounds[field].min || block[field] > bounds[field].max) errors.push(`${block.name}: ${field === 'restSeconds' ? 'rest seconds' : field} must be ${bounds[field].min}–${bounds[field].max}.`);
    if (block.repUnit !== (drill.dose.repUnit || 'reps') || block.perSide !== (drill.dose.perSide === true)) errors.push(`${block.name}: use the catalog’s prescribed unit and side instructions.`);
  }
  return [...new Set(errors)];
}
export function personalIntakeErrors(intake: PersonalIntake): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(intake.age) || intake.age! < 5 || intake.age! > 80) errors.push('Enter your actual age, from 5 to 80, before building this workout.');
  if (intake.painFlag !== false) errors.push('Pause training and ask a parent or coach to review your pain or restriction.');
  if (!['solo', 'partner'].includes(intake.setting)) errors.push('Choose solo training or a partner.');
  if (!Array.isArray(intake.equipment) || intake.equipment.some(e => !(EQUIPMENT as readonly string[]).includes(e))) errors.push('Choose equipment from the available list.');
  return errors;
}
export function personalGenerationErrors(intake: PersonalIntake, minutes: number, text: string): string[] {
  return [...personalIntakeErrors(intake), ...(!Number.isInteger(minutes) || minutes < 1 || minutes > 135 ? ['Choose a whole number from 1 to 135 minutes.'] : []), ...(text.trim().length < 3 || text.trim().length > 500 ? ['Describe your workout in 3–500 characters.'] : [])];
}
export function latestPersonalRevision(old: Row | undefined, incoming: Row): Row {
  return old && Number(old.revision) > Number(incoming.revision) ? old : incoming;
}
export function personalLogRows(rows: Row[]): Row[] {
  return rows.map(r => ({ blockId: r.blockId, status: r.status, setsCompleted: r.setsCompleted,
    ...(r.skipReason ? { skipReason: r.skipReason } : {}),
    ...(Number.isInteger(r.elapsedSeconds) ? { elapsedSeconds: r.elapsedSeconds } : {}) }));
}
export function personalWorkoutPayload(draft: PersonalDraft): PersonalDraft {
  const blocks = draft.blocks.map(b => ({ blockId: b.blockId, order: b.order, kind: b.kind, drillId: b.drillId,
    name: b.name, domain: b.domain, estimatedMinutes: b.estimatedMinutes, whyIncluded: b.whyIncluded || 'Personal practice',
    sets: b.sets, reps: b.reps, repUnit: b.repUnit, perSide: b.perSide, restSeconds: b.restSeconds,
    restScope: b.restScope, restBetweenSetsSeconds: b.restBetweenSetsSeconds ?? null, familiarizationReps: b.familiarizationReps || 0,
    ...(b.trainingPolicyVersion ? { trainingPolicyVersion: b.trainingPolicyVersion } : {}),
    ...(b.loadingInstructions ? { loadingInstructions: b.loadingInstructions } : {}),
  }));
  return { ...draft, blocks };
}
export const personalJobKey = (uid: string, playerId: string) => `posetek:personal-job:${encodeURIComponent(uid)}:${encodeURIComponent(playerId)}`;
export function restorePersonalJob(value: unknown, uid: string, playerId: string): PendingPersonalJob | null {
  const v = value as PendingPersonalJob;
  return v?.schemaVersion === 1 && v.uid === uid && v.playerId === playerId && PERSONAL_CAPABILITIES.includes(v.capability) &&
    typeof v.jobId === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(v.jobId) && typeof v.params?.requestId === 'string' &&
    typeof v.signature === 'string' && v.signature === JSON.stringify({ capability: v.capability, params: Object.fromEntries(Object.entries(v.params).filter(([k]) => k !== 'requestId')) }) ? v : null;
}

export async function ensurePersonalSubmission(record: PendingPersonalJob, port: { persist: (record: PendingPersonalJob) => void; exists: (jobId: string) => Promise<boolean>; create: (record: PendingPersonalJob) => Promise<void> }) {
  port.persist(record);
  // llmJobs is create-only for clients; a missing document cannot be read under
  // its owner rules. Attempt the stable ID first, then read back an owned job
  // after either a lost acknowledgement or the refusal to overwrite it.
  try { await port.create(record); }
  catch (error: any) {
    let readDenied = false;
    try { if (await port.exists(record.jobId)) return; } catch (readError: any) { readDenied = readError?.code === 'permission-denied'; }
    if (error?.code === 'invalid-argument' || error?.code === 'permission-denied' && readDenied) error.definitiveRejection = true;
    throw error;
  }
}
