import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { staffPlannerReturn } from "../../lib/coach-navigation";
import AuthenticatedOrganizationHeader from "../organization/AuthenticatedOrganizationHeader";
import PersonalizedPrograms from "../admin/views/PersonalizedPrograms";
import type { PlannerNavigationScope } from "../admin/views/PersonalizedPrograms";
import "../../styles/pose-portal.css";

/** Staff entry point. The scope loader and server both require current membership. */
export default function ProgramsPage() {
  const navigate = useNavigate(), location = useLocation();
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [plannerScope, setPlannerScope] = useState<(PlannerNavigationScope & { uid: string; search: string }) | null>(null);
  const onScopeChange = useCallback((scope: PlannerNavigationScope | null) => {
    const currentUid = auth.currentUser?.uid;
    setPlannerScope(scope && currentUid ? { ...scope, uid: currentUid, search: location.search } : null);
  }, [location.search]);
  const currentScope = plannerScope?.uid === uid && plannerScope.uid === auth.currentUser?.uid && plannerScope.search === location.search ? plannerScope : null;
  const returnPath = staffPlannerReturn(location.search);
  useEffect(() => auth.onAuthStateChanged(user => {
    if (!user) { setUid(null); navigate(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }
    else if (user.emailVerified && user.email?.toLowerCase().endsWith("@posetek.net")) navigate(`/admin/programs${location.search}${location.hash}`, { replace: true });
    else setUid(user.uid);
  }), [navigate, location.pathname, location.search, location.hash]);
  return <div className="pt-pose portal-body pt-personalized">
    <AuthenticatedOrganizationHeader enabled={!!currentScope} orgId={currentScope?.orgId} teamId={currentScope?.teamId} onSignOut={() => { void auth.signOut().then(() => navigate("/signin", { replace: true })).catch(() => setError("Sign out failed. Try again.")); }}>
    <header className="portal-header"><Link className="portal-brand" to={returnPath}>POSETEK</Link><nav><Link className="quiet-button" to={returnPath}>Organization</Link><button className="quiet-button" onClick={() => { void auth.signOut().then(() => navigate("/signin", { replace: true })).catch(() => setError("Sign out failed. Try again.")); }}>Sign out</button></nav></header></AuthenticatedOrganizationHeader>
    <main className="personalized-shell">{error && <p role="alert">{error}</p>}{uid ? <PersonalizedPrograms key={uid} role="staff" onScopeChange={onScopeChange} /> : <p role="status">Checking your sign-in…</p>}</main>
  </div>;
}
