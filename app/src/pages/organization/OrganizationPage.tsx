import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext } from "../../lib/organization-data";
import type { ClubContext } from "../../lib/organization-data";
import type { StaffRole } from "../../lib/organization";
import { accountContext, accountQuery } from "../admin/lib/accountHierarchy";
import { organizationPlayerPath } from "../athlete-portal/lib/navigation";
import { insightsLink } from "../insights/lib/navigation";
import SignupStatus from "../admin/views/SignupStatus";
import { emptyStaffPlayerProfile, missingRequirement, staffPlayerProfileFields } from "../../lib/player-profile";
import { StaffPlayerProfileFields } from "../../components/StaffPlayerProfileFields";
import "../../styles/pose-portal.css";
import "./organization.scss";

type IssuedInvitation = { code: string; email: string; expiresAtMillis?: number; player?: false }
  | { playerId: string; email: string; player: true };

export default function OrganizationPage({ admin = false }: { admin?: boolean }) {
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const requested = accountContext(query);
  const [context, setContext] = useState<ClubContext | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newClub, setNewClub] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamNameDraft, setTeamNameDraft] = useState({ teamId: "", value: "" });
  const [invite, setInvite] = useState({ firstName: "", lastName: "", email: "", role: "coach" as StaffRole, teamIds: [] as string[] });
  const [invitationVersion, setInvitationVersion] = useState(0);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [newPlayer, setNewPlayer] = useState({ firstName: "", lastName: "" });
  const [newProfile, setNewProfile] = useState(emptyStaffPlayerProfile);
  const [editedStaff, setEditedStaff] = useState<ClubContext["staff"][number] | null>(null);
  const mounted = useRef(false);
  const currentUid = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const operationBusy = useRef(false);
  const manager = context?.role === "admin" || context?.role === "manager";
  const team = context?.teams.find(entry => entry.id === teamId);
  const editTeamName = teamNameDraft.teamId === teamId ? teamNameDraft.value : team?.name || "";
  const setEditTeamName = (value: string) => setTeamNameDraft({ teamId, value });
  const players = context?.players.filter(player => player.organizationId === organizationId && player.teamId === teamId) || [];
  const unassignedPlayers = context?.players.filter(player => player.organizationId === organizationId && !context.teams.some(entry => entry.id === player.teamId)) || [];

  const clearClubData = useCallback(() => {
    setContext(null); setOrganizationId(""); setTeamId(""); setWebsiteUrl("");
    setIssued(null); setEditedStaff(null); setNotice("");
    setNewClub(""); setTeamName(""); setTeamNameDraft({ teamId: "", value: "" });
    setNewPlayer({ firstName: "", lastName: "" });
    setInvite({ firstName: "", lastName: "", email: "", role: "coach", teamIds: [] });
  }, []);
  const reload = useCallback(async (id?: string, preferredTeamId?: string) => {
    const uid = auth.currentUser?.uid;
    const generation = ++loadGeneration.current;
    setIssued(null); setInvitationVersion(value => value + 1);
    const isCurrent = () => mounted.current && generation === loadGeneration.current
      && uid !== undefined && currentUid.current === uid && auth.currentUser?.uid === uid;
    if (!uid) return null;
    try {
      const result = await getClubContext(id);
      if (!isCurrent()) return null;
      setContext(result);
      setOrganizationId(result.organization?.id || "");
      setWebsiteUrl(result.organization?.websiteUrl || "");
      if (preferredTeamId && !result.teams.some(entry => entry.id === preferredTeamId)) setNotice("The requested team is no longer available. Choose one of the current teams.");
      setTeamId(current => {
        const candidate = preferredTeamId ?? current;
        return result.teams.some(entry => entry.id === candidate) ? candidate : result.teams[0]?.id || "";
      });
      return result;
    } catch (failure) {
      if (!isCurrent()) return null;
      clearClubData();
      throw failure;
    }
  }, [clearClubData]);
  useEffect(() => {
    document.title = "Organization | PoseTek";
    mounted.current = true;
    const stop = auth.onAuthStateChanged(user => {
      // Auth changes invalidate both reads and pending mutation responses,
      // including a one-time invitation code from the previous identity.
      currentUid.current = user?.uid ?? null;
      ++loadGeneration.current; ++operationGeneration.current;
      operationBusy.current = false;
      clearClubData(); setError(""); setBusy(false);
      if (!user) { navigate("/signin", { replace: true }); return; }
      const uid = user.uid;
      reload(requested.orgId, requested.teamId).catch(failure => {
        if (mounted.current && currentUid.current === uid && auth.currentUser?.uid === uid) {
          setError(failure instanceof Error ? failure.message : "Your organization could not be loaded.");
        }
      });
    });
    return () => {
      mounted.current = false;
      ++loadGeneration.current; ++operationGeneration.current;
      stop();
    };
  }, [navigate, reload, clearClubData, requested.orgId, requested.teamId]);

  async function mutate(action: (isCurrent: () => boolean) => Promise<unknown>, success: string) {
    if (operationBusy.current || !auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const generation = ++operationGeneration.current;
    const selectedOrganization = organizationId;
    const isCurrent = () => mounted.current && generation === operationGeneration.current
      && currentUid.current === uid && auth.currentUser?.uid === uid;
    operationBusy.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const outcome = await action(isCurrent);
      if (!isCurrent()) return;
      // Creation selects its returned club/team instead of restoring the
      // organization captured before the request started.
      const selection = outcome && typeof outcome === "object" ? outcome as { organizationId?: string; teamId?: string; issued?: IssuedInvitation } : {};
      const result = await reload(selection.organizationId || selectedOrganization || undefined, selection.teamId);
      if (isCurrent() && result) { setNotice(success); if (selection.issued) setIssued(selection.issued); }
    } catch (failure) {
      if (!isCurrent()) return;
      ++loadGeneration.current;
      clearClubData();
      setError(failure instanceof Error ? failure.message : "The change could not be saved.");
    } finally {
      if (isCurrent()) { operationBusy.current = false; setBusy(false); }
    }
  }
  async function chooseOrganization(id: string) {
    if (operationBusy.current || !auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const generation = ++operationGeneration.current;
    const isCurrent = () => mounted.current && generation === operationGeneration.current
      && currentUid.current === uid && auth.currentUser?.uid === uid;
    operationBusy.current = true;
    clearClubData(); setBusy(true); setError("");
    try { await reload(id || undefined); }
    catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : "The organization could not be loaded.");
    } finally {
      if (isCurrent()) { operationBusy.current = false; setBusy(false); }
    }
  }
  const body = <main className="club-shell">
    <section className="club-heading">
      <div><p className="eyebrow">{admin ? "PoseTek admin" : context?.role === "manager" ? "Organization manager" : "Coach"}</p>
        <div className="club-title">{context?.organization?.logoUrl && <img className="club-logo" src={context.organization.logoUrl} alt={`${context.organization.name} logo`} />}<h1>{context?.organization?.name || "Organizations"}</h1></div>
        <p>{context?.role === "coach" ? "Choose one of your teams to open its players and results." : "Manage your teams, staff access and player rosters."}</p></div>
      <button className="quiet-button" disabled={busy} onClick={() => void chooseOrganization(organizationId)}>Refresh</button>
    </section>
    {error && <p className="club-message error" role="alert">{error}</p>}
    {notice && <p className="club-message" role="status">{notice}</p>}
    {!context && !error && <p role="status">Loading organization…</p>}
    {context?.role === "none" && <section className="club-card"><h2>No organization linked yet</h2><p>Use the invitation code from your organization or PoseTek administrator.</p><Link className="primary-cta" to="/join">Claim a staff invitation</Link><Link className="quiet-button" to="/roster">Independent coach roster</Link></section>}
    {context?.role === "player" && <section className="club-card"><p>Your player account is linked to {context.organization?.name}.</p><Link className="primary-cta" to="/athlete">Open your athlete profile</Link></section>}
    {context && (context.role === "admin" || context.organizations.length > 1) && <section className="club-card">
      <label>Organization<select value={organizationId} disabled={busy} onChange={event => void chooseOrganization(event.target.value)}><option value="">Choose an organization</option>{context.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
      {context.role === "admin" && <form className="club-inline" onSubmit={event => { event.preventDefault(); void mutate(async isCurrent => {
        const result = await clubCall<{ organizationId: string }>("createClubOrganization", { name: newClub.trim() });
        if (isCurrent()) setNewClub("");
        return result;
      }, "Organization created. Add teams and staff below."); }}><label>New organization name<input required maxLength={120} value={newClub} onChange={event => setNewClub(event.target.value)} /></label><button className="primary-cta" disabled={busy}>Create organization</button></form>}
    </section>}
    {issued && <section className="club-card club-code" aria-live="polite"><h2>Invitation ready</h2><p>{issued.email}</p>
      {issued.player ? <><SignupStatus playerId={issued.playerId} playerName={issued.email} variant="club" reloadKey={invitationVersion} /><p>Share the signup link with this player. It connects their new account to this existing profile.</p></>
        : <><code data-clarity-mask="true">{issued.code}</code><p>{issued.expiresAtMillis ? `Expires ${new Date(issued.expiresAtMillis).toLocaleDateString()}. ` : ""}Copy this code now and share it with the intended person. They can claim it at <Link to="/join">/join</Link>.</p><button type="button" className="quiet-button" onClick={() => { void navigator.clipboard.writeText(issued.code).then(() => setNotice("Code copied.")).catch(() => setError("Copy the code above manually; clipboard access is unavailable.")); }}>Copy code</button></>}
      <button className="quiet-button" onClick={() => setIssued(null)}>Done</button></section>}
    {context?.organization && context.role !== "player" && <>
      <section className="club-card"><div className="club-section-title"><h2>Teams</h2><span>{context.teams.length} teams · {context.players.length} players</span></div>
        {context.teams.length ? <div className="club-team-grid">{context.teams.map(entry => <button key={entry.id} type="button" className={`club-team${teamId === entry.id ? " selected" : ""}`} aria-pressed={teamId === entry.id} onClick={() => setTeamId(entry.id)}><strong>{entry.name}</strong><span>{context.players.filter(player => player.organizationId === organizationId && player.teamId === entry.id).length} players{manager ? ` · ${context.staff.filter(member => member.role === "coach" && member.status === "active" && member.teamIds.includes(entry.id)).length} linked coaches` : ""}</span></button>)}</div> : <p>No teams have been created yet.</p>}
        {(context.players.length >= 2000 || context.teams.length >= 100 || context.staff.length >= 100) && <p className="club-message" role="status">The organization service reached a roster limit. Contact PoseTek if a team, staff member or athlete is missing.</p>}
        {manager && <form className="club-inline" onSubmit={event => { event.preventDefault(); void mutate(async isCurrent => { const result = await clubCall<{ teamId: string }>("saveClubTeam", { organizationId, name: teamName.trim() }); if (isCurrent()) setTeamName(""); return result; }, "Team created."); }}><label>New team name<input required maxLength={120} value={teamName} onChange={event => setTeamName(event.target.value)} /></label><button className="primary-cta" disabled={busy}>Add team</button></form>}
      </section>
      {team && <section className="club-card"><div className="club-section-title"><h2>{team.name}</h2><Link className="quiet-button" to={insightsLink({ orgId: organizationId, teamId: team.id }, "organization")}>Team Insights</Link><Link className="quiet-button" to={`${admin ? "/admin/programs" : "/programs"}${accountQuery({ orgId: organizationId, teamId: team.id })}`}>Personalized programs</Link>{context.role === "coach" && <Link className="quiet-button" to={`/dashboard?team=${encodeURIComponent(team.id)}&orgId=${encodeURIComponent(organizationId)}&teamId=${encodeURIComponent(team.id)}`}>Team dashboard</Link>}</div>
        {manager && <form className="club-inline" onSubmit={event => { event.preventDefault(); void mutate(() => clubCall("saveClubTeam", { organizationId, teamId, name: editTeamName.trim() }), "Team renamed."); }}><label>Team name<input required maxLength={120} value={editTeamName} onChange={event => setEditTeamName(event.target.value)} /></label><button className="quiet-button" disabled={busy}>Save name</button></form>}
        <div className="club-player-list">{players.length ? players.map(player => <div className="club-player" key={player.id}><Link to={organizationPlayerPath(player, admin)}><strong>{player.firstName} {player.lastName}</strong><span>Open profile and results</span></Link><SignupStatus playerId={player.id} playerName={`${player.firstName} ${player.lastName}`} variant="club" reloadKey={invitationVersion} disabled={busy} />{manager && <label className="club-move">Team<select aria-label={`Team for ${player.firstName} ${player.lastName}`} value={player.teamId} disabled={busy} onChange={event => { void mutate(() => clubCall("setClubPlayerTeam", { organizationId, playerId: player.id, teamId: event.target.value }), "Player moved; existing results and sign-in preserved."); }}>{context.teams.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}</div>) : <p>No players in this team yet.</p>}</div>
        <form className="club-inline" onSubmit={event => { event.preventDefault(); const missing = missingRequirement(newProfile); if (missing) { setError(missing); return; } void mutate(async isCurrent => {
          const result = await clubCall<{ playerId: string; code: string }>("createClubPlayer", { organizationId, teamId, ...newPlayer, ...staffPlayerProfileFields(newProfile) });
          if (isCurrent()) { setNewPlayer({ firstName: "", lastName: "" }); setNewProfile(emptyStaffPlayerProfile()); }
          return { issued: { playerId: result.playerId, email: `${newPlayer.firstName} ${newPlayer.lastName}`, player: true } };
        }, "Player created. Their code claims this same profile."); }}><label>Player first name<input required maxLength={100} value={newPlayer.firstName} onChange={event => setNewPlayer({ ...newPlayer, firstName: event.target.value })} /></label><label>Last name<input required maxLength={100} value={newPlayer.lastName} onChange={event => setNewPlayer({ ...newPlayer, lastName: event.target.value })} /></label><StaffPlayerProfileFields value={newProfile} onChange={setNewProfile} disabled={busy} /><button className="primary-cta" disabled={busy}>Add player</button></form>
      </section>}
      {manager && unassignedPlayers.length > 0 && <section className="club-card"><h2>Unassigned players</h2><p>These players belong to this organization and need a current team.</p><div className="club-player-list">{unassignedPlayers.map(player => <div className="club-player" key={player.id}>
        <Link to={organizationPlayerPath(player, admin)}><strong>{player.firstName} {player.lastName}</strong><span>Open profile and results</span></Link>
        <SignupStatus playerId={player.id} playerName={`${player.firstName} ${player.lastName}`} variant="club" reloadKey={invitationVersion} disabled={busy} />
        <label className="club-move">Team<select aria-label={`Team for ${player.firstName} ${player.lastName}`} value="" disabled={busy || !context.teams.length} onChange={event => { void mutate(() => clubCall("setClubPlayerTeam", { organizationId, playerId: player.id, teamId: event.target.value }), "Player assigned; existing results and sign-in preserved."); }}><option value="" disabled>Choose a team</option>{context.teams.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      </div>)}</div></section>}
      {manager && <>
        <section className="club-card"><h2>Organization logo</h2><p>Import the logo from your club’s official website.</p><form className="club-inline" onSubmit={event => { event.preventDefault(); void mutate(() => clubCall("importClubLogo", { organizationId, websiteUrl: websiteUrl.trim() }), "Organization logo imported."); }}><label>Official website<input type="url" required value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder="https://…" /></label><button className="primary-cta" disabled={busy}>Import logo</button></form></section>
        <section className="club-card"><h2>Invite a coach or manager</h2><p>Managers can access every team. Coaches receive access to the teams selected here.</p><form onSubmit={event => { event.preventDefault(); void mutate(async isCurrent => { const result = await clubCall<{ code: string; expiresAtMillis: number }>("createClubStaffInvitation", { organizationId, ...invite, teamIds: invite.role === "manager" ? [] : invite.teamIds }); if (isCurrent()) setInvite({ firstName: "", lastName: "", email: "", role: "coach", teamIds: [] }); return { issued: { ...result, email: invite.email } }; }, "Invitation created. Copy the code above."); }}>
          <div className="club-fields"><label>First name<input required maxLength={100} value={invite.firstName} onChange={event => setInvite({ ...invite, firstName: event.target.value })} /></label><label>Last name<input required maxLength={100} value={invite.lastName} onChange={event => setInvite({ ...invite, lastName: event.target.value })} /></label><label>Email<input type="email" required autoComplete="off" value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} /></label><label>Role<select value={invite.role} onChange={event => setInvite({ ...invite, role: event.target.value as StaffRole })}><option value="coach">Coach</option><option value="manager">Organization manager</option></select></label></div>
          {invite.role === "coach" && <TeamChecks teams={context.teams} selected={invite.teamIds} onChange={teamIds => setInvite({ ...invite, teamIds })} />}
          <button className="primary-cta" disabled={busy || (invite.role === "coach" && invite.teamIds.length === 0)}>Generate invitation code</button>
        </form></section>
        <section className="club-card"><h2>Staff access</h2>{context.staff.length === 0 && <p>No staff have claimed an invitation yet.</p>}{context.staff.map(member => <div className="club-staff" key={member.userUID}><div><strong>{member.firstName} {member.lastName}</strong><span>{member.email} · {member.role} · {member.status}</span><span>{member.role === "manager" ? "All teams" : context.teams.filter(entry => member.teamIds.includes(entry.id)).map(entry => entry.name).join(", ") || "No teams assigned"}</span></div><button className="quiet-button" disabled={busy} onClick={() => setEditedStaff({ ...member, teamIds: [...member.teamIds] })}>Edit access</button></div>)}
          {editedStaff && <form className="club-edit" onSubmit={event => { event.preventDefault(); void mutate(async isCurrent => { await clubCall("setClubStaffTeams", { organizationId, userUID: editedStaff.userUID, teamIds: editedStaff.role === "manager" ? [] : editedStaff.teamIds, status: editedStaff.status }); if (isCurrent()) setEditedStaff(null); }, "Staff access updated."); }}><h3>{editedStaff.firstName} {editedStaff.lastName}</h3>{editedStaff.role === "coach" && <TeamChecks teams={context.teams} selected={editedStaff.teamIds} onChange={teamIds => setEditedStaff({ ...editedStaff, teamIds })} />}<label>Access status<select value={editedStaff.status} onChange={event => setEditedStaff({ ...editedStaff, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label><button className="primary-cta" disabled={busy}>Save access</button><button type="button" className="quiet-button" onClick={() => setEditedStaff(null)}>Cancel</button></form>}
        </section>
        <section className="club-card"><h2>Invitations</h2>{context.invitations.length === 0 && <p>No invitations yet.</p>}{context.invitations.map(entry => <div key={entry.id} className="club-staff"><div><strong>{entry.firstName} {entry.lastName}</strong><span>{entry.email} · {entry.role} · {entry.status}</span></div>{entry.status === "pending" && <button className="quiet-button" disabled={busy} onClick={() => void mutate(() => clubCall("revokeClubStaffInvitation", { organizationId, invitationId: entry.id }), "Invitation revoked.")}>Revoke invitation</button>}</div>)}</section>
      </>}
    </>}
  </main>;
  if (admin) return <div className="pt-club">{body}</div>;
  return <div className="pt-pose portal-body pt-club"><header className="portal-header"><Link className="quiet-button" to={`/feed?organizationId=${encodeURIComponent(organizationId)}`}>Community feed</Link><Link className="portal-brand" to="/organization"><span className="portal-brand-mark">P</span>POSETEK</Link><Link className="quiet-button" to="/join">Claim invitation</Link><button className="quiet-button" onClick={() => { void auth.signOut().then(() => navigate("/signin")); }}>Sign out</button></header>{body}</div>;
}
function TeamChecks({ teams, selected, onChange }: { teams: ClubContext["teams"]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="club-team-checks"><legend>Assigned teams</legend>{teams.map(team => <label key={team.id}><input type="checkbox" checked={selected.includes(team.id)} onChange={event => onChange(event.target.checked ? [...selected, team.id] : selected.filter(id => id !== team.id))} />{team.name}</label>)}{!teams.length && <p>Create a team first.</p>}</fieldset>;
}
