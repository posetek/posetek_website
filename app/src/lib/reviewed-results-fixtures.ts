/** Invented preview/test data only. No real athlete identity or recording. */
export function reviewedResultFixtures() {
  const recordedAtMillis = Date.UTC(2026, 0, 10, 18), reviewedAtMillis = Date.UTC(2026, 0, 11, 18);
  const samples = [
    ['jump', 'jumpHeight', .34, 'm', null], ['jump', 'jumpHeight', .24, 'm', null],
    ['changeOfDirection', 'totalTime', 4.3, 's', null], ['dribbling', 'totalTime', 7.7, 's', 'right'],
    ['broadJump', 'broadJumpDistance', .9, 'm', null], ['broadJump', 'broadJumpDistance', .82, 'm', null],
    ['jump', 'jumpHeight', null, 'm', null], ['jump', 'jumpHeight', null, 'm', null],
    ['broadJump', 'broadJumpDistance', null, 'm', null], ['broadJump', 'broadJumpDistance', null, 'm', null],
  ];
  return samples.map(([drill, metric, value, unit, protocolSide], i) => ({
    id: `review-preview-${i + 1}`, repType: drill, drillType: drill,
    sessionNumber: 10 + i, repNumber: 1, createdAtMillis: recordedAtMillis + i * 1000,
    processingStatus: value === null ? 'failed' : 'partial', resultsValid: false,
    failedAttempt: value === null, jumpHeight: null, broadJumpDistance: null, totalTime: null,
    resultStatus: { qualified: false, duplicate: false, reason: 'needsReview', revisionId: `review-preview-revision-${i + 1}` },
    reviewedResult: { schemaVersion: 1, status: value === null ? 'retest_required' : 'estimate', metric, value, unit,
      label: value === null ? 'Retest needed' : 'ESTIMATE', protocolSide,
      revisionId: `review-preview-revision-${i + 1}`, reviewedAtMillis, excludeFromVerifiedRankings: true },
  }));
}
