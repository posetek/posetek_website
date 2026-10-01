import type { SetupDraft } from './training-access';
import { setupFromIntake, confirmedSetup } from './training-access';
import type { Row } from './execution';
import { DOMAINS, domainLabel } from '../../../lib/contracts/types';

export const WORKOUT_FOCUSES = [
  { domain: 'speed', label: 'Speed', icon: 'sprint', detail: 'Acceleration and quick feet' },
  { domain: 'strength', label: 'Strength', icon: 'fitness_center', detail: 'Control and body strength' },
  { domain: 'agility', label: 'Agility', icon: 'switch_access_shortcut', detail: 'Turn and change direction' },
  { domain: 'dribbling', label: 'Ball control', icon: 'sports_soccer', detail: 'Close touches and dribbling' },
  { domain: 'passing', label: 'Passing', icon: 'sync_alt', detail: 'Accurate, confident passes' },
  { domain: 'receiving', label: 'First touch', icon: 'touch_app', detail: 'Receive and settle the ball' },
  { domain: 'shooting', label: 'Finishing', icon: 'target', detail: 'Technique in front of goal' },
] as const;
export const focusLabel = (domain: string) => WORKOUT_FOCUSES.find(f => f.domain === domain)?.label || domainLabel(domain);
export function locationFromRequest(text: string): 'home' | 'gym' | 'pitch' | undefined {
  return /\b(?:at home|in my (?:home|house)|indoors at home)\b/i.test(text) ? 'home' : /\b(?:at the gym|at a gym|in the gym|gym access|at gym)\b/i.test(text) ? 'gym'
    : /\b(?:on (?:a |the )?(?:field|pitch)|at (?:a |the )?(?:field|pitch))\b/i.test(text) ? 'pitch' : undefined;
}
export function focusFromRequest(text: string): string[] {
  const patterns: Record<string, RegExp> = { speed: /\b(?:speed|sprint|acceleration)\b/i, strength: /\b(?:strength|stronger|weights|bodyweight)\b/i,
    agility: /\b(?:agility|change.?of.?direction|quick turns)\b/i, dribbling: /\b(?:dribbling|ball control|close control)\b/i, ballMastery: /\bball mastery\b/i,
    passing: /\bpass(?:ing|es)?\b/i, receiving: /\b(?:first touch|receiv(?:e|ing))\b/i, shooting: /\b(?:shoot(?:ing)?|finish(?:ing)?|striking)\b/i };
  const directives = [...text.matchAll(/\b(?:now|instead|(?:I (?:want|would like|need))|work on|focus (?:on|is)|train (?:my|for))\b/gi)];
  const intent = directives.length ? text.slice(directives.at(-1)!.index! + directives.at(-1)![0].length) : text;
  const clauses = intent.split(/[,\.!?;\n]|\bbut\b/i).filter(clause => !/\b(?:already trained|trained earlier|yesterday|last (?:workout|time)|previously)\b/i.test(clause))
    .map(clause => clause.split(/\b(?:no|not|without|avoid|excluding|skip|don['’]t want|do not want|can['’]t|cannot)\b/i)[0]);
  const found = Object.entries(patterns).filter(([, pattern]) => clauses.some(clause => pattern.test(clause))).map(([domain]) => domain);
  return found.length <= 2 ? found : [];
}
export function toggleWorkoutFocus(previous: string[], domain: string): string[] {
  return previous.includes(domain) ? previous.filter(f => f !== domain) : previous.length < 2 ? [...previous, domain] : previous;
}
export function supportedSliderMinutes(supported: number[]): number[] {
  return [...new Set(supported)].filter(m => Number.isInteger(m) && m >= 5 && m <= 60 && m % 5 === 0).sort((a, b) => a - b);
}
export function nearestMinuteIndex(choices: number[], requested: number): number {
  return choices.reduce((best, value, index) => Math.abs(value - requested) < Math.abs(choices[best] - requested) ? index : best, 0);
}
export function nearestSupportedMinutes(supported: number[], requested: number): number | null {
  const choices = supported.filter(m => Number.isInteger(m) && m >= 1 && m <= 135).sort((a, b) => a - b);
  return choices.length ? choices[nearestMinuteIndex(choices, requested)] : null;
}
export type GuidedWorkoutDraft = { focusDomains: string[]; minutes: number; scheduledDate: string; setup: SetupDraft; step: string };
export const guidedWorkoutKey = (uid: string, playerId: string) => `posetek:workout-setup:${encodeURIComponent(uid)}:${encodeURIComponent(playerId)}`;
export function readGuidedWorkout(uid: string, playerId: string): GuidedWorkoutDraft | null {
  if (!uid || typeof localStorage === 'undefined') return null;
  try {
    const row = JSON.parse(localStorage.getItem(guidedWorkoutKey(uid, playerId)) || 'null');
    if (row?.schemaVersion !== 1 || row.uid !== uid || row.playerId !== playerId || !Array.isArray(row.focusDomains) || row.focusDomains.length > 2
      || row.focusDomains.some((d: string) => !(DOMAINS as readonly string[]).includes(d)) || !Number.isInteger(row.minutes) || row.minutes < 1 || row.minutes > 135
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.scheduledDate || '')) return null;
    return { focusDomains: row.focusDomains, minutes: row.minutes, scheduledDate: row.scheduledDate, setup: setupFromIntake(row.intake), step: row.step };
  } catch { return null; }
}
export function rememberGuidedWorkout(uid: string, playerId: string, value: GuidedWorkoutDraft) {
  if (!uid || typeof localStorage === 'undefined') return;
  const intake = confirmedSetup({ ...value.setup, confirmed: true });
  try { localStorage.setItem(guidedWorkoutKey(uid, playerId), JSON.stringify({ schemaVersion: 1, uid, playerId,
    focusDomains: value.focusDomains, minutes: value.minutes, scheduledDate: value.scheduledDate, step: value.step,
    intake: intake || { equipment: value.setup.equipment, setting: value.setup.participantCount === 1 ? 'solo' : 'partner', access: { facility: value.setup.facility, participantCount: value.setup.participantCount, space: {} } } })); } catch { /* The current visit remains usable without local storage. */ }
}
export function clearGuidedWorkout(uid: string, playerId: string) { try { localStorage.removeItem(guidedWorkoutKey(uid, playerId)); } catch { /* optional browser preference */ } }
export function restoredGuidedSetup(cached: GuidedWorkoutDraft | null, prior: SetupDraft, hasExplicitContext: boolean): SetupDraft {
  return !hasExplicitContext && cached?.setup.facility ? cached.setup : prior;
}
export function guidedRequest(focusDomains: string[], minutes: number, original = '') {
  const instruction = `Create a ${minutes}-minute workout focused on ${focusDomains.map(focusLabel).join(' and ')}.`;
  return original.trim() ? `${instruction} ${original.trim()}`.slice(0, 500) : instruction;
}
export type WorkoutAssessment = Row;
