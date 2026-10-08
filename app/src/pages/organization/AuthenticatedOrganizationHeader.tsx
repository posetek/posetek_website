import { useEffect, useState, type ReactNode } from "react";
import { auth } from "../../lib/firebase";
import { getClubContext } from "../../lib/organization-data";
import OrganizationHeader from "./OrganizationHeader";

/** Resolve membership independently of URL hints; never promote a coach or player. */
export default function AuthenticatedOrganizationHeader({ orgId, teamId, enabled = true, onSignOut, children }: {
  orgId?: string; teamId?: string; enabled?: boolean; onSignOut: () => void; children: ReactNode;
}) {
  const [manager, setManager] = useState<{ uid: string; requested?: string; orgId: string; teamIds: string[]; email?: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let generation = 0;
    const stop = auth.onAuthStateChanged(user => {
      const request = ++generation;
      setManager(null);
      if (!user) return;
      void getClubContext(orgId).then(context => {
        if (request !== generation || auth.currentUser?.uid !== user.uid) return;
        if (context.role === "manager" && context.organization && (!orgId || context.organization.id === orgId)) {
          setManager({ uid: user.uid, requested: orgId, orgId: context.organization.id, teamIds: context.teams.filter(team => team.organizationId === context.organization!.id).map(team => team.id), email: user.email || undefined });
        }
      }).catch(() => { /* Keep the original header when membership cannot be verified. */ });
    });
    return () => { generation++; stop(); };
  }, [orgId, enabled]);
  if (!enabled || !manager || manager.uid !== auth.currentUser?.uid || manager.requested !== orgId) return <>{children}</>;
  return <OrganizationHeader ready orgId={manager.orgId} teamId={teamId && manager.teamIds.includes(teamId) ? teamId : undefined} email={manager.email} onSignOut={onSignOut} />;
}
