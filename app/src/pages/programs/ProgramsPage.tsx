import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { staffPlannerReturn } from "../../lib/coach-navigation";
import AuthenticatedOrganizationHeader from "../organization/AuthenticatedOrganizationHeader";
import PersonalizedPrograms from "../admin/views/PersonalizedPrograms";
import "../../styles/pose-portal.css";

/** Staff entry point. The scope loader and server both require current membership. */
export default function ProgramsPage() {
  const navigate = useNavigate(), location = useLocation();
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState("");
  const returnPath = staffPlannerReturn(location.search);
  useEffect(() => auth.onAuthStateChanged(user => {
    if (!user) { setUid(null); navigate(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true }); }
    else if (user.emailVerified && user.email?.toLowerCase().endsWith("@posetek.net")) navigate(`/admin/programs${location.search}${location.hash}`, { replace: true });
    else setUid(user.uid);
  }), [navigate, location.pathname, location.search, location.hash]);
  return <div className="pt-pose portal-body pt-personalized">
    <AuthenticatedOrganizationHeader orgId={new URLSearchParams(location.search).get("orgId") || undefined} teamId={new URLSearchParams(location.search).get("teamId") || undefined} onSignOut={() => { void auth.signOut().then(() => navigate("/signin", { replace: true })).catch(() => setError("Sign out failed. Try again.")); }}>
    <header className="portal-header"><Link className="portal-brand" to={returnPath}>POSETEK</Link><nav><Link className="quiet-button" to={returnPath}>Organization</Link><button className="quiet-button" onClick={() => { void auth.signOut().then(() => navigate("/signin", { replace: true })).catch(() => setError("Sign out failed. Try again.")); }}>Sign out</button></nav></header></AuthenticatedOrganizationHeader>
    <main className="personalized-shell">{error && <p role="alert">{error}</p>}{uid ? <PersonalizedPrograms key={uid} role="staff" /> : <p role="status">Checking your sign-in…</p>}</main>
  </div>;
}
