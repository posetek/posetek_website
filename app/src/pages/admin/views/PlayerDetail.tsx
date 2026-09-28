// One athlete under Monitor accounts: the profile inputs the generator reads,
// the private coach note, plan generation, and **every workout listed
// vertically** — "the workouts are listed out vertically that shows the drills
// in each workout and dose for those drills … so the admin can scroll down to
// see all of the workouts that have been built for that athlete."
//
// Read-only for athlete evidence: an admin inspects logs and edits
// prescriptions, and never starts, completes or alters work as the athlete
// (identity §6, 01A Q19).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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
import { loadAthleteBundle } from "../../coach-dashboard/lib/data";
import {
  COACH_NOTE_MAX_CHARS,
  activePlan,
  clearCoachNote,
  eligibilityFor,
  loadCoachNote,
  loadCoachOfPlayer,
  loadPlanAdjustments,
  loadPlayer,
  loadPlayerPlans,
  loadWorkoutLogs,
  resolvePlayerAge,
  saveCoachNote,
  savePlayerProfile,
} from "../lib/accounts";
import type { CoachNote, CoachRow, PlayerRow } from "../lib/accounts";
import { accountContext, accountPlayerPath, accountQuery, accountReturnPath } from "../lib/accountHierarchy";
import { RESULT_DRILLS, resultsPath } from "../lib/results";
import PlayerAiIncidents from "./PlayerAiIncidents";
import PlayerWorkoutHistory from "./PlayerWorkoutHistory";

export default function PlayerDetail() {
  const { playerId = "" } = useParams();
  const [query] = useSearchParams();
  const navigation = accountContext(query);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [coach, setCoach] = useState<CoachRow | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [note, setNote] = useState<CoachNote | null>(null);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const found = await loadPlayer(playerId);
    if (!found) throw new Error("That athlete could not be found.");
    setPlayer(found);
    const [foundCoach, foundPlans, foundLogs, foundNote] = await Promise.all([
      loadCoachOfPlayer(found).catch(() => null),
      loadPlayerPlans(playerId),
      loadWorkoutLogs(playerId),
      loadCoachNote(playerId).catch(() => null),
    ]);
    setCoach(foundCoach);
    setPlans(foundPlans);
    setLogs(foundLogs);
    setNote(foundNote);
    const active = activePlan(foundPlans);
    setAdjustments(active ? await loadPlanAdjustments(playerId, active.id).catch(() => []) : []);
  }, [playerId]);

  useEffect(() => {
    document.title = "Athlete | PoseTek admin";
    let live = true;
    reload()
      .then(() => loadAthleteBundle(playerId).then(bundle => { if (live) setReps(bundle.reps); }).catch(() => undefined))
      .catch((loadError: any) => { if (live) setError(loadError?.message || "That athlete could not be loaded."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [playerId, reload]);

  const plan = useMemo(() => activePlan(plans), [plans]);
  const resolvedAge = useMemo(() => (player ? resolvePlayerAge(player.raw) : null), [player]);
  const eligibility = useMemo(() => eligibilityFor(player, coach), [player, coach]);

  if (loading) return <div className="portal-loading"><span className="spinner" /><p>Loading the athlete…</p></div>;
  if (!player) return <p className="form-message" role="alert">{error}</p>;

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" to={accountReturnPath(navigation)} aria-label="Back">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">Athlete{player.organizationId ? " · organization member" : coach ? ` · ${coach.name}` : ""}</p>
          <h1>{player.name}</h1>
          <p>
            {player.email || "No email on file"} ·{" "}
            {resolvedAge?.age !== null && resolvedAge ? `${resolvedAge.age} years old` : "age unknown"} ·
            {" "}drills up to difficulty {eligibility.maxDrillDifficulty} ({eligibility.source})
          </p>
        </div>
        <div className="admin-heading-actions">
          <Link className="primary-cta small" to={accountPlayerPath(player.id, navigation, true)}>
            <span className="material-symbols-outlined">analytics</span>Recorded results
          </Link>
          <Link className="quiet-button" to={`/athlete?player=${player.id}`}>
            <span className="material-symbols-outlined">open_in_new</span>Their portal
          </Link>
        </div>
      </section>

      {error && <p className="form-message" role="alert">{error}</p>}

      <ResultsCard playerId={player.id} reps={reps} context={accountQuery(navigation)} />

      <PlayerWorkoutHistory key={`workout-history:${player.id}`} playerId={player.id} />

      <div className="admin-grid-two">
        <ProfileCard key={String(player.raw?.updatedAt?.seconds ?? player.id)} player={player} coach={coach} onSaved={reload} />
        <CoachNoteCard playerId={playerId} note={note} onSaved={reload} />
      </div>

      <PlanSection
        playerId={playerId}
        player={player}
        plan={plan}
        plans={plans}
        logs={logs}
        context={accountQuery(navigation)}
      />

      {plan && isV3Plan(plan) && <AdjustmentHistory adjustments={adjustments} />}

      <PlayerAiIncidents key={player.id} playerId={player.id} />
    </>
  );
}

// MARK: - Recorded results → the rep tools

function ResultsCard({ playerId, reps, context }: { playerId: string; reps: any[]; context: string }) {
  return (
    <section className="admin-card">
      <div className="admin-heading" style={{ marginBottom: 8 }}>
        <div>
          <h2>Recorded results</h2>
          <p>Every drill this athlete has recorded. Open one to inspect its sessions and reps, or to fix a rep that did not process correctly.</p>
        </div>
      </div>
      <div className="admin-results-grid">
        {RESULT_DRILLS.map(drill => {
          const count = reps.filter(rep => rep._statsDrill === drill.key).length;
          return (
            <Link key={drill.key} className={`admin-result-tile${count ? "" : " empty"}`} to={resultsPath(playerId, drill.key) + context}>
              <span className="material-symbols-outlined">{drill.icon}</span>
              <strong>{drill.label}</strong>
              <span>{count} {count === 1 ? "rep" : "reps"}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// MARK: - Profile inputs

function ProfileCard({ player, coach, onSaved }: { player: PlayerRow; coach: CoachRow | null; onSaved: () => Promise<void> }) {
  const resolved = resolvePlayerAge(player.raw);
  const [position, setPosition] = useState<string>(String(player.raw?.position ?? ""));
  const [birthDate, setBirthDate] = useState<string>(() => {
    const value = player.raw?.birthDate;
    const date = value?.toDate ? value.toDate() : null;
    return date ? date.toISOString().slice(0, 10) : "";
  });
  const [age, setAge] = useState<string>(
    resolved.source === "playerDocAge" && resolved.age !== null ? String(resolved.age) : "",
  );
  const [cap, setCap] = useState<string>(
    typeof player.raw?.maxDrillDifficulty === "number" ? String(player.raw.maxDrillDifficulty) : "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
          </label>
        </div>
        <p className="admin-note">
          Age in use: {resolved.age ?? "unknown"} ({resolved.source}
          {resolved.stale ? ", recorded over a year ago — refresh it" : ""}). A recorded age is an
          observation, not a birthday, so it is never incremented automatically.
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
          <button className="primary-cta" type="button" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </section>
  );
}

// MARK: - The private coach note

function CoachNoteCard({ playerId, note, onSaved }: { playerId: string; note: CoachNote | null; onSaved: () => Promise<void> }) {
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
          <button className="primary-cta" type="button" disabled={saving} onClick={save}>
            {saving ? "Saving…" : text.trim() ? "Save note" : "Clear note"}
          </button>
        </div>
      </div>
    </section>
  );
}

// MARK: - The plan

function PlanSection({ playerId, player, plan, plans, logs, context }: {
  playerId: string; player: PlayerRow; plan: any | null; plans: any[]; logs: any[]; context: string;
}) {
  const query = new URLSearchParams(context);
  query.set("players", playerId);
  if (player.organizationId) query.set("orgId", player.organizationId);
  if (player.teamId) query.set("teamId", player.teamId);
  const version = plan ? planSchemaVersion(plan) : null;
  return <>
    <section className="admin-card"><div className="admin-heading">
      <div><h2>Training program</h2><p>{plan ? planHorizonWeeks(plan) + " weeks from " + String(plan.startDate ?? "—") : "No active plan yet."}</p></div>
      <Link className="primary-cta" to={"/admin/programs?" + query}>Open personalized planner</Link>
    </div><p>Build a draft from current evidence, review its workouts, then choose Use this plan.</p></section>
    {!plan && <div className="admin-banner"><p>This athlete has no active plan.{plans.length ? " " + plans.length + " older plans on file." : ""}</p></div>}
    {plan && version !== 3 && <LegacyPlanCard plan={plan} />}
    {plan && version === 3 && <WorkoutList playerId={playerId} plan={plan} logs={logs} />}
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

function WorkoutList({ playerId, plan, logs }: { playerId: string; plan: any; logs: any[] }) {
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
                        to={`/admin/accounts/player/${playerId}/plan/${plan.id}/workout/${workout.workoutId}`}
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
