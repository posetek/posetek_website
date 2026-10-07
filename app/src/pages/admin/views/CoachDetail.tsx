import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { auth } from "../../../lib/firebase";
import { loadCoachAccount, saveCoachRating } from "../lib/accounts";
import { accountContext, accountQuery } from "../lib/accountHierarchy";
import { adminDirectoryPath, adminPlayerReturn, parseAdminDirectoryState } from "../lib/adminNavigation";
import { useAccountLoad } from "../lib/useAccountLoad";
import { ADMIN_RETURN_STATE } from "../lib/useAdminNavigation";
import PlayerRosterRow from "./PlayerRosterRow";
import { LoadError, TeamRoster } from "./MonitorAccounts";

export default function CoachDetail() {
  const { coachId = "" } = useParams();
  const [query, setQuery] = useSearchParams();
  const requested = accountContext(query);
  const orgId = requested.orgId;
  const loader = useCallback(() => loadCoachAccount(coachId, orgId), [coachId, orgId]);
  const { state, refresh } = useAccountLoad(loader);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mutation = useRef(0);
  useEffect(() => {
    ++mutation.current; setMessage(null); setSaving(false);
    return () => { ++mutation.current; };
  }, [coachId, orgId]);
  useEffect(() => { document.title = state.kind === "ready" ? `${state.data.coach.name} | PoseTek admin` : "Staff account | PoseTek admin"; }, [state]);
  async function setRating(value: number | null) {
    if (state.kind !== "ready" || !state.data.ratingEditable || saving) return;
    const id = state.data.coach.id, uid = auth.currentUser?.uid, generation = ++mutation.current;
    const current = () => generation === mutation.current && uid === auth.currentUser?.uid;
    setSaving(true); setMessage(null);
    try {
      await saveCoachRating(id, value);
      if (!current()) return;
      setMessage(value === null ? "Coach difficulty limit cleared." : `Coach difficulty limit saved at ${value}.`);
      refresh();
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "That rating could not be saved."); }
    finally { if (current()) setSaving(false); }
  }
  const back = adminPlayerReturn(query.toString());
  if (state.kind === "loading") return <p role="status">Loading the staff account…</p>;
  if (state.kind === "error") return <><Link className="quiet-button" state={ADMIN_RETURN_STATE} to={back}>Back to people and organizations</Link><LoadError message={state.message} retry={refresh} /></>;
  const { coach, organization, roster, teams, limits, ratingEditable } = state.data;
  const role = coach.organizationRole === "manager" ? "Organization manager" : "Coach";
  const context = { orgId: organization?.id || orgId, coachId, teamId: requested.teamId };
  const unassigned = roster.filter(player => !teams.some(row => row.team.id === player.teamId));
  return <>
    <section className="admin-heading"><Link className="icon-button" state={ADMIN_RETURN_STATE} to={back} aria-label="Back to people and organizations"><span className="material-symbols-outlined">arrow_back</span></Link>
      <div><p className="eyebrow">{role}{organization ? ` · ${organization.name}` : " · legacy roster"}</p><h1>{coach.name}</h1>
        <p>{coach.email || "No email on file"} · {roster.length} athletes{coach.organizationStatus && ` · ${coach.organizationStatus}`}</p></div>
      <div className="admin-heading-actions"><button className="quiet-button" onClick={refresh}>Refresh</button>{organization && <Link className="quiet-button" to={adminDirectoryPath({ ...parseAdminDirectoryState(query), orgId: organization.id, directoryTab: "staff" })}>Manage staff access</Link>}</div></section>
    {message && <p className="form-message" role="status">{message}</p>}
    {limits.map(limit => <p className="form-message" role="status" key={limit}>{limit}</p>)}
    {ratingEditable && <section className="admin-card"><h2>Coach difficulty limit</h2><p className="admin-note">Sets drill eligibility for athletes who inherit this coach’s limit. Their individual limits take priority.</p>
      <div className="admin-checks"><button className={`quiet-button${coach.maxDrillDifficulty === null ? " active" : ""}`} disabled={saving} onClick={() => void setRating(null)}>All levels (1–5)</button>
        {[1, 2, 3, 4, 5].map(level => <button key={level} className={`quiet-button${coach.maxDrillDifficulty === level ? " active" : ""}`} disabled={saving} onClick={() => void setRating(level)}>Up to {level}</button>)}</div></section>}
    <section className="admin-card"><h2>{organization ? coach.organizationRole === "manager" ? "All organization teams" : "Assigned teams" : "Roster"}</h2>
      {organization ? <>
        {coach.organizationStatus !== "active" ? <p className="admin-empty">This staff membership has no active roster access.</p> : <>
          {!teams.length && <p className="admin-empty">No teams are assigned to this coach.</p>}
          {teams.map(row => <TeamRoster key={row.team.id} row={row} selected={context} choose={selection => setQuery(accountQuery(selection))} />)}
          {requested.teamId && !teams.some(row => row.team.id === requested.teamId) && <p className="form-message" role="alert">That team is no longer assigned to this account. Choose a current team.</p>}
          {unassigned.length > 0 && <><h3 className="admin-subhead">Unassigned players</h3>{unassigned.map(player => <PlayerRosterRow key={player.id} player={player} context={{ ...context, teamId: undefined }} />)}</>}
        </>}
      </> : <div className="admin-rows">{!roster.length && <p className="admin-empty">No athletes on this legacy roster.</p>}{roster.map(player => <PlayerRosterRow key={player.id} player={player} context={context} />)}</div>}
    </section>
  </>;
}
