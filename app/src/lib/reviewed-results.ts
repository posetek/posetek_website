/** Display-only evidence from the authorized effective-results projection.
 * Never feed these entries to measured metrics, scores, trends or leaderboards. */
export type ReviewedDrill = 'jump' | 'broadJump' | 'dribbling' | 'changeOfDirection';
export interface ReviewedResult {
  repId: string;
  drill: ReviewedDrill;
  sessionNumber: number;
  repNumber: number;
  recordedAtMillis: number;
  reviewedAtMillis: number;
  revisionId: string;
  status: 'estimate' | 'retest_required';
  metric: 'jumpHeight' | 'broadJumpDistance' | 'totalTime';
  value: number | null;
  unit: 'm' | 's';
  protocolSide: 'left' | 'right' | null;
}
const expected = { jump: ['jumpHeight', 'm'], broadJump: ['broadJumpDistance', 'm'], dribbling: ['totalTime', 's'], changeOfDirection: ['totalTime', 's'] } as const;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const timestamp = (v: unknown): v is number => positive(v) && v <= 8.64e15;
const index = (v: unknown): v is number => positive(v) && Number.isSafeInteger(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;

export function parseReviewedResults(rows: unknown): ReviewedResult[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>(), duplicated = new Set<string>();
  const entries: ReviewedResult[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !id(row.id)) continue;
    if (seen.has(row.id)) duplicated.add(row.id);
    seen.add(row.id);
    const r = row.reviewedResult, status = row.resultStatus;
    const drill = row.repType || row.drillType;
    if (!Object.hasOwn(expected, drill) || !r || typeof r !== 'object') continue;
    const [metric, unit] = expected[drill as ReviewedDrill];
    if (r.schemaVersion !== 1 || !['estimate', 'retest_required'].includes(r.status)
      || r.label !== (r.status === 'estimate' ? 'ESTIMATE' : 'Retest needed')
      || r.excludeFromVerifiedRankings !== true || r.metric !== metric || r.unit !== unit
      || !id(r.revisionId) || status?.revisionId !== r.revisionId
      || status.qualified !== false || status.duplicate !== false
      || !index(row.sessionNumber) || !index(row.repNumber)
      || !timestamp(row.createdAtMillis) || !timestamp(r.reviewedAtMillis)
      || r.reviewedAtMillis < row.createdAtMillis
      || !['left', 'right', null].includes(r.protocolSide)
      || drill !== 'dribbling' && r.protocolSide !== null
      || (r.status === 'estimate' ? !positive(r.value) : r.value !== null)) continue;
    entries.push({ repId: row.id, drill, sessionNumber: row.sessionNumber, repNumber: row.repNumber,
      recordedAtMillis: row.createdAtMillis, reviewedAtMillis: r.reviewedAtMillis,
      revisionId: r.revisionId, status: r.status, metric, value: r.value, unit,
      protocolSide: r.protocolSide });
  }
  return entries.filter(r => !duplicated.has(r.repId)).sort((a, b) => b.recordedAtMillis - a.recordedAtMillis || a.repId.localeCompare(b.repId));
}

export function reviewedResultLabel(r: ReviewedResult): string {
  if (r.drill === 'dribbling') return r.protocolSide ? `${r.protocolSide === 'left' ? 'Left' : 'Right'} dribble` : 'Dribbling';
  return ({ jump: 'Vertical jump', broadJump: 'Broad jump', changeOfDirection: 'Shuttle / no ball' } as const)[r.drill];
}
export function reviewedResultValue(r: ReviewedResult): string {
  if (r.status === 'retest_required' || r.value === null) return 'Retest needed';
  if (r.drill === 'jump') return `~${Number((r.value * 100).toFixed(1))} cm`;
  return `~${Number(r.value.toFixed(r.unit === 's' ? 1 : 2))} ${r.unit}`;
}

/** A stale reply must not restore review data after a newer request or owner change. */
export function reviewRefreshIsCurrent(expectedUid: string | undefined, currentUid: string | undefined, alive: boolean, requestVersion: number, currentVersion: number): boolean {
  return !!expectedUid && expectedUid === currentUid && alive && requestVersion === currentVersion;
}
