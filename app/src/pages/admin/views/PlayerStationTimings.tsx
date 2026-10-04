import { useState } from "react";
import { playerDuration, playerStationTimings, timingAverage } from "../lib/playerStationTiming";
import type { PlayerRotationTiming } from "../lib/playerStationTiming";
import { time } from "../lib/teamProcessing";
import type { TeamSession } from "../lib/teamProcessing";
const COLORS=["#7eddaf","#86b9f7","#edbf78"];

export default function PlayerStationTimings({session}:{session:TeamSession}) {
  const players=playerStationTimings(session),average=timingAverage(players.map(p=>p.totalMs));
  return <section className="admin-card dp-section team-player-timings" aria-labelledby="player-timing-heading">
    <div className="team-section-heading"><div><p className="eyebrow">Player rotation</p><h2 id="player-timing-heading">Progress through each station</h2><p className="dp-muted">Time at every station, plus the full runthrough for each player.</p></div>
      <div className="team-circuit-average"><span>Average full runthrough / player</span><strong>{playerDuration(average.mean)}</strong><small>{average.count} / {players.length} players with all stations timed</small></div>
    </div>
    <p className="dp-muted team-timing-basis" id="player-timing-basis">Durations include pauses, from first capture to final result. Full runthrough also includes the gaps between stations. Pre-capture setup is not recorded.</p>
    <p className="dp-muted team-table-hint">Scroll sideways to compare all stations. The chart below also scrolls sideways.</p>
    <div className="dp-table-wrap"><table className="dp-table team-rotation" aria-labelledby="player-timing-heading" aria-describedby="player-timing-basis">
      <thead><tr><th>Player</th>{session.stations.map(st=><th key={st.id}>Station {st.order}<small>{st.label}</small></th>)}<th>Full runthrough<small>First capture → last result</small></th><th>Between stations<small>Gaps between recorded intervals</small></th></tr></thead>
      <tbody>{players.map(p=><tr id={`player-timing-${p.playerId}`} key={p.playerId}><th scope="row">{p.name}<small>{p.timedStations} / {p.stations.length} stations timed</small></th>{p.stations.map(st=><td key={st.stationId}><strong className="team-duration">{playerDuration(st.elapsedMs)}</strong>{st.elapsedMs!==null&&<small>{time(st.startedAt)} → {time(st.endedAt)}</small>}<small>{st.progress?`${st.progress.completed} / ${st.progress.planned} reps · ${st.progress.synced} synced`:"Progress not reported"}</small>{st.elapsedMs===null&&<small>{st.progress?.state==="notStarted"?"Not started":st.progress?.state?.startsWith("completed")?"Timing incomplete":"In progress / timing incomplete"}</small>}</td>)}<td><strong className="team-duration">{playerDuration(p.totalMs)}</strong>{p.stationMs!==null&&<small>{playerDuration(p.stationMs)} summed station time</small>}{p.overlapMs!==null&&p.overlapMs>1&&<small>Station clocks overlap by {playerDuration(p.overlapMs)}</small>}</td><td><strong>{playerDuration(p.betweenMs)}</strong></td></tr>)}</tbody>
      <tfoot><tr><th scope="row">Average / player</th>{session.stations.map(st=>{const avg=timingAverage(players.map(p=>p.stations.find(s=>s.stationId===st.id)?.elapsedMs??null));return <td key={st.id}><strong>{playerDuration(avg.mean)}</strong><small>{avg.count} players timed</small></td>;})}<td><strong>{playerDuration(average.mean)}</strong><small>{average.count} complete runthroughs</small></td><td><strong>{playerDuration(timingAverage(players.map(p=>p.betweenMs)).mean)}</strong><small>{average.count} complete runthroughs</small></td></tr></tfoot>
    </table></div>
    <PlayerStationTimeline players={players} session={session}/>
  </section>;
}

export function PlayerStationTimeline({players,session}:{players:PlayerRotationTiming[];session:TeamSession}) {
  const [clock,setClock]=useState(false);
  const intervals=players.flatMap(p=>p.stations.filter(s=>s.elapsedMs!==null));
  const start=clock&&intervals.length?Math.min(...intervals.map(s=>s.startedAt!)):0;
  const end=clock&&intervals.length?Math.max(start+60000,...intervals.map(s=>s.endedAt!)):Math.max(60000,...players.map(p=>p.stations.reduce((n,s)=>n+(s.elapsedMs??0),0)));
  const left=190,width=790,height=Math.max(140,players.length*72+88),x=(ms:number)=>left+(ms-start)/(end-start)*width;
  return <div className="team-player-timeline">
    <div className="team-section-heading"><div><h3>Time by player and station</h3><p className="dp-muted">{clock?"Actual recorded intervals on a shared Pacific clock.":"Station durations stacked from zero for each player; gaps between stations are excluded."}</p></div>
      <div className="team-tabs" role="group" aria-label="Player timeline display"><button aria-pressed={!clock} onClick={()=>setClock(false)}>Station durations</button><button aria-pressed={clock} onClick={()=>setClock(true)}>Session timeline</button></div>
    </div>
    <div className="team-legend">{session.stations.map((st,i)=><span key={st.id}><i style={{background:COLORS[i]}}/>Station {st.order} · {st.label}</span>)}</div>
    <div className="team-chart"><svg viewBox={`0 0 1040 ${height}`} role="img" aria-label={`Time by player and station. ${players.length} player rows. ${clock?"Shared session clock":"Stacked station durations"}.`}>
      {[0,.25,.5,.75,1].map(f=><g key={f}><line className="team-grid" x1={left+f*width} x2={left+f*width} y1="32" y2={height-40}/><text x={left+f*width} y={height-16} textAnchor={f===0?"start":f===1?"end":"middle"}>{clock?time(start+f*(end-start)):`${(f*(end-start)/60000).toFixed(1)} min`}</text></g>)}
      {players.map((player,i)=>{let cumulative=0;const y=42+i*72;return <g key={player.playerId} className="team-player-chart-row"><text className="team-player-chart-name" x="8" y={y+19}><title>{player.name}</title>{player.name.length>23?`${player.name.slice(0,22)}…`:player.name}</text><text x="8" y={y+38}>{player.timedStations} / {player.stations.length} timed</text>
        <line className="team-grid" x1={left} x2={left+width} y1={y+46} y2={y+46}/>
        {player.stations.map((st,j)=>{if(st.elapsedMs===null)return null;const at=clock?st.startedAt!:cumulative;cumulative+=st.elapsedMs;
          const w=st.elapsedMs/(end-start)*width,barY=clock?y+j*14:y,barHeight=clock?12:38;
          const title=`${player.name} · Station ${st.order} · ${st.label} · ${playerDuration(st.elapsedMs)} · ${time(st.startedAt)} to ${time(st.endedAt)}`;
          return <g key={st.stationId} tabIndex={0} role="img" aria-label={title} className="team-station-interval"><title>{title}</title><rect x={x(at)} y={barY} width={Math.max(1,w)} height={barHeight} rx={clock?2:4} fill={COLORS[j]} fillOpacity=".86"/>{!clock&&w>105&&<text className="team-bar-label" x={x(at)+8} y={y+24}>S{st.order} · {playerDuration(st.elapsedMs)}</text>}</g>;
        })}
        {player.timedStations===0&&<text x={left+12} y={y+23}>No completed station timing yet</text>}
      </g>;})}
      {!players.length&&<text x="520" y="70" textAnchor="middle">No players in this session</text>}
    </svg></div>
    <p className="dp-muted">Completed station intervals only. Missing timing stays unavailable. Pauses within each station remain included; unrecorded gaps cannot identify queue waiting.</p>
  </div>;
}
