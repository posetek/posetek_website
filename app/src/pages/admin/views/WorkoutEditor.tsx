// The workout editor — "click into a specific workout to edit and then they can
// search up drills on the left hand side, sort by domain, and drag in/set
// dosage as well as delete drills from the workout that currently exists."
//
// Everything structural lives in lib/editor.ts (pure) and lib/plans.ts (the
// transaction). This file is the surface: two panes, a live minute total from
// the shared formula, the error/warning split, and a Save that cannot complete
// without feedback or an explicit choice to provide none.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db } from "../../../lib/firebase";
import { blockDoseLine } from "../../../lib/contracts/drillV2";
import type { AthleteContext, CatalogDrill } from "../../../lib/contracts/drillV2";
import {
  findWorkout,
  nextWorkout,
  scheduledExposures,
  stateOf,
  workoutStates,
} from "../../../lib/contracts/planV3";
import { domainLabel, isPosition } from "../../../lib/contracts/types";
import type { BlockV3 } from "../../../lib/contracts/types";
import { eligibilityFor, loadCoachOfPlayer, loadPlayer, loadWorkoutLogs, resolvePlayerAge } from "../lib/accounts";
import type { PlayerRow } from "../lib/accounts";
import { adminPlayerPath } from "../lib/adminNavigation";
import { ADMIN_RETURN_STATE } from '../lib/useAdminNavigation';
import { loadCatalog } from "../lib/catalog";
import {
  MAX_BLOCKS,
  MAX_INTENT_CHARS,
  MAX_TITLE_CHARS,
  addBlock,
  diffWorkouts,
  draftFromWorkout,
  draftMinutes,
  errorsOf,
  isUnchanged,
  moveBlock,
  removeBlock,
  setDose,
  setMeta,
  snapshotOf,
  snapshotOfDraft,
  validateDraft,
  warningsOf,
} from "../lib/editor";
import type { DosePatch, Issue, WorkoutDraft } from "../lib/editor";
import { SaveError, loadFrequencyContext, loadGenerationContext, saveWorkoutEdit } from "../lib/plans";
import type { FrequencyContext, GenerationContext } from "../lib/plans";
import AdminDoseDialog from "./AdminDoseDialog";
import DrillPickerPane, { DRAG_BLOCK_PREFIX, DRAG_DRILL_PREFIX } from "./DrillPickerPane";
import RationaleDialog from "./RationaleDialog";
import TrainingLoadInstructions from "../../../components/TrainingLoadInstructions";

interface Loaded {
  player: PlayerRow;
  plan: any;
  week: any;
  workout: any;
  logs: any[];
  drills: CatalogDrill[];
  athlete: AthleteContext;
  frequency: FrequencyContext;
  context: GenerationContext;
}

export default function WorkoutEditor() {
  const { playerId = "", planId = "", workoutId = "" } = useParams();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const playerPath = adminPlayerPath(playerId, 'workouts', query.toString());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [doseTarget, setDoseTarget] = useState<BlockV3 | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const load = useCallback(async () => {
    const player = await loadPlayer(playerId);
    if (!player) throw new Error("That athlete could not be found.");
    const planDoc = await db.collection("players").doc(playerId).collection("trainingPlans").doc(planId).get();
    if (!planDoc.exists) throw new Error("That plan no longer exists.");
    const plan: any = { id: planDoc.id, ...planDoc.data() };
    if (Number(plan.schemaVersion) !== 3) throw new Error("The workout editor only opens schemaVersion 3 plans.");
    const found = findWorkout(plan, workoutId);
    if (!found) throw new Error(`Workout ${workoutId} is not in this plan.`);

    const [coach, logs, drills] = await Promise.all([
      loadCoachOfPlayer(player).catch(() => null),
      loadWorkoutLogs(playerId),
      loadCatalog(),
    ]);
    const eligibility = eligibilityFor(player, coach);
    const age = resolvePlayerAge(player.raw).age;
    const position = player.raw?.position;
    const athlete: AthleteContext = {
      age,
      maxDrillDifficulty: eligibility.maxDrillDifficulty,
      setting: String(plan.intake?.setting ?? "solo"),
      equipment: Array.isArray(plan.intake?.equipment) ? plan.intake.equipment.map(String) : [],
      position: isPosition(position) ? position : null,
    };
    const [frequency, context] = await Promise.all([
      loadFrequencyContext(playerId, plan, Number(found.week.weekNumber)),
      loadGenerationContext(playerId, planId),
    ]);

    setLoaded({ player, plan, week: found.week, workout: found.workout, logs, drills, athlete, frequency, context });
    setDraft(draftFromWorkout(plan.id, Number(found.week.weekNumber), found.workout, Number(plan.planRevision) || 1));
  }, [playerId, planId, workoutId]);

  useEffect(() => {
    document.title = `Edit ${workoutId} | PoseTek admin`;
    load().catch((error: any) => setLoadError(error?.message || "That workout could not be opened."));
  }, [load, workoutId]);

  const drillsById = useMemo(
    () => new Map((loaded?.drills ?? []).map(drill => [drill.drillId, drill])),
    [loaded],
  );

  const issues: Issue[] = useMemo(() => {
    if (!loaded || !draft) return [];
    return validateDraft(draft, {
      drills: drillsById,
      athlete: loaded.athlete,
      week: loaded.week,
      extraExposures: loaded.frequency.extraExposures,
    });
  }, [loaded, draft, drillsById]);

  const errors = useMemo(() => errorsOf(issues), [issues]);
  const warnings = useMemo(() => warningsOf(issues), [issues]);

  // How many workouts this week would use each drill with the current draft in
  // place — what the picker shows against each drill's weekly limit.
  const exposures = useMemo(() => {
    if (!loaded || !draft) return {};
    const map: Record<string, number> = {};
    for (const drill of loaded.drills) {
      const scheduled = scheduledExposures(loaded.week, drill.drillId, { workoutId: draft.workoutId, blocks: draft.blocks });
      const extra = loaded.frequency.extraExposures[drill.drillId] ?? 0;
      if (scheduled + extra > 0) map[drill.drillId] = scheduled + extra;
    }
    return map;
  }, [loaded, draft]);

  const before = useMemo(() => (loaded ? snapshotOf(loaded.workout) : null), [loaded]);
  const after = useMemo(() => (draft ? snapshotOfDraft(draft) : null), [draft]);
  const diff = useMemo(() => (before && after ? diffWorkouts(before, after) : null), [before, after]);
  const unchanged = useMemo(
    () => (before && after && diff ? isUnchanged(diff, before, after) : true),
    [before, after, diff],
  );

  const state = useMemo(() => {
    if (!loaded) return { kind: "notStarted" as const };
    return stateOf(
      workoutStates([String(loaded.plan.planId ?? ""), String(loaded.plan.id ?? "")], loaded.logs),
      workoutId,
    );
  }, [loaded, workoutId]);
  const isNext = useMemo(
    () => (loaded ? nextWorkout(loaded.plan, loaded.logs)?.workout?.workoutId === workoutId : false),
    [loaded, workoutId],
  );

  function tryAdd(drill: CatalogDrill, index?: number) {
    if (!draft) return;
    try {
      setDraft(addBlock(draft, drill, index));
      setBanner(null);
    } catch (error: any) {
      setBanner(error?.message || "That drill could not be added.");
    }
  }

  function handleDrop(event: DragEvent, index?: number) {
    event.preventDefault();
    setDropActive(false);
    const payload = event.dataTransfer.getData("text/plain");
    if (payload.startsWith(DRAG_DRILL_PREFIX)) {
      const drill = drillsById.get(payload.slice(DRAG_DRILL_PREFIX.length));
      if (drill) tryAdd(drill, index);
    } else if (payload.startsWith(DRAG_BLOCK_PREFIX) && draft) {
      setDraft(moveBlock(draft, payload.slice(DRAG_BLOCK_PREFIX.length), index ?? draft.blocks.length));
    }
  }

  async function commit(rationale: string, noFeedback: boolean) {
    if (!loaded || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveWorkoutEdit({
        playerId,
        planId,
        draft,
        rationale,
        noFeedback,
        warningsOverridden: warnings,
        frequency: loaded.frequency,
        setting: loaded.athlete.setting,
        equipment: loaded.athlete.equipment,
        generatorIntent: loaded.context.originalWorkouts[workoutId]?.intent ?? null,
        generatorCheck: loaded.context.originalChecks[workoutId] ?? null,
        generationContextRef: loaded.context.ref,
      });
      setConfirming(false);
      navigate(playerPath, {
        replace: true,
        state: { ...ADMIN_RETURN_STATE, saved: result.adjustmentId },
      });
    } catch (error: any) {
      if (error instanceof SaveError && (error.code === "workoutChanged" || error.code === "scheduleMoved")) {
        setSaveError(`${error.message} Your edit is still here — reload the current version, then re-apply it.`);
      } else {
        setSaveError(error?.message || "That edit could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="admin-banner danger">
        <span className="material-symbols-outlined">error</span>
        <p>{loadError} <Link state={ADMIN_RETURN_STATE} to={playerPath}>Back to the athlete</Link>.</p>
      </div>
    );
  }
  if (!loaded || !draft || !before || !after || !diff) {
    return <div className="portal-loading"><span className="spinner" /><p>Opening the workout…</p></div>;
  }

  const minutes = draftMinutes(draft);
  const original = loaded.context.originalWorkouts[workoutId];

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" state={ADMIN_RETURN_STATE} to={playerPath} aria-label="Back to the athlete">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">
            {loaded.player.name} · week {draft.weekNumber} · {workoutId} · revision {draft.baseRevision}
          </p>
          <h1>{draft.title || workoutId}</h1>
          <p>
            {state.kind === "inProgress"
              ? "This workout is open on the athlete's phone right now — their session keeps the version they started."
              : state.kind === "finished"
                ? "The athlete has already finished this workout. Editing it changes the prescription, never what they did."
                : isNext
                  ? "This is the athlete's next workout."
                  : "Upcoming."}
          </p>
        </div>
        <div className="admin-heading-actions">
          {original && (
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                if (!window.confirm("Load the originally generated workout into the editor? You still choose whether to save it.")) return;
                setDraft(draftFromWorkout(planId, draft.weekNumber, {
                  ...original,
                  revision: loaded.workout.revision,
                  nextBlockSequence: Math.max(
                    Number(loaded.workout.nextBlockSequence) || 1,
                    Number(original.nextBlockSequence) || 1,
                  ),
                }, Number(loaded.plan.planRevision) || 1));
                setBanner("Loaded the original generated workout. Review it, then save with feedback or select that you have none.");
              }}
            >
              <span className="material-symbols-outlined">restart_alt</span>Load the original
            </button>
          )}
          <button
            className="primary-cta"
            type="button"
            disabled={unchanged || errors.length > 0}
            onClick={() => { setSaveError(null); setConfirming(true); }}
          >
            <span className="material-symbols-outlined">save</span>Save
          </button>
        </div>
      </section>

      {banner && <div className="admin-banner"><span className="material-symbols-outlined">info</span><p>{banner}</p></div>}

      {!loaded.context.available && (
        <div className="admin-banner warn">
          <span className="material-symbols-outlined">history_toggle_off</span>
          <p>
            The immutable generation record for this plan is not readable, so the original workout
            cannot be restored and the adjustment record will note the generator's intent as
            unavailable rather than guessing at it.
          </p>
        </div>
      )}

      {!loaded.frequency.scheduleExists && (
        <div className="admin-banner danger">
          <span className="material-symbols-outlined">warning</span>
          <p>
            This athlete has no <code>workoutSchedule/current</code> counter. Saving needs it and a
            client cannot create it — the training engine writes it with the first v3 plan. Saving
            will fail until then.
          </p>
        </div>
      )}

      <div className="admin-editor">
        <DrillPickerPane
          drills={loaded.drills}
          athlete={loaded.athlete}
          exposures={exposures}
          onAdd={drill => tryAdd(drill)}
        />

        <div
          className={`admin-editor-main${dropActive ? " is-drop-target" : ""}`}
          onDragOver={event => { event.preventDefault(); setDropActive(true); }}
          onDragLeave={() => setDropActive(false)}
          onDrop={event => handleDrop(event)}
        >
          <div className="admin-form">
            <label className="admin-field">
              <span>Title</span>
              <input
                value={draft.title}
                maxLength={MAX_TITLE_CHARS}
                onChange={event => setDraft(setMeta(draft, { title: event.target.value }))}
              />
            </label>
            <label className="admin-field">
              <span>Written intention — what this session is for</span>
              <textarea
                value={draft.intent}
                maxLength={MAX_INTENT_CHARS}
                onChange={event => setDraft(setMeta(draft, { intent: event.target.value }))}
              />
            </label>
            <label className="admin-field" style={{ maxWidth: 220 }}>
              <span>Budget (minutes)</span>
              <input
                type="number" min={5} max={180} value={draft.budgetMinutes}
                onChange={event => setDraft(setMeta(draft, { budgetMinutes: Number(event.target.value) }))}
              />
            </label>
          </div>

          <ul className="admin-editor-blocks">
            {draft.blocks.map((block, index) => {
              const blockIssues = issues.filter(issue => issue.blockId === block.blockId);
              const hasError = blockIssues.some(issue => issue.severity === "error");
              const hasWarning = !hasError && blockIssues.length > 0;
              const drill = drillsById.get(block.drillId);
              return (
                <li
                  key={block.blockId}
                  className={`admin-editor-block${hasError ? " has-error" : ""}${hasWarning ? " has-warning" : ""}`}
                  draggable
                  onDragStart={event => {
                    event.dataTransfer.setData("text/plain", `${DRAG_BLOCK_PREFIX}${block.blockId}`);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => { event.stopPropagation(); handleDrop(event, index); }}
                >
                  <span className="admin-block-order">{block.order}</span>
                  <span className="admin-editor-block-copy">
                    <strong>{block.name}</strong>
                    <span className="admin-block-dose">
                      <span className="admin-chip accent">{domainLabel(block.domain)}</span>{" "}
                      {blockDoseLine(block)}
                      {drill ? ` · L${drill.difficultyLevel}` : " · not in the catalog"}
                    </span>
                    {block.whyIncluded && <span className="admin-block-dose">{block.whyIncluded}</span>}
                    <TrainingLoadInstructions block={block} />
                    {blockIssues.map((issue, position) => (
                      <span key={position} className={`admin-block-dose ${issue.severity}`}>{issue.message}</span>
                    ))}
                  </span>
                  <span className="admin-editor-block-actions">
                    <button className="icon-button" type="button" aria-label={`Move ${block.name} up`}
                            disabled={index === 0}
                            onClick={() => setDraft(moveBlock(draft, block.blockId, index - 1))}>
                      <span className="material-symbols-outlined">arrow_upward</span>
                    </button>
                    <button className="icon-button" type="button" aria-label={`Move ${block.name} down`}
                            disabled={index === draft.blocks.length - 1}
                            onClick={() => setDraft(moveBlock(draft, block.blockId, index + 1))}>
                      <span className="material-symbols-outlined">arrow_downward</span>
                    </button>
                    <button className="icon-button" type="button" aria-label={`Set the dose for ${block.name}`}
                            onClick={() => setDoseTarget(block)}>
                      <span className="material-symbols-outlined">tune</span>
                    </button>
                    <button className="icon-button danger" type="button" aria-label={`Delete ${block.name}`}
                            onClick={() => setDraft(removeBlock(draft, block.blockId))}>
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>

          {draft.blocks.length === 0 && (
            <p className="admin-drop-hint">Drag a drill here, or use Add in the list on the left.</p>
          )}
          {draft.blocks.length > 0 && draft.blocks.length < MAX_BLOCKS && (
            <p className="admin-drop-hint">Drop a drill here to add it at the end.</p>
          )}

          <div className="admin-time-bar">
            <strong>{minutes} min</strong>
            <span>
              of a {draft.budgetMinutes} min budget · {draft.blocks.length} drill
              {draft.blocks.length === 1 ? "" : "s"} · {Math.max(draft.blocks.length - 1, 0)} min of transitions
            </span>
            {unchanged && <span className="admin-chip">no changes yet</span>}
          </div>

          {issues.length > 0 && (
            <ul className="admin-issues">
              {errors.map((issue, index) => (
                <li key={`e${index}`} className="admin-issue error">
                  <span className="material-symbols-outlined">block</span>{issue.message}
                </li>
              ))}
              {warnings.map((issue, index) => (
                <li key={`w${index}`} className="admin-issue warning">
                  <span className="material-symbols-outlined">warning</span>{issue.message}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && errors.length === 0 && (
            <p className="admin-note">
              Warnings do not block the save; each one you save through is recorded with the edit.
            </p>
          )}
        </div>
      </div>

      {doseTarget && (
        <AdminDoseDialog
          block={draft.blocks.find(block => block.blockId === doseTarget.blockId) ?? doseTarget}
          drill={drillsById.get(doseTarget.drillId)}
          onCancel={() => setDoseTarget(null)}
          onSave={(patch: DosePatch) => {
            setDraft(setDose(draft, doseTarget.blockId, patch));
            setDoseTarget(null);
          }}
        />
      )}

      {confirming && (
        <RationaleDialog
          playerName={loaded.player.name}
          workoutTitle={draft.title || workoutId}
          diff={diff}
          warnings={warnings}
          minutesBefore={before.estimatedMinutes}
          minutesAfter={after.estimatedMinutes}
          inProgress={state.kind === "inProgress"}
          isNext={isNext}
          saving={saving}
          error={saveError}
          onCancel={() => setConfirming(false)}
          onSave={commit}
        />
      )}
    </>
  );
}
