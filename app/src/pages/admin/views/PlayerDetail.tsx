// One full-width athlete workspace. Only the selected panel reads its evidence.
//
// Read-only for athlete evidence: an admin inspects logs and edits
// prescriptions, and never starts, completes or alters work as the athlete
// (identity §6, 01A Q19).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router-dom";
import { blockDoseLine } from "../../../lib/contracts/drillV2";
import {
  currentWeekNumber,
  nextWorkout,
  orderedBlocks,
  orderedWeeks,
  orderedWorkouts,
  planHorizonWeeks,
  stateOf,
  weekWindow,
  weekWindowLabel,
  workoutStates,
} from "../../../lib/contracts/planV3";
import { POSITIONS, POSITION_LABELS, domainLabel, isV3Plan, planSchemaVersion } from "../../../lib/contracts/types";
import type { Position } from "../../../lib/contracts/types";
import {
  COACH_NOTE_MAX_CHARS,
  clearCoachNote,
  eligibilityFor,
  loadPlayer,
  resolvePlayerAge,
  saveCoachNote,
  savePlayerProfile,
} from "../lib/accounts";
import type { CoachNote, CoachRow, PlayerRow } from "../lib/accounts";
import { adminPlannerPath, adminPlayerPath, adminPlayerReturn } from "../lib/adminNavigation";
import { PLAYER_DETAIL_PANELS, loadPlayerProfileData, loadPlayerWorkoutsData, playerDetailPanel } from "../lib/playerDetailData";
import type { PlayerDetailPanel, PlayerProfileData, PlayerWorkoutsData } from "../lib/playerDetailData";
import { useAccountLoad } from "../lib/useAccountLoad";
import { ADMIN_RETURN_STATE } from '../lib/useAdminNavigation';
import { parseWorkoutFocus, workoutFocusQuery } from "../lib/workoutNotifications";
import AdminResults from "./AdminResults";
import PlayerAiIncidents from "./PlayerAiIncidents";
import { PlayerWorkoutHistoryContent } from "./PlayerWorkoutHistory";
import "../player-detail.scss";

const PlayerDetailPreview = import.meta.env.DEV ? lazy(() => import('./PlayerDetailPreview')) : null;
export default function PlayerDetail({ preview = false }: { preview?: boolean }) {
  if (import.meta.env.DEV && preview && PlayerDetailPreview) return <Suspense fallback={<p role="status">Loading player preview…</p>}><PlayerDetailPreview /></Suspense>;
  return <LivePlayerDetail />;
}

function LivePlayerDetail() {
  const { playerId = "" } = useParams();
  const [query] = useSearchParams();
  const location = useLocation();
  const panel = playerDetailPanel(query, /\/results(?:\/|$)/.test(location.pathname));
  const scope = `${query.get('orgId') || ''}/${query.get('teamId') || ''}`;
  const loader = useCallback(async () => {
    const found = await loadPlayer(playerId);
    if (!found) throw new Error("That athlete could not be found.");
    return found;
  }, [playerId, scope]);
  const { state: load, refresh } = useAccountLoad(loader);

  useEffect(() => {
    document.title = "Athlete | PoseTek admin";
  }, []);

  return <section className="admin-player-workspace">
    {load.kind === 'loading' && <div className="portal-loading" role="status"><span className="spinner" /><p>Loading the athlete…</p></div>}
    {load.kind === 'error' && <><p className="form-message" role="alert">{load.message}</p><button type="button" className="quiet-button" onClick={refresh}>Try again</button></>}
    {load.kind === 'ready' && <PlayerDetailContent key={`${playerId}/${scope}`} player={load.data} panel={panel} onProfileSaved={async () => refresh()} />}
  </section>;
}

export function PlayerDetailContent({ player, panel, onProfileSaved, children }: { player: PlayerRow; panel: PlayerDetailPanel; onProfileSaved: () => Promise<void>; children?: ReactNode }) {
  const location = useLocation();
  const resolvedAge = resolvePlayerAge(player.raw);
  const athlete = useMemo(() => ({ ...player.raw, id: player.id }), [player]);
  const plannerQuery = new URLSearchParams(location.search);
  // Current ownership wins over a stale directory context after a transfer.
  if (player.organizationId) plannerQuery.set('orgId', player.organizationId); else plannerQuery.delete('orgId');
  if (player.teamId) plannerQuery.set('teamId', player.teamId); else plannerQuery.delete('teamId');
  return <>
      <section className="admin-heading">
        <Link className="icon-button" state={ADMIN_RETURN_STATE} to={adminPlayerReturn(location.search)} aria-label="Back to people and organizations">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">Athlete{player.organizationId ? " · organization member" : ""}</p>
          <h1>{player.name}</h1>
          <p>
            {player.email || "No email on file"} ·{" "}
            {resolvedAge.age !== null ? `${resolvedAge.age} years old` : "Age unknown"}
          </p>
        </div>
        <div className="admin-heading-actions">
          <Link className="primary-cta small" to={adminPlannerPath(player.id, plannerQuery.toString())}>
            <span className="material-symbols-outlined" aria-hidden="true">fitness_center</span>Prescribe workouts
          </Link>
          <Link className="quiet-button" to={`/athlete?player=${encodeURIComponent(player.id)}&returnTo=${encodeURIComponent(location.pathname + location.search)}`}>
            <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>Read-only player preview
          </Link>
        </div>
      </section>

      <PlayerDetailTabs playerId={player.id} selected={panel} />
      <div role="tabpanel" id={`admin-player-panel-${panel}`} aria-labelledby={`admin-player-tab-${panel}`} tabIndex={0} className="admin-player-panel">
        {children ?? <>
          {panel === 'results' && <AdminResults embedded athlete={athlete} />}
          {panel === 'workouts' && <PlayerWorkoutsPanel player={player} />}
          {panel === 'profile' && <PlayerProfilePanel player={player} onSaved={onProfileSaved} />}
          {panel === 'ai-incidents' && <PlayerAiIncidents playerId={player.id} />}
        </>}
      </div>
    </>;
}

export function PlayerDetailTabs({ playerId, selected }: { playerId: string; selected: PlayerDetailPanel }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const previousSelection = useRef(selected);
  useEffect(() => {
    const restore = previousSelection.current !== selected && (navigationType === 'POP' || buttons.current.some(button => button === document.activeElement));
    previousSelection.current = selected;
    if (!restore) return;
    // Run after the browser restores history focus, so Back lands on its active tab.
    const frame = requestAnimationFrame(() => buttons.current[PLAYER_DETAIL_PANELS.findIndex(panel => panel.key === selected)]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selected, navigationType]);
  return <div className="admin-player-tabs" role="tablist" aria-label="Player information">
    {PLAYER_DETAIL_PANELS.map((panel, index) => <button type="button" key={panel.key} ref={element => { buttons.current[index] = element; }}
      role="tab" id={`admin-player-tab-${panel.key}`} aria-controls={`admin-player-panel-${panel.key}`} aria-selected={selected === panel.key}
      tabIndex={selected === panel.key ? 0 : -1} className={selected === panel.key ? 'active' : ''}
      onClick={() => { if (panel.key !== selected) navigate(adminPlayerPath(playerId, panel.key, location.search)); }}
      onKeyDown={event => {
        let next: number | undefined;
        if (event.key === 'ArrowRight') next = (index + 1) % PLAYER_DETAIL_PANELS.length;
        if (event.key === 'ArrowLeft') next = (index + PLAYER_DETAIL_PANELS.length - 1) % PLAYER_DETAIL_PANELS.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = PLAYER_DETAIL_PANELS.length - 1;
        if (next !== undefined) { event.preventDefault(); buttons.current[next]?.focus(); }
      }}>{panel.label}</button>)}
  </div>;
}

function PlayerProfilePanel({ player, onSaved }: { player: PlayerRow; onSaved: () => Promise<void> }) {
  const loader = useCallback(() => loadPlayerProfileData(player), [player]);
  const { state: load, refresh } = useAccountLoad(loader);
  const saved = async () => { refresh(); await onSaved(); };
  if (load.kind === 'loading') return <p className="admin-note" role="status">Loading profile inputs…</p>;
  if (load.kind === 'error') return <><p className="form-message" role="alert">{load.message}</p><button type="button" className="quiet-button" onClick={refresh}>Try again</button></>;
  return <PlayerProfileContent player={player} data={load.data} onSaved={saved} />;
}

export function PlayerProfileContent({ player, data, onSaved, readOnly = false }: { player: PlayerRow; data: PlayerProfileData; onSaved: () => Promise<void>; readOnly?: boolean }) {
  return <div className="admin-grid-two">
    <ProfileCard key={String(player.raw?.updatedAt?.seconds ?? player.id)} player={player} coach={data.coach} onSaved={onSaved} readOnly={readOnly} />
    <CoachNoteCard playerId={player.id} note={data.note} onSaved={onSaved} readOnly={readOnly} />
  </div>;
}

function PlayerWorkoutsPanel({ player }: { player: PlayerRow }) {
  const [query, setQuery] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const loader = useCallback(() => loadPlayerWorkoutsData(player.id), [player.id]);
  const { state: load, refresh } = useAccountLoad(loader);
  if (load.kind !== 'ready') return <PlayerWorkoutHistoryContent playerId={player.id} request={parseWorkoutFocus(query)} refresh={revision}
    load={{ kind: load.kind }} onRefresh={refresh} onSelect={focus => setQuery(workoutFocusQuery(query, focus))} />;
  return <PlayerWorkoutsContent player={player} data={load.data} revision={revision} onRefresh={() => { setRevision(value => value + 1); refresh(); }} />;
}

export function PlayerWorkoutsContent({ player, data, revision = 0, onRefresh }: { player: PlayerRow; data: PlayerWorkoutsData; revision?: number; onRefresh: () => void }) {
  const [query, setQuery] = useSearchParams();
  return <>
    <PlayerWorkoutHistoryContent playerId={player.id} request={parseWorkoutFocus(query)} refresh={revision}
      load={{ kind: 'ready', logs: data.logs, checkedAt: data.checkedAt }} onRefresh={onRefresh} onSelect={focus => setQuery(workoutFocusQuery(query, focus))} />
    <PlanSection playerId={player.id} plan={data.plan} plans={data.plans}
      logs={data.logs.filter(log => log._workoutSource === 'workoutLogs')} context={`?${query}`} />
    {data.plan && isV3Plan(data.plan) && <AdjustmentHistory adjustments={data.adjustments} />}
  </>;
}

// MARK: - Profile inputs

function ProfileCard({ player, coach, onSaved, readOnly = false }: { player: PlayerRow; coach: CoachRow | null; onSaved: () => Promise<void>; readOnly?: boolean }) {
  const resolved = resolvePlayerAge(player.raw);
  const [position, setPosition] = useState<string>(String(player.raw?.position ?? ""));
  const [birthDate, setBirthDate] = useState<string>(() => {
    const value = player.raw?.birthDate;
    const date = value?.toDate ? value.toDate() : null;
    return date ? date.toISOString().slice(0, 10) : "";
  });
  const [age, setAge] = useState<string>(
    resolved.recordedAge !== null ? String(resolved.recordedAge) : "",
  );
  const [cap, setCap] = useState<string>(
    typeof player.raw?.maxDrillDifficulty === "number" ? String(player.raw.maxDrillDifficulty) : "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hasRecordedBirthday = resolvePlayerAge({ birthDate: player.raw?.birthDate, dateOfBirth: player.raw?.dateOfBirth }).age !== null;
  const confirmableAge = Number(age);
  const canConfirmAge = !hasRecordedBirthday && Number.isInteger(confirmableAge) && confirmableAge >= 5 && confirmableAge <= 80;

  async function confirmCurrentAge() {
    if (!canConfirmAge || saving) return;
    setSaving(true); setMessage(null);
    try {
      // This deliberate action refreshes even the same stored number. A normal
      // position/rating Save does not claim a new age observation.
      await savePlayerProfile(player.id, { age: confirmableAge });
      await onSaved(); setMessage("Current age confirmed.");
    } catch (error: any) { setMessage(error?.message || "The current age could not be confirmed."); }
    finally { setSaving(false); }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const patch: any = {};
      const storedPosition = String(player.raw?.position ?? "");
      if (position !== storedPosition) patch.position = position ? (position as Position) : null;
      const storedBirth = player.raw?.birthDate?.toDate
        ? player.raw.birthDate.toDate().toISOString().slice(0, 10)
        : "";
      if (birthDate !== storedBirth) {
        const parsed = birthDate ? new Date(`${birthDate}T00:00:00Z`) : null;
        // The rules require a birth date at or before request.time; catching it
        // here turns a bare permission-denied into a sentence.
        if (parsed && parsed.valueOf() > Date.now()) {
          setMessage("A birth date cannot be in the future.");
          return;
        }
        patch.birthDate = parsed;
      }
      const storedAge = typeof player.raw?.age === "number" ? String(player.raw.age) : "";
      if (age !== storedAge) {
        if (!age && storedAge) {
          // The profile rule validates a changed `age` as an integer 5–80, with
          // no clause for removing the key, so clearing one is denied outright.
          // A birth date takes precedence over a recorded age anyway, so leaving
          // the stale number in place changes nothing the generator reads.
          setMessage("A recorded age cannot be cleared. Set a birth date instead — it takes precedence.");
          return;
        }
        patch.age = Number(age);
      }
      const storedCap = typeof player.raw?.maxDrillDifficulty === "number" ? String(player.raw.maxDrillDifficulty) : "";
      if (cap !== storedCap) patch.maxDrillDifficulty = cap ? Number(cap) : null;
      if (!Object.keys(patch).length) { setMessage("Nothing changed."); return; }
      await savePlayerProfile(player.id, patch);
      await onSaved();
      setMessage("Saved.");
    } catch (error: any) {
      setMessage(error?.message || "That change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-card">
      <h3>Profile inputs</h3>
      <p className="admin-note">
        What the generator reads about this athlete besides their measured results.
      </p>
      <div className="admin-form">
        <label className="admin-field">
          <span>Position</span>
          <select value={position} onChange={event => setPosition(event.target.value)}>
            <option value="">Not recorded</option>
            {POSITIONS.map(value => <option key={value} value={value}>{POSITION_LABELS[value]}</option>)}
          </select>
        </label>
        <div className="admin-field-row">
          <label className="admin-field">
            <span>Birth date (canonical for age)</span>
            <input type="date" value={birthDate} onChange={event => setBirthDate(event.target.value)} />
          </label>
          <label className="admin-field">
            <span>Recorded age (only when there is no birth date)</span>
            <input type="number" min={5} max={80} value={age} onChange={event => setAge(event.target.value)} />
            {!hasRecordedBirthday && <button type="button" className="quiet-button" disabled={readOnly || saving || !canConfirmAge} onClick={() => void confirmCurrentAge()}>Confirm current age</button>}
          </label>
        </div>
        <p className="admin-note">
          Age in use: {resolved.age ?? "unknown"} ({resolved.source}
          {resolved.stale ? resolved.observationStatus === "future" ? ", future-dated observation — confirm current age"
            : resolved.observationStatus === "undated" ? ", undated observation — confirm current age" : ", recorded over a year ago — refresh it" : ""}). A recorded age is an
          observation, not a birthday, so it is never incremented automatically.
          {resolved.stale && resolved.recordedAge !== null && ` Stored observation: ${resolved.recordedAge} years; it is not used for prescriptions.`}
        </p>
        <label className="admin-field">
          <span>
            Maximum drill difficulty for this athlete — overrides the team setting
            {coach?.maxDrillDifficulty ? ` (${coach.name}: up to ${coach.maxDrillDifficulty})` : " (team: all levels)"}
          </span>
          <select value={cap} onChange={event => setCap(event.target.value)}>
            <option value="">Inherit ({eligibilityFor({ ...player, raw: { ...player.raw, maxDrillDifficulty: undefined } }, coach).maxDrillDifficulty})</option>
            {[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>Up to {level}</option>)}
          </select>
        </label>
        {message && <p className="admin-note">{message}</p>}
        <div className="admin-form-actions">
          <button className="primary-cta" type="button" disabled={readOnly || saving} onClick={save}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </section>
  );
}

// MARK: - The private coach note

function CoachNoteCard({ playerId, note, onSaved, readOnly = false }: { playerId: string; note: CoachNote | null; onSaved: () => Promise<void>; readOnly?: boolean }) {
  const [text, setText] = useState(note?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { setText(note?.text ?? ""); }, [note]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const trimmed = text.trim();
      if (!trimmed) { await clearCoachNote(playerId); }
      else { await saveCoachNote(playerId, trimmed.slice(0, COACH_NOTE_MAX_CHARS), note?.emphasis ?? []); }
      await onSaved();
      setMessage(trimmed ? "Saved." : "Cleared.");
    } catch (error: any) {
      setMessage(error?.message || "That note could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-card">
      <h3>Coach feedback</h3>
      <p className="admin-note">
        A powerful but bounded lever: it can move one training area by up to ten points, and thirty
        across the plan. Keep it about training — pain, injury and readiness go through the
        referral path, not here. The athlete never sees this note, only the plan it shapes.
      </p>
      <div className="admin-form">
        <label className="admin-field">
          <span>The current note (one per athlete; saving replaces it)</span>
          <textarea
            value={text}
            maxLength={COACH_NOTE_MAX_CHARS}
            placeholder="This guy really needs to get his speed up — he's slow off the mark and loses 1v1s because of it. Passing is fine."
            onChange={event => setText(event.target.value)}
          />
        </label>
        <p className="admin-counter">{text.length} / {COACH_NOTE_MAX_CHARS}</p>
        {note?.updatedAt && (
          <p className="admin-note">
            Last written by {note.authorRole ?? "someone"}
            {note.emphasis?.length ? ` · tagged ${note.emphasis.map(tag => `${tag.direction} ${domainLabel(tag.domain)}`).join(", ")}` : ""}
          </p>
        )}
        {message && <p className="admin-note">{message}</p>}
        <div className="admin-form-actions">
          <button className="primary-cta" type="button" disabled={readOnly || saving} onClick={save}>
            {saving ? "Saving…" : text.trim() ? "Save note" : "Clear note"}
          </button>
        </div>
      </div>
    </section>
  );
}

// MARK: - The plan

function PlanSection({ playerId, plan, plans, logs, context }: {
  playerId: string; plan: any | null; plans: any[]; logs: any[]; context: string;
}) {
  const version = plan ? planSchemaVersion(plan) : null;
  return <>
    <section className="admin-card"><div className="admin-heading">
      <div><h2>Training program</h2><p>{plan ? planHorizonWeeks(plan) + " weeks from " + String(plan.startDate ?? "—") : "No active plan yet."}</p></div>
      <Link className="quiet-button" to={adminPlannerPath(playerId, context)}>Open personalized planner</Link>
    </div><p>Build a draft from current evidence, review its workouts, then choose Use this plan.</p></section>
    {!plan && <div className="admin-banner"><p>This athlete has no active plan.{plans.length ? " " + plans.length + " older plans on file." : ""}</p></div>}
    {plan && version !== 3 && <LegacyPlanCard plan={plan} />}
    {plan && version === 3 && <WorkoutList playerId={playerId} plan={plan} logs={logs} context={context} />}
  </>;
}

function LegacyPlanCard({ plan }: { plan: any }) {
  const version = planSchemaVersion(plan);
  return (
    <section className="admin-card">
      <div className="admin-banner warn">
        <span className="material-symbols-outlined">history</span>
        <p>
          {version === 0
            ? "This plan's schema version is not one this console understands, so it is not shown."
            : "This is an older plan: weeks of prescriptions rather than predefined workouts. The workout editor only edits v3 plans — build a new plan above to get one."}
        </p>
      </div>
      {version === 1 && (
        <>
          <h3>Weeks in the older plan</h3>
          {(plan.weeks || []).map((week: any) => (
            <div className="admin-week" key={week.weekNumber}>
              <div className="admin-week-head">
                <h3>Week {week.weekNumber}{week.theme ? ` — ${week.theme}` : ""}</h3>
              </div>
              <ul className="admin-blocks">
                {(week.drills || []).map((drill: any, index: number) => (
                  <li className="admin-block" key={`${drill.drillId}-${index}`}>
                    <span className="admin-block-order">{index + 1}</span>
                    <span className="admin-block-copy">
                      <strong>{drill.name}</strong>
                      <span className="admin-block-dose">
                        {domainLabel(String(drill.domain || ""))} · {drill.sets}×{drill.reps} {drill.repUnit}
                        {drill.frequencyPerWeek ? ` · ${drill.frequencyPerWeek}×/week` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// MARK: - Every workout, vertically

function WorkoutList({ playerId, plan, logs, context }: { playerId: string; plan: any; logs: any[]; context: string }) {
  const states = useMemo(
    () => workoutStates([String(plan.planId ?? ""), String(plan.id ?? "")], logs),
    [plan, logs],
  );
  const next = useMemo(() => nextWorkout(plan, logs), [plan, logs]);
  const thisWeek = currentWeekNumber(plan);

  return (
    <>
      {(orderedWeeks(plan)).map(week => {
        const window = weekWindow(plan, Number(week.weekNumber));
        return (
          <section className="admin-week" key={week.weekNumber}>
            <div className="admin-week-head">
              <h3>Week {week.weekNumber}{week.theme ? ` — ${week.theme}` : ""}</h3>
              {window && <span>{weekWindowLabel(window)}</span>}
              {Number(week.weekNumber) === thisWeek && <span className="admin-chip accent">this week</span>}
              {week.focus && <span>{week.focus}</span>}
            </div>

            {(week.targets || []).length > 0 && (
              <p className="admin-note">
                Targets:{" "}
                {(week.targets || []).map((target: any) => `${domainLabel(target.domain)} ×${target.exposures}`).join(" · ")}
              </p>
            )}

            {orderedWorkouts(week).map(workout => {
              const state = stateOf(states, String(workout.workoutId));
              const isNext = next?.workout?.workoutId === workout.workoutId;
              return (
                <article className={`admin-workout${isNext ? " is-next" : ""}`} key={workout.workoutId}>
                  <header>
                    <div>
                      <h4>{workout.title || workout.workoutId}</h4>
                      <p>{workout.intent}</p>
                    </div>
                    <div className="admin-workout-actions">
                      <span className="admin-chip">~{workout.estimatedMinutes} min of {workout.budgetMinutes}</span>
                      <span className="admin-chip">rev {workout.revision ?? 1} · {String(workout.editedBy ?? "generator")}</span>
                      <StatusChip state={state} isNext={isNext} />
                      <Link
                        className="primary-cta small"
                        to={`/admin/accounts/player/${encodeURIComponent(playerId)}/plan/${encodeURIComponent(plan.id)}/workout/${encodeURIComponent(workout.workoutId)}${context}`}
                      >
                        <span className="material-symbols-outlined">edit</span>Edit
                      </Link>
                    </div>
                  </header>
                  <ul className="admin-blocks">
                    {orderedBlocks(workout).map((block: any) => (
                      <li className="admin-block" key={block.blockId}>
                        <span className="admin-block-order">{block.order}</span>
                        <span className="admin-block-copy">
                          <strong>{block.name}</strong>
                          <span className="admin-block-dose">
                            {domainLabel(String(block.domain || ""))} · {blockDoseLine(block)}
                            {block.kind && block.kind !== "main" ? ` · ${block.kind}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                    {orderedBlocks(workout).length === 0 && (
                      <li className="admin-block"><span className="admin-block-dose">No drills in this workout.</span></li>
                    )}
                  </ul>
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

function StatusChip({ state, isNext }: { state: { kind: string; endReason?: string }; isNext: boolean }) {
  if (state.kind === "finished") {
    return <span className="admin-chip accent">{state.endReason === "completed" ? "done" : String(state.endReason)}</span>;
  }
  if (state.kind === "inProgress") return <span className="admin-chip warn">in progress</span>;
  if (isNext) return <span className="admin-chip accent">next</span>;
  return <span className="admin-chip">upcoming</span>;
}

// MARK: - The ground-truth record, read back

function AdjustmentHistory({ adjustments }: { adjustments: any[] }) {
  if (!adjustments.length) return null;
  return (
    <section className="admin-card">
      <h3>Adjustments made to this plan</h3>
      <p className="admin-note">
        Every saved edit and the reason given for it. This is the record a future generator is
        evaluated against, so it is append-only — nothing here can be edited or deleted.
      </p>
      <div className="admin-adjustments">
        {adjustments.map(adjustment => (
          <article className="admin-adjustment" key={adjustment.id}>
            <div className="admin-row-meta">
              <span className="admin-chip">Week {adjustment.weekNumber} · {adjustment.workoutId}</span>
              <span>rev {adjustment.baseRevision} → {adjustment.newRevision}</span>
              <span>{adjustment.editor?.role ?? "editor"} on {adjustment.editor?.surface ?? "?"}</span>
              {adjustment.diff?.minutesDelta ? (
                <span>{adjustment.diff.minutesDelta > 0 ? "+" : ""}{adjustment.diff.minutesDelta} min</span>
              ) : null}
              {(adjustment.diff?.added || []).length > 0 && <span>+{adjustment.diff.added.length} drills</span>}
              {(adjustment.diff?.removed || []).length > 0 && <span>−{adjustment.diff.removed.length} drills</span>}
              {(adjustment.warningsOverridden || []).length > 0 && (
                <span className="admin-chip warn">{adjustment.warningsOverridden.length} warnings accepted</span>
              )}
            </div>
            <blockquote>{adjustment.rationale}</blockquote>
          </article>
        ))}
      </div>
    </section>
  );
}
