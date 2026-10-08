import { useCallback, useEffect, useRef, useState } from "react";
import firebase, { auth } from "../lib/firebase";
import { getClubContext } from "../lib/organization-data";
import type { ClubContext } from "../lib/organization-data";
import { accessLinkText, refreshAfterIssued } from "../lib/access-link-issuer";
import { callRecovery, canManagePlayerRecovery, recoveryError, recoverySelectionIsCurrent, recoveryStatus } from "../lib/account-recovery";
import type { PlayerRecoveryLink, RecoveryPage, RecoveryRequest, RecoveryTarget } from "../lib/account-recovery";
import AccessLinkCard from "./AccessLinkCard";
import "./account-recovery.scss";

type PlayerChoice = Pick<ClubContext["players"][number], "id" | "firstName" | "lastName">;
type Props = { organizationId?: string; initialOrganizationId?: string; organizationName?: string; players?: PlayerChoice[]; selectedPlayerId?: string; selectionRevision?: number; role?: string; preview?: boolean };
const requestDate = (value: number) => new Date(value).toLocaleString();
const sampleRequest: RecoveryRequest = { requestId: "00000000-0000-4000-8000-000000000001", status: "new", handlingStatus: "new", claimedName: "Sample player", claimedEmail: "player@example.test", claimedOrganizationName: "Sample organization", identityVerified: false, organizationId: null, playerId: null, playerName: null, createdAtMillis: 1791400000000, updatedAtMillis: 1791400000000, expiresAtMillis: 1794000000000, grantId: null, note: "" };

export default function AccountRecoveryWorkspace({ organizationId: scope, initialOrganizationId = "", organizationName, players: scopedPlayers, selectedPlayerId = "", selectionRevision = 0, role = "admin", preview = false }: Props) {
  const [rows, setRows] = useState<RecoveryRequest[]>(preview ? [sampleRequest] : []);
  const [cursor, setCursor] = useState<RecoveryPage["nextCursor"]>(null);
  const [selectedId, setSelectedId] = useState("");
  const [organizationId, setOrganizationId] = useState(scope || initialOrganizationId);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [players, setPlayers] = useState<PlayerChoice[]>(scopedPlayers || []);
  const [playerId, setPlayerId] = useState(selectedPlayerId);
  const [target, setTarget] = useState<RecoveryTarget | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [issued, setIssued] = useState<PlayerRecoveryLink | null>(null);
  const [password, setPassword] = useState(""), [showPassword, setShowPassword] = useState(false), [needsReauth, setNeedsReauth] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(!preview), [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [sessionRevision, setSessionRevision] = useState(0);
  const [refreshUnavailable, setRefreshUnavailable] = useState(false);
  const mounted = useRef(false), generation = useRef(0), reads = useRef(0), working = useRef(false), currentUid = useRef<string | null>(null);
  const selection = useRef({ organizationId, playerId });
  selection.current = { organizationId, playerId };
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const errorRef = useRef<HTMLParagraphElement>(null), passwordRef = useRef<HTMLInputElement>(null);
  const selected = rows.find(row => row.requestId === selectedId);
  const allowed = canManagePlayerRecovery(role);

  const reload = useCallback(async (page: RecoveryPage["nextCursor"] = null) => {
    if (preview || !allowed || !auth.currentUser) return;
    const uid = auth.currentUser.uid, version = ++reads.current;
    const current = () => mounted.current && reads.current === version && currentUid.current === uid && auth.currentUser?.uid === uid;
    setLoading(true);
    try {
      const selectedRequestId = selectedIdRef.current;
      const [listing, reread] = await Promise.allSettled([
        callRecovery<RecoveryPage>("listAccountRecoveryRequests", { ...(scope ? { organizationId: scope } : {}), ...(page ? { cursor: page } : {}) }),
        selectedRequestId ? callRecovery<RecoveryPage>("listAccountRecoveryRequests", { requestId: selectedRequestId, ...(scope ? { organizationId: scope } : {}) }) : Promise.resolve(null),
      ]);
      if (listing.status === "rejected") { if (current()) setRefreshUnavailable(true); throw listing.reason; }
      if (!current()) return;
      const result = listing.value;
      const rejectedCode = reread.status === "rejected" && reread.reason && typeof reread.reason === "object" ? String(reread.reason.code || "").split("/").pop() : "";
      const unavailable = ["permission-denied", "not-found", "failed-precondition"].includes(rejectedCode || "");
      const exact = reread.status === "fulfilled" ? reread.value?.requests.find(row => row.requestId === selectedRequestId) : unavailable ? undefined : result.requests.find(row => row.requestId === selectedRequestId);
      if (selectedRequestId && reread.status === "rejected" && !unavailable && !exact) { setRefreshUnavailable(true); throw reread.reason; }
      setRefreshUnavailable(false);
      setRows(old => {
        const base = page ? [...old, ...result.requests.filter(row => !old.some(prior => prior.requestId === row.requestId))] : result.requests;
        const withoutSelected = selectedRequestId ? base.filter(row => row.requestId !== selectedRequestId) : base;
        return exact ? [exact, ...withoutSelected] : withoutSelected;
      });
      setCursor(result.nextCursor);
      if (selectedRequestId && !exact && selectedIdRef.current === selectedRequestId) { setSelectedId(""); setIssued(null); setTarget(null); setIdentityConfirmed(false); setNotice("The selected request is no longer available in this scope. Choose another request or ask PoseTek to review it."); }
    } finally { if (current()) setLoading(false); }
  }, [scope, preview, allowed]);

  useEffect(() => {
    mounted.current = true;
    if (preview || !allowed) return () => { mounted.current = false; };
    const stop = auth.onAuthStateChanged(user => {
      ++generation.current; ++reads.current; currentUid.current = user?.uid ?? null; working.current = false;
      setSessionRevision(value => value + 1);
      setRows([]); setCursor(null); setSelectedId(""); setTarget(null); setIssued(null); setIdentityConfirmed(false);
      setOrganizations([]); if (!scope) setPlayers([]);
      setPassword(""); setShowPassword(false); setNeedsReauth(false); setBusy(false); setError(""); setNotice("");
      setRefreshUnavailable(false);
      if (!user) { setLoading(false); return; }
      void reload().catch(failure => { if (mounted.current && currentUid.current === user.uid) setError(recoveryError(failure)); });
      if (!scope) void getClubContext().then(context => { if (mounted.current && currentUid.current === user.uid && auth.currentUser?.uid === user.uid) setOrganizations(context.organizations); }).catch(failure => { if (mounted.current && currentUid.current === user.uid) setError(recoveryError(failure)); });
    });
    return () => { mounted.current = false; ++generation.current; ++reads.current; stop(); };
  }, [scope, preview, allowed, reload]);
  useEffect(() => { setPlayers(scopedPlayers || []); }, [scopedPlayers]);
  useEffect(() => { setOrganizationId(scope || initialOrganizationId); }, [scope, initialOrganizationId]);
  useEffect(() => { if (selectedPlayerId) { setPlayerId(selectedPlayerId); setSelectedId(""); setIssued(null); setIdentityConfirmed(false); } }, [selectedPlayerId, selectionRevision]);
  useEffect(() => {
    if (scope || !organizationId || preview || !allowed) return;
    let active = true;
    const uid = auth.currentUser?.uid;
    setPlayers([]);
    void getClubContext(organizationId).then(context => {
      if (!active || !uid || auth.currentUser?.uid !== uid) return;
      setPlayers(context.players);
      setPlayerId(current => context.players.some(player => player.id === current) ? current : "");
    }).catch(failure => { if (active && uid && auth.currentUser?.uid === uid) setError(recoveryError(failure)); });
    return () => { active = false; };
  }, [scope, organizationId, preview, allowed, sessionRevision]);
  useEffect(() => {
    const version = ++generation.current;
    working.current = false; setBusy(false);
    setTarget(null); setIdentityConfirmed(false); setPassword(""); setNeedsReauth(false); setError("");
    if (!organizationId || !playerId || preview || !allowed || !auth.currentUser) { setInspecting(false); return; }
    const uid = auth.currentUser.uid;
    const expected = { uid, organizationId, playerId, revision: version };
    const current = () => mounted.current && recoverySelectionIsCurrent(expected, { uid: auth.currentUser?.uid || null, ...selection.current, revision: generation.current });
    setInspecting(true);
    void callRecovery<RecoveryTarget>("inspectPlayerRecovery", { organizationId, playerId }).then(result => {
      if (!current()) return;
      if (result.playerId !== playerId || result.organizationId !== organizationId || result.recoverable !== true) throw new Error("Target changed");
      setTarget(result);
    }).catch(failure => { if (current()) setError(recoveryError(failure)); }).finally(() => { if (current()) setInspecting(false); });
    return () => { ++generation.current; };
  }, [organizationId, playerId, selectedId, preview, allowed, sessionRevision]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (needsReauth) passwordRef.current?.focus(); }, [needsReauth]);

  async function perform(action: () => Promise<PlayerRecoveryLink | null>, success: string, recentLogin = false) {
    if (preview || !allowed || working.current || !auth.currentUser) return;
    const user = auth.currentUser, version = generation.current;
    const expected = { uid: user.uid, ...selection.current, revision: version };
    const current = () => mounted.current && currentUid.current === user.uid && recoverySelectionIsCurrent(expected, { uid: auth.currentUser?.uid || null, ...selection.current, revision: generation.current });
    working.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (recentLogin) {
        const token = await user.getIdTokenResult(true);
        if (!current()) return;
        if (typeof token.claims.auth_time !== "number" || Date.now() / 1000 - token.claims.auth_time >= 285) {
          setNeedsReauth(true);
          if (!password || !user.email) { setError("Enter your own password below, then repeat this action."); return; }
          await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
          if (!current()) return;
          await user.getIdToken(true); if (!current()) return;
        }
      }
      setPassword(""); setShowPassword(false); setNeedsReauth(false);
      const result = await action();
      if (!current()) return;
      if (result) {
        const outcome = await refreshAfterIssued(result, { isCurrent: current, retain: setIssued, refresh: () => reload() });
        if (outcome === "stale") return;
        setSelectedId(result.requestId); setIdentityConfirmed(false);
        if (outcome === "saved-refresh-failed") setError("The link was created. Copy it now; refresh the requests before marking it shared.");
      } else {
        try { await reload(); } catch { if (current()) setError("The action was saved. Refresh the requests to check the latest status."); }
      }
      if (current()) setNotice(success);
    } catch (failure) { if (current()) { setPassword(""); setError(recoveryError(failure)); } }
    finally { if (current()) { working.current = false; setBusy(false); } }
  }
  function chooseRequest(row: RecoveryRequest) {
    ++reads.current; setLoading(false);
    setSelectedId(row.requestId); setIssued(null); setNotice("");
    if (row.organizationId) setOrganizationId(row.organizationId);
    setPlayerId(row.playerId || "");
  }
  function update(status: string) {
    if (!selected || refreshUnavailable) return;
    const request = selected;
    void perform(async () => {
      await callRecovery("updateAccountRecoveryRequest", { requestId: request.requestId, expectedUpdatedAtMillis: request.updatedAtMillis, status, ...(scope ? { organizationId: scope } : {}), ...(!scope && target && status === "in_review" && !request.grantId && (request.organizationId !== target.organizationId || request.playerId !== target.playerId) ? { organizationId: target.organizationId, playerId: target.playerId } : {}) });
      return null;
    }, status === "link_shared" ? "Marked as shared. Sign-in remains unconfirmed until the player completes recovery." : "Request status saved.");
  }
  async function copy(kind: "link" | "code" | "instructions") {
    if (!issued || !auth.currentUser) return;
    const uid = auth.currentUser.uid, version = generation.current;
    try { await navigator.clipboard.writeText(accessLinkText(issued, kind)); if (mounted.current && auth.currentUser?.uid === uid && generation.current === version) setNotice("Copied. After sharing with the confirmed person, choose Mark link as shared."); }
    catch { if (mounted.current && auth.currentUser?.uid === uid) setError("Clipboard access is unavailable. Select the private code and share it directly."); }
  }
  if (!allowed) return null;
  return <section id={scope ? "organization-recovery" : "admin-player-recovery"} className={`${scope ? "club-card" : "admin-card"} account-recovery`} data-clarity-mask="true" aria-labelledby="recovery-workspace-heading">
    <div className="recovery-heading"><div><h2 id="recovery-workspace-heading">Player sign-in help</h2><p>{scope ? `Help players in ${organizationName || "your organization"}.` : "Review help requests and recover a selected player's existing account."} Password changes keep their results and organization access.</p></div><button type="button" className="quiet-button" disabled={preview || busy || loading} onClick={() => void reload().catch(failure => { if (mounted.current) setError(recoveryError(failure)); })}>Refresh requests</button></div>
    {preview && <p role="status">Illustrative, read-only preview. No requests or recovery links are created.</p>}
    {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {issued && <><AccessLinkCard link={issued} organizationName={organizationName || target?.organizationName} disabled={busy || preview} onCopy={kind => void copy(kind)} onDismiss={() => setIssued(null)} /><p>Copying a link does not record delivery.</p></>}
    <div className="recovery-selection">
      {!scope && <label>Organization<select value={organizationId} disabled={busy || preview} onChange={event => { if (selected?.grantId) setSelectedId(""); setOrganizationId(event.target.value); setPlayerId(""); setTarget(null); setIssued(null); setIdentityConfirmed(false); }}><option value="">Choose an organization</option>{organizations.map(org => <option value={org.id} key={org.id}>{org.name}</option>)}</select></label>}
      <label>Player<select value={playerId} disabled={busy || preview || !organizationId} onChange={event => { if (selected?.grantId || scope) setSelectedId(""); setPlayerId(event.target.value); setTarget(null); setIssued(null); setIdentityConfirmed(false); }}><option value="">Choose the existing player</option>{players.map(player => <option key={player.id} value={player.id}>{player.firstName} {player.lastName}</option>)}</select></label>
    </div>
    {inspecting && <p role="status">Checking the selected player's account…</p>}
    {target && <div className="recovery-target"><strong>{target.playerName}</strong><span>{target.organizationName}</span><span>Current sign-in account: {target.email}</span><p>This account comes from the server's player binding. The requester's claims do not verify their identity.</p><form onSubmit={event => { event.preventDefault(); if (identityConfirmed && target.playerId === playerId && target.organizationId === organizationId) void perform(() => callRecovery<PlayerRecoveryLink>("issuePlayerRecovery", { organizationId: target.organizationId, playerId: target.playerId, identityConfirmed: true, ...(selected ? { requestId: selected.requestId } : {}) }), "Recovery link created. Share it directly with the confirmed person. No email was sent.", true); }}>
      <fieldset disabled={busy || preview || refreshUnavailable}><legend className="recovery-sr-only">Confirm the recipient</legend><label className="recovery-confirm"><input type="checkbox" required checked={identityConfirmed} onChange={event => setIdentityConfirmed(event.target.checked)} /><span>I have independently confirmed this person owns the existing account shown above.</span></label><button type="submit" className="primary-cta" disabled={!identityConfirmed}>{busy ? "Creating link…" : "Create private recovery link"}</button></fieldset>
    </form></div>}
    {needsReauth && <div className="recovery-target"><h3>Confirm your sign-in</h3><p>Enter your own password, then repeat your action.</p><label>Your password<div className="recovery-password"><input ref={passwordRef} name="recovery-current-password" type={showPassword ? "text" : "password"} autoComplete="current-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" className="quiet-button" aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></div></label></div>}
    <h3>Help requests</h3><p>Submitted details are unverified. A password update and a confirmed sign-in are separate server checks.</p>
    {loading && <p role="status">Loading sign-in help requests…</p>}
    {!loading && !rows.length && <p>No help requests in this scope. Select a player above to help directly.</p>}
    {rows.map(row => <div className="recovery-row" key={row.requestId}><div><strong>{row.playerName || row.claimedName || "Unverified requester"}</strong><small>{recoveryStatus(row.status)} · {requestDate(row.updatedAtMillis)}</small><small>Reference: {row.requestId}</small></div><button type="button" className="quiet-button" disabled={busy} aria-label={`Review sign-in request ${row.requestId}`} onClick={() => chooseRequest(row)}>Review request</button></div>)}
    {cursor && <button type="button" className="quiet-button" disabled={busy || loading || preview} onClick={() => void reload(cursor).catch(failure => { if (mounted.current) setError(recoveryError(failure)); })}>Load older requests</button>}
    {selected && <div className="recovery-request-detail"><h3>Selected help request</h3><p><strong>{recoveryStatus(selected.status)}</strong></p><p>Unverified name: {selected.claimedName || "Not provided"}<br />Unverified account email: {selected.claimedEmail}<br />Unverified organization: {selected.claimedOrganizationName || "Not provided"}<br />Contact details supplied: {selected.contact || "Not provided"}</p><p>Reference: {selected.requestId}</p>
      {selected.linkSharedAtMillis && <p>Sharing recorded {requestDate(selected.linkSharedAtMillis)}.</p>}{selected.passwordUpdatedAtMillis && <p>Password updated {requestDate(selected.passwordUpdatedAtMillis)}.</p>}{selected.signInConfirmedAtMillis && <p>Sign-in confirmed {requestDate(selected.signInConfirmedAtMillis)}.</p>}
      <fieldset disabled={busy || preview || refreshUnavailable}><legend className="recovery-sr-only">Request actions</legend><div className="recovery-actions"><button type="button" className="quiet-button" disabled={selected.handlingStatus === "closed"} onClick={() => update("in_review")}>Mark in review</button>{selected.grantId && ["link_ready", "link_shared"].includes(selected.status) && <button type="button" className="quiet-button" disabled={selected.status === "link_shared" || ["needs_review", "closed"].includes(selected.handlingStatus)} onClick={() => update("link_shared")}>Mark link as shared</button>}{selected.grantId && selected.grantStatus === "pending" && <button type="button" className="quiet-button" onClick={() => void perform(async () => { await callRecovery("revokeAccountAccessLink", { grantId: selected.grantId }); if (issued?.grantId === selected.grantId) setIssued(null); return null; }, "Recovery link revoked; the account is unchanged.", true)}>Revoke recovery link</button>}<button type="button" className="quiet-button" disabled={selected.handlingStatus === "closed"} onClick={() => update("needs_review")}>Needs PoseTek review</button><button type="button" className="quiet-button" disabled={selected.handlingStatus === "closed"} onClick={() => update("closed")}>Close request</button></div></fieldset><p>Closing a request does not revoke its recovery link. Revoke an unused link separately if needed.</p><button type="button" className="quiet-button" disabled={busy} onClick={() => { setSelectedId(""); setTarget(null); setIdentityConfirmed(false); setIssued(null); }}>Clear selection</button>
    </div>}
  </section>;
}
