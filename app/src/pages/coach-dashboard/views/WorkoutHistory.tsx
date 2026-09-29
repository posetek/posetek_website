/* eslint-disable @typescript-eslint/no-explicit-any */
import { hoursLine } from '../lib/logic';
import { OUTCOME_LABELS, workoutHistory } from '../lib/history';
import type { WorkoutHistoryEntry } from '../lib/history';
import type { ReactNode } from 'react';
import { blockDoseLine } from '../../../lib/contracts/drillV2';

const when = (value: number | null) => value === null ? 'Date not recorded' : new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function WorkoutHistory({ logs }: { logs: Record<string, any>[] }) {
  const rows = workoutHistory(logs);
  return <section className="coachdash-history" aria-label="Workout history">
    <header><h2>Recorded workouts</h2><p className="coachdash-sub">Saved prescriptions and reported sets from each session. Changes to the current program never rewrite this history.</p></header>
    {!rows.length && <div className="empty-card"><h3>No recorded workouts yet</h3><p>A prescribed program appears above; workout activity appears here after the player starts tracking.</p></div>}
    {rows.map(entry => <WorkoutHistoryCard key={entry.id} entry={entry} />)}
  </section>;
}

/** Shared saved-history presentation; callers cannot replace its prescription with a current plan. */
export function WorkoutHistoryCard({ entry, formatTime = when, expanded = false, children }: {
  entry: WorkoutHistoryEntry; formatTime?: (value: number | null) => string; expanded?: boolean; children?: ReactNode;
}) {
  return <article className="week-card">
      <header><div><p className="eyebrow">{entry.log.source === 'personal' ? 'Personal workout' : entry.log.source === 'adhoc' ? 'Extra workout' : entry.log.planId ? 'Program workout' : 'Recorded workout'}</p>
        <h3>{entry.snapshot?.title || 'Workout'}</h3><p className="coachdash-sub">{formatTime(entry.start)}{entry.log.workoutRevision ? ` · Saved revision ${entry.log.workoutRevision}` : ''}</p></div>
        <span className="plan-chip">{OUTCOME_LABELS[entry.status]}</span></header>
      <dl className="coachdash-player-metrics">
        <div><dt>Recorded time</dt><dd>{entry.timerSeconds !== null ? `${hoursLine(entry.timerSeconds)} timer`
          : entry.estimatedSeconds !== null ? `${hoursLine(entry.estimatedSeconds)} elapsed estimate` : 'Unknown'}</dd></div>
        <div><dt>Sets reported</dt><dd>{entry.setsCompleted}</dd></div>
        <div><dt>Drill outcomes</dt><dd>{entry.doneBlocks} done · {entry.partialBlocks} partial · {entry.skippedBlocks} skipped</dd></div>
        <div><dt>Prescribed sets</dt><dd>{!entry.prescribedKnown ? 'Prescription unknown' : entry.allSetsCompleted ? 'All completed' : 'Not all completed'}</dd></div>
      </dl>
      {entry.end !== null && <p className="coachdash-sub">Ended {formatTime(entry.end)}</p>}
      {entry.log.endReason === 'pain' && <p className="coachdash-notice">The player stopped because of pain.</p>}
      {entry.duplicateLogs > 0 && <p className="coachdash-sub">{entry.duplicateLogs} linked duplicate {entry.duplicateLogs === 1 ? 'log' : 'logs'} counted once.</p>}
      <details open={expanded || undefined}><summary>Saved drill prescription and outcomes</summary>
        {Array.isArray(entry.snapshot?.blocks) && entry.snapshot.blocks.length ? <ul className="drill-list">{entry.snapshot.blocks.map((block: any) => {
          const done = entry.blocks.find(row => row.blockId === block.blockId), sets = block.sets ?? block.dose?.sets;
          return <li key={block.blockId} className="drill-row"><div className="drill-copy"><strong>{block.name || 'Drill'}</strong>
            <span className="drill-meta">{blockDoseLine(block)}</span><span>{done ? `${done.setsCompleted ?? 0} / ${sets ?? '?'} sets · ${done.status || 'Status unknown'}` : 'No set outcome recorded'}</span>
            {done?.skipReason && <span className="drill-note">Reason: {done.skipReason}</span>}</div></li>;
        })}</ul> : <><p>The original prescription was not saved for this session. Current program details are not substituted.</p>
          {entry.blocks.map(block => <p key={block.blockId}>{block.name || block.drillId || 'Drill'}: {block.setsCompleted ?? 0} sets · {block.status || 'Status unknown'}{block.skipReason ? ` · ${block.skipReason}` : ''}</p>)}</>}
      </details>
      {children}
    </article>;
}
