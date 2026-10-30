import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseReviewedResults, reviewedResultLabel, reviewedResultValue, reviewRefreshIsCurrent } from './reviewed-results';
import { reviewedResultFixtures } from './reviewed-results-fixtures';
import { metricValue, visibleAttempts } from './result-values';
import { allStatsReps } from '../pages/athlete-portal/lib/metrics';
import { DRILLS, drillByKey } from '../pages/athlete-portal/lib/drills';
import { playerProfile, intakeSnapshot } from '../pages/athlete-portal/player/scoring';
import { previewData } from '../pages/athlete-portal/lib/preview';
import ReviewedResults, { ReviewedResultDetail } from '../pages/athlete-portal/player/ReviewedResults';
import PlayerProfile from '../pages/athlete-portal/player/PlayerProfile';
import DrillDashboard from '../pages/athlete-portal/views/DrillDashboard';
import SessionView from '../pages/athlete-portal/views/SessionView';

describe('parent reviewed result display contract', () => {
  it('retains all six estimates and four failed retests without reviving ordinary failed rows', () => {
    const rows = reviewedResultFixtures(), reviews = parseReviewedResults(rows);
    expect(reviews.filter(r => r.status === 'estimate')).toHaveLength(6);
    expect(reviews.filter(r => r.status === 'retest_required')).toHaveLength(4);
    expect(visibleAttempts(rows)).toHaveLength(6);
    expect(reviews.map(reviewedResultValue)).toEqual(expect.arrayContaining(['~34 cm', '~24 cm', '~4.3 s', '~7.7 s', '~0.9 m', '~0.82 m', 'Retest needed']));
    expect(reviews.map(reviewedResultLabel)).toContain('Right dribble');
    expect(rows.every(r => r.jumpHeight === null && r.totalTime === null && r.broadJumpDistance === null)).toBe(true);
  });

  it('drops mismatched, stale, duplicate, malformed and non-display projections', () => {
    const good = reviewedResultFixtures()[0];
    const candidates: any[] = [
      { ...good, resultStatus: { ...good.resultStatus, revisionId: 'old' } },
      { ...good, resultStatus: { ...good.resultStatus, qualified: true } },
      { ...good, resultStatus: { ...good.resultStatus, duplicate: true } },
      { ...good, resultStatus: undefined }, { ...good, sessionNumber: 0 },
      { ...good, repNumber: 1.5 }, { ...good, createdAtMillis: Infinity },
      { ...good, createdAtMillis: 9e15 }, { ...good, repType: 'deadballShot' },
      ...[
        { schemaVersion: 2 }, { label: 'Verified' }, { excludeFromVerifiedRankings: false },
        { metric: 'totalTime' }, { unit: 's' }, { value: 0 }, { value: NaN }, { value: '0.34' },
        { status: 'retest_required', label: 'Retest needed', value: .34 },
        { protocolSide: 'left' }, { reviewedAtMillis: good.createdAtMillis - 1 },
      ].map(change => ({ ...good, reviewedResult: { ...good.reviewedResult, ...change } })),
    ];
    for (const row of candidates) expect(parseReviewedResults([row])).toEqual([]);
    expect(parseReviewedResults([good, good])).toEqual([]);
    expect(parseReviewedResults({ reps: [good] })).toEqual([]);
    const withPrivateFields = { ...good, phone: 'never render', reviewedResult: { ...good.reviewedResult, notes: 'private', reviewerUid: 'private', sourcePath: 'private' } };
    expect(JSON.stringify(parseReviewedResults([withPrivateFields]))).not.toMatch(/private|phone|sourcePath|reviewerUid|notes/);
  });

  it('never promotes recovered values into scores, training intake or personal bests', () => {
    const rows = reviewedResultFixtures();
    for (const row of rows) for (const metric of ['jumpHeight', 'totalTime', 'broadJumpDistance']) expect(metricValue(row, metric)).toBeNull();
    const reps = Object.fromEntries(DRILLS.map(d => [d.key, rows.filter(r => r.repType === d.key)]));
    expect(allStatsReps(reps)).toEqual([]);
    expect(playerProfile(rows).overall).toBeNull();
    expect(intakeSnapshot(playerProfile(rows)).drills).toEqual([]);
    const preview = previewData(true), measuredLeft = preview.reps.dribbling.filter(r => r.id === 'review-preview-qualified-left');
    expect(allStatsReps(preview.reps)).toEqual(measuredLeft.map(r => ({ ...r, _statsDrill: 'dribbling' })));
    expect(playerProfile(allStatsReps(preview.reps))).toEqual(playerProfile(measuredLeft));
    expect(preview.reviewedResults?.find(r => r.protocolSide === 'right')?.value).toBe(7.7);
  });

  it('shows matching labelled values on the actual profile, results list and detail even without media', () => {
    const preview = previewData(true), reviews = preview.reviewedResults!;
    const ctx = { ...preview, notify: () => {}, allStatsReps: () => allStatsReps(preview.reps), allResultReps: () => Object.values(preview.reps).flat() };
    const profile = renderToStaticMarkup(<PlayerProfile ctx={ctx} profile={playerProfile(ctx.allStatsReps())} onDrills={() => {}} />);
    expect(profile).toContain('Jordan Example');
    expect(profile).toContain('Estimates and retests');
    expect(profile.match(/>ESTIMATE</g)).toHaveLength(6);
    expect(profile.match(/>RETEST NEEDED</g)).toHaveLength(4);
    expect(profile.indexOf('Estimates and retests')).toBeLessThan(profile.indexOf('Your skill map'));
    for (const result of reviews) {
      const drill = drillByKey(result.drill);
      const list = renderToStaticMarkup(<DrillDashboard drill={drill} reps={preview.reps[result.drill]} reviewedResults={[result]} athlete={preview.athlete} onOpenRep={() => {}} />);
      const detail = renderToStaticMarkup(<SessionView drill={drill} folder={`session${result.sessionNumber}`} selectedId={result.repId} reps={preview.reps[result.drill]} reviewedResults={reviews} access="preview" playerId={preview.playerId} shareToken={null} onBack={() => {}} onSelectRep={() => {}} />);
      for (const html of [profile, list, detail]) expect(html).toContain(reviewedResultValue(result));
      expect(detail).not.toContain('Loading rep analysis');
      expect(detail).toContain(result.status === 'estimate' ? 'not included in skill scores' : 'this is not a zero');
    }
    expect(renderToStaticMarkup(<ReviewedResults results={[]} />)).toBe('');
    expect(renderToStaticMarkup(<ReviewedResultDetail result={reviews[0]} />)).not.toContain('private');
  });

  it('fails freshness checks across logout, account change, superseded requests and unmount', () => {
    expect(reviewRefreshIsCurrent('owner', 'owner', true, 2, 2)).toBe(true);
    for (const args of [['owner', 'other', true, 2, 2], ['owner', undefined, true, 2, 2], [undefined, undefined, true, 2, 2], ['owner', 'owner', false, 2, 2], ['owner', 'owner', true, 1, 2]] as const) {
      expect(reviewRefreshIsCurrent(args[0], args[1], args[2], args[3], args[4])).toBe(false);
    }
  });
});
