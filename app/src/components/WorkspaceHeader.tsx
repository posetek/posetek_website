import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

export interface WorkspaceLink { path: string; icon: string; label: string }
export default function WorkspaceHeader({ ready, email, badge, brandPath, brandLabel, overviewPath, groups, accountLinks, onSignOut }: {
  ready: boolean; email?: string; badge: string; brandPath: string; brandLabel: string; overviewPath: string;
  groups: { label: string; sections: WorkspaceLink[] }[]; accountLinks: WorkspaceLink[]; onSignOut: () => void;
}) {
  const location = useLocation();
  const matchesView = (path: string) => {
    const view = new URLSearchParams(path.split("?")[1]).get("view");
    return !view || view === (new URLSearchParams(location.search).get("view") || "overview");
  };
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open], .admin-account-menu[open]").forEach(menu => { menu.open = false; });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open], .admin-account-menu[open]").forEach(menu => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
      });
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <header className="admin-header">
      <div className="admin-topbar">
        <Link className="portal-brand" to={brandPath} aria-label={brandLabel}>
          <span className="portal-brand-mark">P</span>
          <span className="admin-wordmark">POSETEK</span>
          <span className="admin-badge">{badge}</span>
        </Link>
        {ready && <nav className="admin-primary-nav" aria-label={`${badge} sections`}>
          <Link className="admin-primary-link" to={overviewPath}>Overview</Link>
          {groups.map(group => (
            <details className="admin-section-menu" key={group.label} onKeyDown={event => {
              if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
            }} onToggle={event => {
              if (event.currentTarget.open) document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open], .admin-account-menu[open]").forEach(menu => {
                if (menu !== event.currentTarget) menu.open = false;
              });
            }}>
              <summary>{group.label}<span className="material-symbols-outlined" aria-hidden="true">expand_more</span></summary>
              <div className="admin-menu-panel admin-section-panel">
                {group.sections.map(section => <NavLink aria-current={matchesView(section.path) ? undefined : false} key={section.path} to={section.path} onClick={event => {
                  const menu = event.currentTarget.closest("details");
                  if (menu) menu.open = false;
                }} className={({ isActive }) => `admin-section-link${isActive && matchesView(section.path) ? " active" : ""}`}>
                  <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>{section.label}
                </NavLink>)}
              </div>
            </details>
          ))}
        </nav>}
        {ready && <details className="admin-account-menu" onKeyDown={event => {
          if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
        }} onToggle={event => {
          if (event.currentTarget.open) document.querySelectorAll<HTMLDetailsElement>(".admin-section-menu[open], .admin-account-menu[open]").forEach(menu => {
            if (menu !== event.currentTarget) menu.open = false;
          });
        }} onClick={event => {
          if (event.target instanceof Element && event.target.closest("a")) event.currentTarget.open = false;
        }}>
          <summary aria-label={`${badge} account menu`} title={email}>
            <span aria-hidden="true">{(email || "A")[0].toUpperCase()}</span>
            <span className="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </summary>
          <div className="admin-menu-panel admin-account-panel">
            <p>{email}</p>
            {accountLinks.map(link => <Link key={link.path} to={link.path}><span className="material-symbols-outlined" aria-hidden="true">{link.icon}</span><span>{link.label}</span></Link>)}
            <button type="button" onClick={onSignOut}><span className="material-symbols-outlined" aria-hidden="true">logout</span>Sign out</button>
          </div>
        </details>}
      </div>
    </header>
  );
}
