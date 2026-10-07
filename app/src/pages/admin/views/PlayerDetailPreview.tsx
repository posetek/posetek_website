// Development-only fixtures use the production presentation components and no readers.
import { useParams, useSearchParams, useLocation } from 'react-router-dom';
import { PlayerDetailContent, PlayerProfileContent, PlayerWorkoutsContent } from './PlayerDetail';
import { AdminResultsContent } from './AdminResults';
import { PlayerAiIncidentsCard } from './PlayerAiIncidents';
import { playerDetailPanel } from '../lib/playerDetailData';
import { playerRow } from '../lib/accounts';
import { DRILLS } from '../../athlete-portal/lib/drills';

export default function PlayerDetailPreview() {
  const { playerId = 'preview-player', drillKey = '' } = useParams();
  const [query] = useSearchParams();
  const location = useLocation();
  const player = playerRow(playerId, { firstName: 'Alex', lastName: 'Rivera', email: 'alex@posetek.test',
    organizationId: query.get('orgId') || 'preview-org', teamId: query.get('teamId') || 'preview-team',
    age: 16, ageRecordedAt: new Date(), position: 'CM', registered: true });
  const panel = playerDetailPanel(query, /\/results(?:\/|$)/.test(location.pathname));
  const results = { athlete: { ...player.raw, id: player.id }, reps: Object.fromEntries(DRILLS.map(drill => [drill.key, []])) };
  return <section className="admin-player-workspace">
    <p className="admin-note">Synthetic preview. Profile saves and service requests are disabled.</p>
    <PlayerDetailContent player={player} panel={panel} onProfileSaved={async () => {}}>
      {panel === 'results' && <AdminResultsContent playerId={player.id} results={results} drillKey={drillKey} search={location.search} />}
      {panel === 'profile' && <PlayerProfileContent player={player} data={{ coach: null, note: null }} onSaved={async () => {}} readOnly />}
      {panel === 'workouts' && <PlayerWorkoutsContent player={player} data={{ plan: null, plans: [], logs: [], adjustments: [], checkedAt: Date.now() }} onRefresh={() => {}} />}
      {panel === 'ai-incidents' && <PlayerAiIncidentsCard playerId={player.id} load={{ kind: 'ready', incidents: [] }} />}
    </PlayerDetailContent>
  </section>;
}
