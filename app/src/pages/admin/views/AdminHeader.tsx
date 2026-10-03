import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { getClubContext } from "../../../lib/organization-data";
import { accountContext } from "../lib/accountHierarchy";
import type { InsightChoices } from "../../insights/lib/expanded";

const SECTIONS = [
  { path: "/admin", icon: "space_dashboard", label: "Overview", end: true },
  { path: "/admin/accounts", icon: "supervisor_account", label: "Accounts" },
  { path: "/admin/organizations", icon: "groups", label: "Organizations" },
  { path: "/admin/programs", icon: "tune", label: "Planner" },
  { path: "/admin/analysis", icon: "edit_note", label: "Technique review" },
  { path: "/admin/drills", icon: "library_books", label: "Drill library" },
  { path: "/admin/ai-incidents", icon: "report", label: "AI incidents" },
  { path: "/admin/device-performance", icon: "speed", label: "Device performance" },
  { path: "/admin/user-issues", icon: "bug_report", label: "User issues" },
];

export default function AdminHeader({ ready, email, preview = false, onSignOut }: {
  ready: boolean;
  email?: string;
  preview?: boolean;
  onSignOut: () => void;
}) {
  const location = useLocation(), navigate = useNavigate();
  const context = accountContext(location.search);
  const [choices, setChoices] = useState<InsightChoices | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    if (preview) {
      if (import.meta.env.DEV) void import("../../insights/lib/preview").then(module => { if (active) setChoices(module.PREVIEW_CHOICES); });
      return () => { active = false; };
    }
    void getClubContext(context.orgId).then(result => {
      if (!active) return;
      setChoices({
        global: true,
        organizations: result.organizations.filter(org => org.schemaVersion === 2).map(org => ({
          id: org.id,
          name: org.name,
          role: "admin",
          teams: result.teams.filter(team => team.organizationId === org.id).map(team => ({ id: team.id, name: team.name })),
        })),
      });
    }).catch(() => { if (active) setChoices(null); });
    return () => { active = false; };
  }, [ready, preview, context.orgId]);

  // On phones the tabs scroll sideways; keep the active one (for example the
  // eighth, Device performance) in view instead of leaving it off-screen.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = nav.current, active = row?.querySelector<HTMLElement>(".admin-nav-link.active");
    if (!row || !active || row.scrollWidth <= row.clientWidth) return;
    const bounds = row.getBoundingClientRect(), tab = active.getBoundingClientRect();
    if (tab.left < bounds.left || tab.right > bounds.right) row.scrollLeft += tab.left - bounds.left - (bounds.width - tab.width) / 2;
  }, [location.pathname, ready]);

  const organization = choices?.organizations.find(row => row.id === context.orgId);
  const team = organization?.teams.find(row => row.id === context.teamId);
  const scopeLabel = team ? `${organization?.name} · ${team.name}` : organization?.name || "All organizations";
  const scopedSearch = useMemo(() => {
    const query = new URLSearchParams();
    if (context.orgId) query.set("orgId", context.orgId);
    if (context.teamId) query.set("teamId", context.teamId);
    if (preview) query.set("preview", "1");
    return query.toString() ? `?${query}` : "";
  }, [context.orgId, context.teamId, preview]);

  function changeScope(orgId?: string, teamId?: string) {
    const query = new URLSearchParams(location.search);
    for (const key of ["orgId", "teamId", "coachId"]) query.delete(key);
    if (orgId) query.set("orgId", orgId);
    if (teamId) query.set("teamId", teamId);
    navigate({ pathname: location.pathname, search: query.toString() ? `?${query}` : "" });
  }

  return (
    <header className="admin-header">
      <div className="admin-topbar">
        <Link className="portal-brand" to={`/admin${scopedSearch}`} aria-label="PoseTek admin overview">
          <span className="portal-brand-mark">P</span>
          <span className="admin-wordmark">POSETEK</span>
          <span className="admin-badge">Admin</span>
        </Link>
        {ready && <details className="admin-scope-menu">
          <summary aria-label={`Current scope: ${scopeLabel}`}>
            <span className="material-symbols-outlined" aria-hidden="true">domain</span>
            <span>{scopeLabel}</span>
            <span className="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </summary>
          <div className="admin-menu-panel admin-scope-panel">
            <label>Organization
              <select aria-label="Admin organization scope" value={context.orgId || ""} onChange={event => changeScope(event.target.value || undefined)}>
                <option value="">All organizations</option>
                {choices?.organizations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label>Team
              <select aria-label="Admin team scope" value={context.teamId || ""} disabled={!organization} onChange={event => changeScope(organization?.id, event.target.value || undefined)}>
                <option value="">All teams</option>
                {organization?.teams.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
          </div>
        </details>}
        {ready && <details className="admin-account-menu">
          <summary aria-label="Admin account menu" title={email}>
            <span aria-hidden="true">{(email || "A")[0].toUpperCase()}</span>
            <span className="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </summary>
          <div className="admin-menu-panel admin-account-panel">
            <p>{email}</p>
            <Link to="/admin/access"><span className="material-symbols-outlined" aria-hidden="true">key</span><span>Account access</span></Link>
            <Link to="/feed"><span className="material-symbols-outlined" aria-hidden="true">dynamic_feed</span><span>Community feed</span><span className="material-symbols-outlined" aria-hidden="true">open_in_new</span></Link>
            <button type="button" onClick={onSignOut}><span className="material-symbols-outlined" aria-hidden="true">logout</span>Sign out</button>
          </div>
        </details>}
      </div>
      {ready && <nav ref={nav} className="admin-nav" aria-label="Admin sections">
        {SECTIONS.map(section => <NavLink key={section.path} end={section.end} className={({ isActive }) => `admin-nav-link${isActive ? " active" : ""}`} to={`${section.path}${scopedSearch}`}>
          <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
          <span>{section.label}</span>
        </NavLink>)}
      </nav>}
    </header>
  );
}
