import type { ProvisionalEstimate } from '../../lib/provisional-estimates';
import './provisional-estimate.css';

export default function ProvisionalEstimateNote({ estimate, score, planning = false, scoreLabel = 'vs D1' }: {
  estimate: ProvisionalEstimate; score?: number | null; planning?: boolean; scoreLabel?: string;
}) {
  const agility = estimate.drill === 'changeOfDirection';
  return <aside className="provisional-estimate-note" aria-label={`Estimated ${agility ? 'agility' : 'dribbling'} result`}>
    <div><strong>{agility ? 'Agility' : 'Ball Control'} · Estimated</strong><span>About {estimate.estimatedTotalSeconds.toFixed(1)} s{score != null ? ` · ${Math.round(score)} ${scoreLabel}` : ''}</span></div>
    <p>{agility ? `Coach-confirmed shuttle. About ${Math.round(estimate.observedCourseFraction * 100)}% of the course is visible; the start is visually estimated and most of the return is projected.` : 'Finish not recorded. Uses the originally detected start and assumes the observed return pace continued.'}</p>
    <small>{planning ? 'Included as low-confidence coaching context for this plan.' : 'Hollow chart marker = estimate. Ratings, rankings and completed-test counts exclude it.'} A valid {agility ? 'Change of Direction' : 'Dribbling'} test replaces this estimate automatically.</small>
    <details><summary>Estimate assumptions</summary><p>A ±20% pace scenario gives {estimate.lowerSeconds.toFixed(2)}–{estimate.upperSeconds.toFixed(2)} s. This is a sensitivity range, not a confidence interval; {agility ? 'start timing, later acceleration or slowing, and an unseen pause could change it. This has substantially more missing movement than the near-finish dribbling estimates.' : 'an unseen pause or loss of the ball could change it.'}</p></details>
  </aside>;
}
