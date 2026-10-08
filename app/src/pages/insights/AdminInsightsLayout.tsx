import type { ReactNode } from "react";
import AdminHeader from "../admin/views/AdminHeader";
import "../admin/admin.scss";
import "../admin/admin-surfaces.scss";
import "../../styles/admin-theme.scss";
import "../admin/admin-dashboard.scss";

/** Render only after the Insights service has established the admin role. */
export default function AdminInsightsLayout({ uid, email, preview = false, onSignOut, children }: {
  uid: string; email?: string; preview?: boolean; onSignOut: () => void; children: ReactNode;
}) {
  return <div className="pt-pose portal-body pt-insights pt-admin admin-ready">
    <AdminHeader ready uid={uid} email={email} preview={preview} onSignOut={onSignOut} />
    <main className="insights-shell">{children}</main>
  </div>;
}
