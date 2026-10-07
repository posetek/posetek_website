import WorkspaceHeader from "../../../components/WorkspaceHeader";
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
  ready: boolean; email?: string; uid?: string; preview?: boolean; onSignOut: () => void;
}) {
  const toolPath = useAdminToolLinks(uid);
  const sections = SECTIONS.map(section => ({ ...section, path: toolPath(section.path) }));
  return <WorkspaceHeader ready={ready} email={email} badge="Admin"
    brandPath={toolPath("/admin/accounts")} brandLabel="PoseTek people and organizations"
    overviewPath={preview ? "/insights?from=organization&view=overview&preview=1" : "/insights?from=organization&view=overview"}
    groups={[{ label: "Coaching hub", sections: sections.slice(0, 4) }, { label: "System & User Insights", sections: sections.slice(4) }]}
    accountLinks={[{ path: "/admin/access", icon: "key", label: "Account access" }, { path: "/feed", icon: "dynamic_feed", label: "Community feed" }]}
    onSignOut={onSignOut} />;
}
