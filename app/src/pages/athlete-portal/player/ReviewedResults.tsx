import { reviewedResultLabel, reviewedResultValue, type ReviewedResult } from '../../../lib/reviewed-results';
import './reviewed-results.css';

function date(ms: number) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms)); }
export function ReviewedResultStatus({ result }: { result: ReviewedResult }) {
  return <><span className={`reviewed-result-badge${result.status === 'retest_required' ? ' reviewed-retest' : ''}`}>{result.status === 'estimate' ? 'ESTIMATE' : 'RETEST NEEDED'}</span><strong className="reviewed-result-value">{reviewedResultValue(result)}</strong></>;
}
export function ReviewedResultDetail({ result }: { result: ReviewedResult }) {
  return <section className="portal-card reviewed-result-detail" aria-label={`${reviewedResultLabel(result)} reviewed result`}>
    <p className="eyebrow">Reviewed test</p><h2>{reviewedResultLabel(result)}</h2>
    <ReviewedResultStatus result={result} />
    <p>{result.status === 'estimate' ? 'This approximate value was recovered during a review of the recorded test. It is shown separately from verified measurements and is not included in skill scores, personal bests or leaderboards.' : 'The saved recording does not support a usable measurement. Repeat this test to get a result; this is not a zero or a score.'}</p>
    <p className="muted-copy">Tested {date(result.recordedAtMillis)} · Reviewed {date(result.reviewedAtMillis)}</p>
  </section>;
}
export default function ReviewedResults({ results, onOpen }: { results: ReviewedResult[]; onOpen?: (result: ReviewedResult) => void }) {
  if (!results.length) return null;
  return <section className="portal-card reviewed-results" aria-labelledby="reviewed-results-title">
    <p className="eyebrow">Your reviewed tests</p><h2 id="reviewed-results-title">Estimates and retests</h2>
    <p className="muted-copy">Recovered estimates are approximate. They stay separate from verified scores and leaderboards. Tests that need repeating are not counted as zero.</p>
    <ul>{results.map(result => <li key={result.repId}>
      <div><h3>{reviewedResultLabel(result)}</h3><small>Tested {date(result.recordedAtMillis)}</small></div>
      <div className="reviewed-result-measurement"><ReviewedResultStatus result={result} />{onOpen && <button className="hub-secondary" onClick={() => onOpen(result)}>View review</button>}</div>
    </li>)}</ul>
  </section>;
}
