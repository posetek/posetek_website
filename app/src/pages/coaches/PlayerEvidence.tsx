import { useId } from "react";
import { profileAreas, resolvePlayer, resolveTeam, type SamplePlayer } from "./coach-samples";
import "./coaches-examples.css";

function ProfileRadar({ player }: { player: SamplePlayer }) {
  const titleId = useId();
  const descriptionId = useId();
  const point = (index: number, radius: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
    return [170 + Math.cos(angle) * radius, 153 + Math.sin(angle) * radius];
  };
  const points = (radius: number) => profileAreas.map((_, index) => point(index, radius).join(",")).join(" ");
  return <figure className="cx-profile-radar"><figcaption><strong>Five areas. One player.</strong><span>Illustrative scores / 100</span></figcaption><svg viewBox="0 0 340 304" role="img" aria-labelledby={`${titleId} ${descriptionId}`}><title id={titleId}>{`${player.name} — sample player profile`}</title><desc id={descriptionId}>{profileAreas.map((area, index) => `${area}: ${player.scores[index]} out of 100`).join(". ")}. Fictional scores for illustration.</desc>{[.25, .5, .75, 1].map(scale => <polygon key={scale} className="cx-radar-grid" points={points(90 * scale)} />)}{profileAreas.map((area, index) => { const [x, y] = point(index, 90); return <line className="cx-radar-axis" key={area} x1="170" y1="153" x2={x} y2={y} />; })}<polygon className="cx-radar-shape" points={player.scores.map((score, index) => point(index, score * .9).join(",")).join(" ")} />{profileAreas.map((area, index) => { const [x, y] = point(index, player.scores[index] * .9); const [labelX, labelY] = point(index, 126); return <g key={area}><circle className="cx-radar-point" cx={x} cy={y} r="3.5" /><text x={labelX} y={labelY - 1} textAnchor="middle" className="cx-radar-label">{area}<tspan x={labelX} dy="18" className="cx-radar-value">{player.scores[index]}</tspan></text></g>; })}</svg></figure>;
}

export function PlayerEvidence({ teamId, playerId, onPlayerChange }: { teamId: string; playerId: string; onPlayerChange: (playerId: string) => void }) {
  const team = resolveTeam(teamId);
  const player = resolvePlayer(teamId, playerId);
  const panelId = useId();
  return <div className="cx-evidence" aria-label="Illustrative player evidence">
    <div className="cx-evidence-top"><span>{team.name} / Individual insight</span><span className="cx-example-label">Illustrative example</span></div>
    <div className="cx-evidence-layout">
      <div className="cx-player-options" role="group" aria-label={`Choose a sample player from ${team.name}`}><span className="cx-overline">Choose a player</span>{team.players.map(item => <button type="button" key={item.id} aria-pressed={item.id === player.id} aria-controls={panelId} onClick={() => onPlayerChange(item.id)}><span className="cx-shirt-number" aria-hidden="true">{String(item.number).padStart(2, "0")}</span><span><strong>{item.name}</strong><small>{item.position}</small></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" /></svg></button>)}<p>Different players.<br />Different next steps.</p></div>
      <div id={panelId} className="cx-player-detail">
        <div className="cx-player-heading"><div><span className="cx-overline">Player profile</span><h3>{player.name}</h3></div><span>{player.position} · {team.name}</span></div>
        <div className="cx-player-insight"><ProfileRadar player={player} /><div className="cx-priority"><div className="cx-assessment"><span className="cx-overline">Latest dribbling test</span><p><strong>{player.latestDribbleSeconds.toFixed(2)}</strong><span>sec</span></p><span className="cx-assessment-note">One result within the wider picture.</span></div><div className="cx-training-focus" aria-live="polite"><span className="cx-overline">Next training focus</span><h4>{player.focus}</h4><p>{player.drillId === "DRB-006" ? "Figure-8 dribble" : "Wall pass rhythm"}<span aria-hidden="true"> ↗</span></p></div></div></div>
      </div>
    </div>
  </div>;
}
