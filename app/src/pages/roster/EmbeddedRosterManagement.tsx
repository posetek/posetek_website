import type { ClubContext } from "../../lib/organization-data";
import { auth } from "../../lib/firebase";
import RosterPage from "./RosterPage";

export default function EmbeddedRosterManagement({ context, teamId, onRefresh }: { context?: ClubContext; teamId?: string; onRefresh: () => void }) {
  return <RosterPage key={`${auth.currentUser?.uid}:${context?.organization?.id || "independent"}:${teamId || ""}`} managementOnly organizationId={context?.organization?.id} teamId={teamId} onChanged={onRefresh} />;
}
