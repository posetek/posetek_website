// The admin console — brief §4 plus the website half of admin sign-in.
// Route: `/admin/*`. Two options, mirroring the mobile admin's tabs:
// **Drill library** and **Monitor accounts**.
//
// The guard below decides which screen to draw. It is not the security
// boundary: docs/rules/admin.rules, drill_catalog.rules, storage.rules and the
// 2026-09-05 llm.rules additions are, and every write on these screens is
// rejected by them for a non-admin.

import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { useAdminSession } from "./lib/session";
import type { AdminSession } from "./lib/session";
import "../../styles/pose-portal.css";
import "./admin.scss";
import "./admin-surfaces.scss";
import "../../styles/admin-theme.scss";
import "./admin-dashboard.scss";
import AdminHeader from "./views/AdminHeader";
import AdminBreadcrumbs from "./views/AdminBreadcrumbs";

const OrganizationPage = lazy(() => import("../organization/OrganizationPage"));
const AdminOverview = lazy(() => import("./views/AdminOverview"));
const DrillLibrary = lazy(() => import("./views/DrillLibrary"));
const DrillDetail = lazy(() => import("./views/DrillDetail"));
const DrillForm = lazy(() => import("./views/DrillForm"));
const MonitorAccounts = lazy(() => import("./views/MonitorAccounts"));
const CoachDetail = lazy(() => import("./views/CoachDetail"));
const PlayerDetail = lazy(() => import("./views/PlayerDetail"));
const WorkoutEditor = lazy(() => import("./views/WorkoutEditor"));
const AdminResults = lazy(() => import("./views/AdminResults"));
const RepTools = lazy(() => import("./views/RepTools"));
const PlannerRedirect = lazy(() => import("./views/PlannerRedirect"));
const AnalysisWorkspace = lazy(() => import("./views/AnalysisWorkspace"));
const PersonalizedPrograms = lazy(() => import("./views/PersonalizedPrograms"));
const AiIncidents = lazy(() => import("./views/AiIncidents"));
const AccountAccess = lazy(() => import("./views/AccountAccess"));

export default function AdminPage() {
  const location = useLocation();
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "1";
  if (preview) {
    return <AdminConsole session={{ kind: "ready", identity: {
      uid: "preview-admin",
      email: "admin@posetek.test",
      displayName: "Preview admin",
      adminDomain: true,
      emailVerified: true,
      isAdmin: true,
    } }} preview />;
  }
  return <AuthenticatedAdminConsole />;
}

function AuthenticatedAdminConsole() {
  const session = useAdminSession();
  return <AdminConsole session={session} />;
}

function AdminConsole({ session, preview = false }: { session: AdminSession; preview?: boolean }) {
  const navigate = useNavigate();

  async function signOut() {
    if (preview) return;
    await auth.signOut();
    navigate("/signin", { replace: true });
  }

  let body;
  if (session.kind === "checking") {
    body = (
      <div className="portal-loading">
        <span className="spinner" />
        <p>Checking your PoseTek admin sign-in…</p>
      </div>
    );
  } else if (session.kind === "signedOut") {
    body = (
      <GateCard
        icon="lock"
        title="Sign in with your PoseTek account"
        body="The admin console is for verified @posetek.net accounts."
        action={<Link className="primary-cta" to="/signin?returnTo=%2Fadmin">Go to sign in</Link>}
      />
    );
  } else if (session.kind === "notAdmin") {
    body = (
      <GateCard
        icon="block"
        title="This account is not a PoseTek admin"
        body={`${session.email || "This account"} is signed in. PoseTek administrator access is managed separately from your organization or player account.`}
        action={
          <div className="admin-gate-actions">
            <Link className="primary-cta" to="/signin">Go to your account</Link>
            <button className="quiet-button" type="button" onClick={signOut}>Use a different account</button>
          </div>
        }
      />
    );
  } else if (session.kind === "unverified") {
    body = <VerificationCard email={session.email} onSignOut={signOut} />;
  } else {
    body = (
      <Suspense fallback={<div className="portal-loading"><span className="spinner" /><p>Loading…</p></div>}>
        <Routes>
          <Route index element={<AdminOverview uid={session.identity.uid} preview={preview} />} />
          <Route path="feeds" element={<Navigate to="/feed" replace />} />
          <Route path="drills" element={<DrillLibrary />} />
          <Route path="drills/new" element={<DrillForm mode="create" />} />
          <Route path="drills/:drillId" element={<DrillDetail />} />
          <Route path="drills/:drillId/edit" element={<DrillForm mode="edit" />} />
          <Route path="organizations" element={<OrganizationPage admin />} />
          <Route path="accounts" element={<MonitorAccounts />} />
          <Route path="access" element={<AccountAccess preview={preview} />} />
          <Route path="accounts/coach/:coachId" element={<CoachDetail />} />
          <Route path="accounts/player/:playerId" element={<PlayerDetail />} />
          <Route path="accounts/player/:playerId/results" element={<AdminResults />} />
          <Route path="accounts/player/:playerId/results/:drillKey" element={<AdminResults />} />
          <Route path="accounts/player/:playerId/results/:drillKey/:repId" element={<RepTools />} />
          <Route path="programs" element={<PersonalizedPrograms />} />
          <Route path="analysis" element={<AnalysisWorkspace />} />
          <Route path="ai-incidents" element={<AiIncidents />} />
          <Route path="programs/personalized" element={<PlannerRedirect />} />
          <Route
            path="accounts/player/:playerId/plan/:planId/workout/:workoutId"
            element={<WorkoutEditor />}
          />
          <Route
            path="*"
            element={
              <GateCard
                icon="help"
                title="No such admin page"
                body="That address is not part of the admin console."
                action={<Link className="primary-cta" to="/admin">Admin home</Link>}
              />
            }
          />
        </Routes>
      </Suspense>
    );
  }

  return (
    <div className={`pt-pose portal-body pt-admin${session.kind === "ready" ? " admin-ready" : ""}`}>
      <AdminHeader ready={session.kind === "ready"} preview={preview}
        email={session.kind === "ready" ? session.identity.email : undefined} onSignOut={() => void signOut()} />
      <main className="admin-shell">{session.kind === "ready" && <AdminBreadcrumbs />}{body}</main>
    </div>
  );
}

function GateCard({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <section className="admin-gate">
      <div className="empty-card">
        <span className="material-symbols-outlined">{icon}</span>
        <h3>{title}</h3>
        <p>{body}</p>
        {action}
      </div>
    </section>
  );
}

// An @posetek.net address that has never been verified is NOT an admin, and it
// must not fall through to the coach/player cascade either (identity §1.3).
function VerificationCard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <GateCard
      icon="key"
      title="Activate your PoseTek access"
      body={`${email} needs PoseTek administrator approval. Ask an existing PoseTek administrator to confirm your account and share a private activation link. No email has been sent.`}
      action={
        <div className="admin-gate-actions">
          <Link className="primary-cta" to="/join">Use an activation link or code</Link>
          <button className="quiet-button" type="button" onClick={onSignOut}>Use a different account</button>
        </div>
      }
    />
  );
}
