import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { auth } from "../../../lib/firebase";
import { clubCall, invalidateClubContext } from "../../../lib/organization-data";
import type { ClubContext } from "../../../lib/organization-data";
import type { OrganizationRow } from "../lib/accounts";
import { useAccountLoad } from "../lib/useAccountLoad";
import type { DirectorySource } from "../lib/adminDirectory";
import { directoryCoachPath } from "../lib/adminDirectory";
import type { AdminDirectoryState } from "../lib/adminNavigation";
import { staffName } from "../lib/accountHierarchy";
import AccessLinkCard from "../../../components/AccessLinkCard";
import { accessLinkText, accessStatusLabel } from "../../../lib/access-link-issuer";
import type { IssuedAccessLink } from "../../../lib/access-link-issuer";
import { emptyStaffPlayerProfile, missingRequirement, staffPlayerProfileFields } from "../../../lib/player-profile";
import { StaffPlayerProfileFields } from "../../../components/StaffPlayerProfileFields";
import SignupStatus from "./SignupStatus";

type Staff = ClubContext["staff"][number];
type Invitation = ClubContext["invitations"][number];
type ManagementAction = { kind: "organization" } | { kind: "team"; teamId?: string; name?: string }
  | { kind: "invite" } | { kind: "access"; member: Staff } | { kind: "replace" | "revoke"; invitation: Invitation } | { kind: "logo" };

/** One-time links remain in the issuing panel during a fallible list refresh. */
function useDirectoryMutation(organizationId: string | undefined, refresh: () => void) {
  const lifetime = useRef(0), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [issued, setIssued] = useState<IssuedAccessLink | null>(null);
  const clearPrivate = useCallback(() => { ++lifetime.current; pending.current = false; setBusy(false); setError(""); setNotice(""); setIssued(null); }, []);
  useEffect(() => {
    const lifetimeRef = lifetime;
    const stop = auth.onAuthStateChanged(() => { ++lifetime.current; pending.current = false; setBusy(false); setError(""); setNotice(""); setIssued(null); });
    return () => { ++lifetimeRef.current; stop(); };
  }, [organizationId]);
  async function mutate<T>(operation: () => Promise<T>, success: string, after?: (result: T) => void) {
    const uid = auth.currentUser?.uid, generation = lifetime.current;
    if (!uid || pending.current) return;
    const current = () => generation === lifetime.current && auth.currentUser?.uid === uid;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await operation();
      if (!current()) return;
      invalidateClubContext();
      after?.(result); setNotice(success); refresh();
    } catch (failure) { if (current()) {
      const message = failure instanceof Error ? failure.message : "This change could not be saved.";
      if (/permission|access denied|unauthenticated/i.test(message)) { invalidateClubContext(); clearPrivate(); refresh(); }
      setError(message);
    } }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  async function copy(kind: "link" | "code" | "instructions") {
    const uid = auth.currentUser?.uid, generation = lifetime.current;
    if (!uid || !issued) return;
    try { await navigator.clipboard.writeText(accessLinkText(issued, kind)); if (generation === lifetime.current && auth.currentUser?.uid === uid) setNotice(`${kind === "instructions" ? "Sharing instructions" : kind === "link" ? "Activation link" : "Access code"} copied.`); }
    catch { if (generation === lifetime.current && auth.currentUser?.uid === uid) setError("Clipboard access is unavailable. Select the private code above and share it directly with instructions to open posetek.net/join."); }
  }
  return { busy, error, notice, issued, setIssued, setError, mutate, copy, clearPrivate };
}

export default function DirectoryManagement({ org, tab, state, choose, source, onOrganizationsChanged }: {
  org?: OrganizationRow; tab: "staff" | "teams" | "settings"; state: AdminDirectoryState;
  choose(patch: Partial<AdminDirectoryState>): void; source: DirectorySource; onOrganizationsChanged?: () => void;
}) {
  const loader = useCallback(() => org ? source.context(org.id) : Promise.resolve(null), [org, source]);
  const { state: loaded, refresh } = useAccountLoad(loader);
  const context = loaded.kind === "ready" ? loaded.data : null;
  const mutation = useDirectoryMutation(org?.id, refresh);
  const clearPrivate = mutation.clearPrivate;
  const [action, setAction] = useState<ManagementAction | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = () => { setAction(null); opener.current?.focus(); };
  const begin = (next: ManagementAction, target: HTMLButtonElement) => { opener.current = target; setAction(next); mutation.setError(""); };
  useEffect(() => {
    const stop = auth.onAuthStateChanged(() => setAction(null));
    return stop;
  }, []);
  useEffect(() => {
    // Permission failures invalidate private one-time links, including links retained after a failed refresh.
    // eslint-disable-next-line react/set-state-in-effect
    if (loaded.kind === "error" && /permission|access|denied|authorized/i.test(loaded.message)) { clearPrivate(); setAction(null); }
  }, [loaded, clearPrivate]);
  const save = (operation: () => Promise<unknown>, message: string, after?: (result: unknown) => void) => void mutation.mutate(operation, message, result => { after?.(result); close(); });
  return <>
    {mutation.error && <p className="form-message" role="alert">{mutation.error}</p>}{mutation.notice && <p className="directory-notice" role="status">{mutation.notice}</p>}
    {mutation.issued && <AccessLinkCard link={mutation.issued} organizationName={org?.name} disabled={mutation.busy} onCopy={kind => void mutation.copy(kind)} onDismiss={() => mutation.setIssued(null)} />}
    {loaded.kind === "loading" && <p role="status">Loading {tab === "staff" ? "staff access" : tab === "teams" ? "teams" : "organization settings"}…</p>}
    {loaded.kind === "error" && <div><p className="form-message" role="alert">{loaded.message}</p><button className="quiet-button" onClick={refresh}>Try again</button>{mutation.issued && <p className="admin-note">The activation link was created. Copy it now; the list refresh did not complete.</p>}</div>}
    {context && <>
      {(context.players.length >= 2000 || context.teams.length >= 100 || context.staff.length >= 100 || context.invitations.length >= 200) && <p className="admin-note" role="status">The organization service reached a roster limit. Contact PoseTek if a team, player, staff member or invitation is missing.</p>}
      {tab === "teams" && <>
        <div className="directory-toolbar"><p className="directory-result-count">{context.teams.length} teams</p><button className="primary-cta" disabled={mutation.busy} onClick={event => begin({ kind: "team" }, event.currentTarget)}>Add team</button><button className="quiet-button" aria-label="Refresh teams" onClick={refresh}>Refresh</button></div>
        {context.teams.length ? <table className="directory-management-table"><thead><tr><th scope="col">Team</th><th scope="col">Players</th><th scope="col">Active coaches</th><th scope="col">Actions</th></tr></thead><tbody>{context.teams.map(team => <tr key={team.id}>
          <td data-label="Team"><button className="directory-text-button" onClick={() => choose({ teamId: team.id, coachId: undefined, directoryLookup: undefined, directoryTab: "players", search: "", page: 1 })}>{team.name}</button></td>
          <td data-label="Players">{context.players.filter(player => player.organizationId === org?.id && player.teamId === team.id).length}</td>
          <td data-label="Active coaches">{context.staff.filter(member => member.role === "coach" && member.status === "active" && member.teamIds.includes(team.id)).map(staffName).join(", ") || "None assigned"}</td>
          <td data-label="Actions"><div className="directory-row-actions"><button className="quiet-button small" onClick={() => choose({ teamId: team.id, coachId: undefined, directoryLookup: undefined, directoryTab: "players", search: "", page: 1 })}>Players</button><button className="quiet-button small" disabled={mutation.busy} onClick={event => begin({ kind: "team", teamId: team.id, name: team.name }, event.currentTarget)}>Rename</button></div></td>
        </tr>)}</tbody></table> : <p className="admin-empty">No teams yet. Add a team to assign players and coaches.</p>}
      </>}
      {tab === "staff" && <>
        <div className="directory-toolbar"><p className="directory-result-count">{context.staff.length} staff accounts</p><button className="primary-cta" disabled={mutation.busy} onClick={event => begin({ kind: "invite" }, event.currentTarget)}>Add staff</button><button className="quiet-button" aria-label="Refresh staff" onClick={refresh}>Refresh</button></div>
        {context.staff.length ? <table className="directory-management-table"><thead><tr><th scope="col">Staff</th><th scope="col">Role & access</th><th scope="col">Teams</th><th scope="col">Actions</th></tr></thead><tbody>{context.staff.map(member => <tr key={member.userUID}>
          <td data-label="Staff"><Link to={directoryCoachPath(member.userUID, state)}><strong>{staffName(member)}</strong></Link><span className="directory-player-email">{member.email || "No email on file"}</span></td>
          <td data-label="Role & access">{member.role === "manager" ? "Organization admin" : "Coach"}<span className="directory-player-email">{accessStatusLabel(member.status)}</span></td>
          <td data-label="Teams">{member.role === "manager" ? "All teams" : context.teams.filter(team => member.teamIds.includes(team.id)).map(team => team.name).join(", ") || "No teams assigned"}</td>
          <td data-label="Actions"><button className="quiet-button small" disabled={mutation.busy} onClick={event => begin({ kind: "access", member }, event.currentTarget)}>Edit access</button></td>
        </tr>)}</tbody></table> : <p className="admin-empty">No staff have activated access yet. Add staff to create a private activation link.</p>}
        <h3 className="directory-section-heading">Activation links</h3><p className="admin-note">Share links directly. Creating or replacing a link sends no email.</p>
        <DirectoryInvitations invitations={context.invitations} busy={mutation.busy} onAction={begin} />
        <Link className="quiet-button" to="/admin/access">PoseTek admin access & recovery</Link>
      </>}
      {tab === "settings" && <>
        <dl className="directory-settings"><div><dt>Organization</dt><dd>{context.organization?.name}</dd></div><div><dt>Teams</dt><dd>{context.teams.length}</dd></div><div><dt>Website</dt><dd>{context.organization?.websiteUrl || "Not set"}</dd></div></dl>
        {context.organization?.logoUrl && <img className="directory-settings-logo" src={context.organization.logoUrl} alt={`${context.organization.name} logo`} />}
        <div className="directory-row-actions"><button className="quiet-button" disabled={mutation.busy} onClick={event => begin({ kind: "logo" }, event.currentTarget)}>Update organization logo</button><button className="quiet-button" disabled={mutation.busy} onClick={event => begin({ kind: "organization" }, event.currentTarget)}>Add organization</button></div>
      </>}
    </>}
    {!org && tab === "settings" && <><h2>Organization settings</h2><p className="admin-note">Select an organization to manage its settings, or create one here.</p><button className="primary-cta" disabled={mutation.busy} onClick={event => begin({ kind: "organization" }, event.currentTarget)}>Add organization</button></>}
    {action && <ManagementForm key={`${action.kind}:${"teamId" in action ? action.teamId : "member" in action ? action.member.userUID : "invitation" in action ? action.invitation.id : ""}`}
      action={action} context={context} org={org} busy={mutation.busy} cancel={close} submit={save} setError={mutation.setError} onIssued={mutation.setIssued}
      onOrganization={id => { onOrganizationsChanged?.(); choose({ orgId: id, teamId: undefined, coachId: undefined, directoryLookup: undefined, directoryTab: "teams", page: 1, search: "" }); }} />}
  </>;
}

function DirectoryInvitations({ invitations, busy, onAction }: { invitations: Invitation[]; busy: boolean; onAction(action: ManagementAction, target: HTMLButtonElement): void }) {
  return <div className="directory-invitations">{!invitations.length && <p className="admin-empty">No activation links yet.</p>}{invitations.map(invitation => {
    const editable = invitation.activationMode !== "manual" || ["pending", "expired"].includes(invitation.activationStatus || "");
    const status = invitation.activationMode === "manual" && invitation.activationStatus !== "pending" ? invitation.activationStatus || "blocked" : invitation.status;
    return <div className="directory-invitation" key={invitation.id}><div><strong>{[invitation.firstName, invitation.lastName].filter(Boolean).join(" ") || invitation.email}</strong><span className="directory-player-email">{invitation.email} · {invitation.role === "manager" ? "Organization admin" : "Coach"}</span><span className="directory-player-email">{accessStatusLabel(status, "staff_activation", invitation.expiresAtMillis)}</span>
      {invitation.activationMode !== "manual" && ["pending", "expired"].includes(invitation.status) && <span className="directory-player-email">Previous invitation process. Replace it to activate without email.</span>}</div>
      <div className="directory-row-actions">{editable && ["pending", "expired"].includes(invitation.status) && <button className="quiet-button small" disabled={busy} onClick={event => onAction({ kind: "replace", invitation }, event.currentTarget)}>Replace link</button>}
        {editable && invitation.status === "pending" && <button className="quiet-button small" disabled={busy} onClick={event => onAction({ kind: "revoke", invitation }, event.currentTarget)}>Revoke link</button>}</div></div>;
  })}</div>;
}

function ManagementForm({ action, context, org, busy, cancel, submit, setError, onIssued, onOrganization }: {
  action: ManagementAction; context: ClubContext | null; org?: OrganizationRow; busy: boolean; cancel(): void;
  submit(operation: () => Promise<unknown>, message: string, after?: (result: unknown) => void): void;
  setError(message: string): void; onIssued(link: IssuedAccessLink | null): void; onOrganization(id: string): void;
}) {
  const [name, setName] = useState(action.kind === "team" ? action.name || "" : "");
  const [website, setWebsite] = useState(context?.organization?.websiteUrl || "");
  const [invite, setInvite] = useState({ firstName: "", lastName: "", email: "", role: "coach" as "coach" | "manager", teamIds: [] as string[] });
  const [member, setMember] = useState(action.kind === "access" ? { ...action.member, teamIds: [...action.member.teamIds] } : null);
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => { form.current?.querySelector<HTMLElement>("input,select,button")?.focus(); }, []);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (action.kind === "organization") return submit(() => clubCall<{ organizationId: string }>("createClubOrganization", { name: name.trim() }), "Organization created.", result => onOrganization((result as { organizationId: string }).organizationId));
    if (!org || !context || context.role !== "admin" || context.organization?.id !== org.id) { setError("Refresh this organization before saving changes."); return; }
    const organizationId = org.id;
    if (action.kind === "team") return submit(() => clubCall("saveClubTeam", { organizationId, name: name.trim(), ...(action.teamId ? { teamId: action.teamId } : {}) }), action.teamId ? "Team renamed." : "Team created.");
    if (action.kind === "logo") return submit(() => clubCall("importClubLogo", { organizationId, websiteUrl: website.trim() }), "Organization logo imported.");
    if (action.kind === "invite") return submit(() => clubCall<IssuedAccessLink>("createClubStaffInvitation", { organizationId, ...invite, activationMode: "manual", teamIds: invite.role === "manager" ? [] : invite.teamIds }), "Activation link ready. Share it directly. No email was sent.", result => onIssued(result as IssuedAccessLink));
    if (action.kind === "access" && member) return submit(() => clubCall("setClubStaffTeams", { organizationId, userUID: member.userUID, teamIds: member.role === "manager" ? [] : member.teamIds, status: member.status }), "Staff access updated.");
    if (action.kind === "replace") return submit(() => clubCall<IssuedAccessLink>("replaceClubStaffInvitation", { organizationId, invitationId: action.invitation.id }), "Replacement link ready. The previous link no longer works. No email was sent.", result => onIssued(result as IssuedAccessLink));
    if (action.kind === "revoke") return submit(() => clubCall("revokeClubStaffInvitation", { organizationId, invitationId: action.invitation.id }), "Activation link revoked.", () => onIssued(null));
  };
  const title = action.kind === "organization" ? "Add organization" : action.kind === "team" ? action.teamId ? "Rename team" : "Add team" : action.kind === "invite" ? "Add staff" : action.kind === "access" ? "Edit staff access" : action.kind === "logo" ? "Organization logo" : action.kind === "replace" ? "Replace activation link?" : "Revoke activation link?";
  return <form className="directory-form" ref={form} aria-label={title} onSubmit={onSubmit}><h3>{title}</h3><fieldset disabled={busy}>
    {(action.kind === "organization" || action.kind === "team") && <label>{action.kind === "organization" ? "Organization name" : "Team name"}<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>}
    {action.kind === "logo" && <><p>Import the logo from the organization’s official website.</p><label>Official website<input required type="url" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://…" /></label></>}
    {action.kind === "invite" && <><p>Organization admins can access every team. Coaches receive access to the teams selected here. You get a private activation link to share directly.</p><div className="directory-form-grid">
      <label>First name<input required maxLength={100} value={invite.firstName} onChange={event => setInvite({ ...invite, firstName: event.target.value })} /></label><label>Last name<input required maxLength={100} value={invite.lastName} onChange={event => setInvite({ ...invite, lastName: event.target.value })} /></label>
      <label>Email<input required type="email" autoComplete="off" spellCheck={false} value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} /></label><label>Role<select value={invite.role} onChange={event => setInvite({ ...invite, role: event.target.value as "coach" | "manager" })}><option value="coach">Coach</option><option value="manager">Organization admin</option></select></label>
    </div>{invite.role === "coach" && <TeamChoices teams={context?.teams || []} selected={invite.teamIds} change={teamIds => setInvite({ ...invite, teamIds })} />}</>}
    {action.kind === "access" && member && <><p>{staffName(member)} · {member.email}</p>{member.role === "coach" && <TeamChoices teams={context?.teams || []} selected={member.teamIds} change={teamIds => setMember({ ...member, teamIds })} />}
      <label>Access status<select value={member.status} onChange={event => setMember({ ...member, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option>{!["active", "inactive"].includes(member.status) && <option value={member.status} disabled>{accessStatusLabel(member.status)}</option>}</select></label></>}
    {(action.kind === "replace" || action.kind === "revoke") && <p>{action.kind === "replace" ? "This creates a new link with the same role and teams. The previous link will stop working. Existing passwords stay the same." : "This stops the pending link from granting access. Existing active staff memberships are unchanged."} Account: <strong>{action.invitation.email}</strong>.</p>}
    <div className="directory-form-actions"><button className="primary-cta" disabled={busy || (action.kind === "invite" && invite.role === "coach" && !invite.teamIds.length)}>{busy ? "Saving…" : action.kind === "invite" ? "Create activation link" : action.kind === "replace" ? "Replace activation link" : action.kind === "revoke" ? "Revoke activation link" : "Save"}</button><button type="button" className="quiet-button" onClick={cancel}>Cancel</button></div>
  </fieldset></form>;
}

function TeamChoices({ teams, selected, change }: { teams: ClubContext["teams"]; selected: string[]; change(ids: string[]): void }) {
  return <fieldset className="directory-team-choices"><legend>Assigned teams</legend>{teams.map(team => <label key={team.id}><input type="checkbox" checked={selected.includes(team.id)} onChange={event => change(event.target.checked ? [...selected, team.id] : selected.filter(id => id !== team.id))} />{team.name}</label>)}{!teams.length && <p>Add a team before inviting a coach.</p>}</fieldset>;
}

export function DirectoryPlayerActions({ org, context, currentTeamId, denied = false, onChanged }: { org: OrganizationRow; context: ClubContext | null; currentTeamId?: string; denied?: boolean; onChanged(): void }) {
  const mutation = useDirectoryMutation(org.id, onChanged);
  const [action, setAction] = useState<"add" | "move" | null>(null), [invitedPlayer, setInvitedPlayer] = useState<{ id: string; name: string } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const clearPrivate = mutation.clearPrivate;
  useEffect(() => { const stop = auth.onAuthStateChanged(() => { setAction(null); setInvitedPlayer(null); }); return stop; }, []);
  useEffect(() => {
    // Clear retained player creation data only for an authority failure, not a transient refresh outage.
    // eslint-disable-next-line react/set-state-in-effect
    if (denied) { clearPrivate(); setAction(null); setInvitedPlayer(null); }
  }, [denied, clearPrivate]);
  const close = () => { setAction(null); opener.current?.focus(); };
  return <>
    <div className="directory-player-tools"><button className="quiet-button" disabled={!context || mutation.busy || !context.teams.length} onClick={event => { opener.current = event.currentTarget; setAction("add"); }}>Add player</button><button className="quiet-button" disabled={!context || mutation.busy || !context.players.length || !context.teams.length} onClick={event => { opener.current = event.currentTarget; setAction("move"); }}>Move a player</button>{context && !context.teams.length && <span className="admin-note">Add a team in Teams before adding a player.</span>}</div>
    {mutation.error && <p className="form-message" role="alert">{mutation.error}</p>}{mutation.notice && <p className="directory-notice" role="status">{mutation.notice}</p>}
    {invitedPlayer && <section className="directory-form"><h3>Player invitation ready</h3><p>{invitedPlayer.name}. Share their signup link to claim this same profile.</p><SignupStatus playerId={invitedPlayer.id} playerName={invitedPlayer.name} reloadKey={invitedPlayer.id} /><button className="quiet-button" onClick={() => setInvitedPlayer(null)}>Done</button></section>}
    {action && context && <PlayerMutationForm key={action} action={action} context={context} initialTeamId={currentTeamId} busy={mutation.busy} cancel={close} setError={mutation.setError} submit={(operation, message, after) => void mutation.mutate(operation, message, result => { after?.(result); close(); })} onPlayer={setInvitedPlayer} />}
  </>;
}
function PlayerMutationForm({ action, context, initialTeamId, busy, cancel, setError, submit, onPlayer }: { action: "add" | "move"; context: ClubContext; initialTeamId?: string; busy: boolean; cancel(): void; setError(message: string): void;
  submit(operation: () => Promise<unknown>, message: string, after?: (result: unknown) => void): void; onPlayer(player: { id: string; name: string }): void }) {
  const [name, setName] = useState({ firstName: "", lastName: "" }), [profile, setProfile] = useState(emptyStaffPlayerProfile);
  const [teamId, setTeamId] = useState(context.teams.some(team => team.id === initialTeamId) ? initialTeamId! : ""), [playerId, setPlayerId] = useState("");
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => { form.current?.querySelector<HTMLElement>("input,select")?.focus(); }, []);
  return <form className="directory-form" ref={form} aria-label={action === "add" ? "Add player" : "Move player"} onSubmit={event => {
    event.preventDefault(); const organizationId = context.organization?.id;
    if (!organizationId || context.role !== "admin" || !context.teams.some(team => team.id === teamId)) { setError("Choose a current team before saving."); return; }
    if (action === "move") {
      if (!context.players.some(player => player.id === playerId && player.organizationId === organizationId)) { setError("Choose a player from this organization."); return; }
      return submit(() => clubCall("setClubPlayerTeam", { organizationId, playerId, teamId }), "Player moved; existing results and sign-in preserved.");
    }
    const missing = missingRequirement(profile); if (missing) { setError(missing); return; }
    submit(() => clubCall<{ playerId: string }>("createClubPlayer", { organizationId, teamId, ...name, ...staffPlayerProfileFields(profile) }), "Player created. Their signup link claims this same profile.", result => onPlayer({ id: (result as { playerId: string }).playerId, name: `${name.firstName} ${name.lastName}` }));
  }}><h3>{action === "add" ? "Add player" : "Move player"}</h3><fieldset disabled={busy}><div className="directory-form-grid">
    {action === "move" ? <label>Player<select required value={playerId} onChange={event => setPlayerId(event.target.value)}><option value="" disabled>Choose a player</option>{context.players.map(player => <option key={player.id} value={player.id}>{player.firstName} {player.lastName}</option>)}</select></label> : <><label>First name<input required maxLength={100} value={name.firstName} onChange={event => setName({ ...name, firstName: event.target.value })} /></label><label>Last name<input required maxLength={100} value={name.lastName} onChange={event => setName({ ...name, lastName: event.target.value })} /></label><StaffPlayerProfileFields value={profile} onChange={setProfile} disabled={busy} /></>}
    <label>{action === "move" ? "Move to team" : "Team"}<select required value={teamId} onChange={event => setTeamId(event.target.value)}><option value="" disabled>Choose a team</option>{context.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    </div>{action === "move" && <p>Results, signup codes and existing sign-in stay with this player.</p>}<div className="directory-form-actions"><button className="primary-cta" disabled={busy}>{busy ? "Saving…" : action === "add" ? "Create player" : "Save team assignment"}</button><button type="button" className="quiet-button" onClick={cancel}>Cancel</button></div></fieldset></form>;
}
