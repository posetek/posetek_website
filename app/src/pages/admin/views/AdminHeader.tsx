import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAdminToolLinks } from "../lib/useAdminNavigation";

const SECTIONS = [
  { path: "/admin/accounts", icon: "supervisor_account", label: "People & organizations" },
  { path: "/admin/programs", icon: "tune", label: "Planner" },
  { path: "/admin/analysis", icon: "edit_note", label: "Technique review" },
  { path: "/admin/drills", icon: "library_books", label: "Drill library" },
  { path: "/admin/ai-incidents", icon: "report", label: "AI incidents" },
  { path: "/admin/device-performance", icon: "speed", label: "Device performance" },
  { path: "/admin/user-issues", icon: "bug_report", label: "User issues" },
  { path: "/admin/feedback", icon: "feedback", label: "App feedback" },
];

export default function AdminHeader({ ready, email, uid = "", preview = false, onSignOut }: {
  ready: boolean;
  email?: string;
  uid?: string;
  preview?: boolean;
  onSignOut: () => void;
}) {
  const location = useLocation();
  const toolPath = useAdminToolLinks(uid);
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open]").forEach(menu => { menu.open = false; });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open]").forEach(menu => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      });
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <header className="admin-header">
      <div className="admin-topbar">
        <Link className="portal-brand" to={toolPath("/admin/accounts")} aria-label="PoseTek people and organizations">
          <span className="portal-brand-mark">P</span>
          <span className="admin-wordmark">POSETEK</span>
          <span className="admin-badge">Admin</span>
        </Link>
        {ready && <nav className="admin-primary-nav" aria-label="Admin sections">
          <Link className="admin-primary-link" to={preview ? "/insights?from=organization&view=overview&preview=1" : "/insights?from=organization&view=overview"}>Overview</Link>
          {[{ label: "Coaching hub", sections: SECTIONS.slice(0, 4) }, { label: "System & User Insights", sections: SECTIONS.slice(4) }].map(group => (
            <details className="admin-section-menu" key={group.label} onKeyDown={event => {
              if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
            }} onToggle={event => {
              if (event.currentTarget.open) document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open]").forEach(menu => {
                if (menu !== event.currentTarget) menu.open = false;
              });
            }}>
              <summary>{group.label}<span className="material-symbols-outlined" aria-hidden="true">expand_more</span></summary>
              <div className="admin-menu-panel admin-section-panel">
                {group.sections.map(section => <NavLink key={section.path} to={toolPath(section.path)} onClick={event => {
                  const menu = event.currentTarget.closest("details");
                  if (menu) menu.open = false;
                }} className={({ isActive }) => `admin-section-link${isActive ? " active" : ""}`}>
                  <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>{section.label}
                </NavLink>)}
              </div>
            </details>
          ))}
        </nav>}
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
    </header>
  );
}
