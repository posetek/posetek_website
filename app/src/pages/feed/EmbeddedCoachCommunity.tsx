import FeedPage from "./FeedPage";
import "./coach-community.scss";

export default function EmbeddedCoachCommunity({ uid, organizationId }: { uid: string; organizationId?: string }) {
  // Independent roster access does not grant a new social audience. Existing
  // social membership remains authoritative, including for dual-role accounts.
  if (!organizationId) return <section className="insights-card"><h2>Community</h2><p>Team Community is available with an active organization membership. Your independent roster, testing and workouts remain available in the other tabs.</p></section>;
  return <FeedPage key={`${uid}:${organizationId}`} embedded organizationId={organizationId} />;
}
