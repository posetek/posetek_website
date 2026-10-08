import type { CoachNote, CoachRow, PlayerRow } from './accounts';
import { activePlan, loadCoachNote, loadCoachOfPlayer, loadPlanAdjustments, loadPlayerPlans } from './accounts';
import { loadPlayerWorkoutHistory } from './workoutNotifications';
import type { RecordedWorkoutLog } from './workoutNotifications';
import type { PlayerPanel } from './adminNavigation';

export type PlayerDetailPanel = PlayerPanel;
export const PLAYER_DETAIL_PANELS: { key: PlayerDetailPanel; label: string }[] = [
  { key: 'results', label: 'Results' }, { key: 'workouts', label: 'Workouts' },
  { key: 'profile', label: 'Profile' }, { key: 'ai-incidents', label: 'AI incidents' },
];

/** Explicit result/rep URLs remain results; legacy saved-workout links open Workouts. */
export function playerDetailPanel(search: URLSearchParams, resultsRoute = false): PlayerDetailPanel {
  if (resultsRoute) return 'results';
  const requested = search.get('playerTab');
  if (PLAYER_DETAIL_PANELS.some(panel => panel.key === requested)) return requested as PlayerDetailPanel;
  if (search.has('workoutSource') || search.has('workoutLog')) return 'workouts';
  return 'results';
}

export interface PlayerProfileData { coach: CoachRow | null; note: CoachNote | null }
export interface PlayerWorkoutsData {
  plans: any[]; plan: any | null; logs: RecordedWorkoutLog[]; adjustments: any[]; checkedAt: number;
}

export async function loadPlayerProfileData(player: PlayerRow): Promise<PlayerProfileData> {
  // Do not replace a denied private-note read with an empty editable note.
  const [coach, note] = await Promise.all([loadCoachOfPlayer(player), loadCoachNote(player.id)]);
  return { coach, note };
}

export async function loadPlayerWorkoutsData(playerId: string): Promise<PlayerWorkoutsData> {
  const [plans, logs] = await Promise.all([loadPlayerPlans(playerId), loadPlayerWorkoutHistory(playerId)]);
  const plan = activePlan(plans);
  const adjustments = plan ? await loadPlanAdjustments(playerId, plan.id) : [];
  return { plans, plan, logs, adjustments, checkedAt: Date.now() };
}
