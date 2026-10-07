import WorkspaceHeader from "../../components/WorkspaceHeader";
import { accountQuery } from "../admin/lib/accountHierarchy";
import "../admin/admin.scss";
import "../admin/admin-surfaces.scss";
import "../../styles/admin-theme.scss";
import "../admin/admin-dashboard.scss";
import "./organization-header.scss";

/** Navigation only: organization membership and capabilities remain server-owned. */
export default function OrganizationHeader({ ready, orgId, teamId, email, preview = false, onSignOut }: {
  ready: boolean; orgId?: string; teamId?: string; email?: string; preview?: boolean; onSignOut: () => void;
}) {
  const scope = accountQuery({ orgId, teamId });
  const insights = (view: string) => {
    const query = new URLSearchParams(scope);
    query.set("from", "organization"); query.set("view", view);
    if (preview) query.set("preview", "1");
    return `/insights?${query}`;
  };
  const feedQuery = new URLSearchParams();
  if (orgId) feedQuery.set("organizationId", orgId);
  if (teamId) feedQuery.set("teamId", teamId);
  const feed = `/feed${feedQuery.size ? `?${feedQuery}` : ""}`;
  return <div className="pt-admin organization-header-shell"><WorkspaceHeader ready={ready} email={email}
    badge="Organization" brandLabel="PoseTek organization" brandPath={`/organization${scope}`} overviewPath={insights("overview")}
    groups={[
      { label: "Coaching hub", sections: [
        { path: `/organization${scope}`, icon: "supervisor_account", label: "People & teams" },
        { path: `/programs${scope}`, icon: "tune", label: "Planner" },
        { path: feed, icon: "dynamic_feed", label: "Community feed" },
      ] },
    ]}
    accountLinks={[{ path: `/organization${scope}`, icon: "key", label: "Organization access" }, { path: feed, icon: "dynamic_feed", label: "Community feed" }]}
    onSignOut={onSignOut} /></div>;
}
