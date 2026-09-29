/* eslint-disable @typescript-eslint/no-explicit-any */
// Port of coachesview.html + coach-roster.js (coach roster page).
// Behavior parity: same Firestore collections/fields/batches, same dialog flow,
// same preview mode (?preview=1), same copy and class names.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { clubCall, getClubContext, loadClubPlayers } from "../../lib/organization-data";
import type { ClubContext } from "../../lib/organization-data";
import { readAccessibleLegacyRoster } from "../../lib/legacy-roster";
import { selectedTeam } from "../../lib/organization";
import firebase, { auth, cloud, db } from "../../lib/firebase";
import { findCoach as findCoachByUid } from "../../lib/identity";
import { emptyStaffPlayerProfile, missingRequirement, staffPlayerProfileFields } from "../../lib/player-profile";
import { StaffPlayerProfileFields } from "../../components/StaffPlayerProfileFields";
import {
  filterPlayers,
  fullName,
  initials,
  isRegistered,
  makeCode,
  sortByName,
  summaryText,
} from "./rosterLogic";
import "../../styles/pose-portal.css";

// UID-first coach resolution shared with every legacy page (firebase-identity.js).
async function findCoach(uid: string) {
  return findCoachByUid(db, uid);
}

// A player created whose roster link has not been saved yet (legacy
// `pendingRosterPlayer`): the create button becomes "Retry Roster Link".
interface PendingRosterPlayer {
  id: string;
  uid: string;
  coachId: string;
}

const PENDING_LINK_MESSAGE = "A created player needs its roster link saved. Tap Retry Roster Link.";

// Legacy preview roster (unsorted, rendered in this order).
const PREVIEW_PLAYERS: any[] = [
  { id: "preview-player", firstName: "Jordan", lastName: "Rivera", registered: true, userUID: "preview-auth" },
  { id: "preview-2", firstName: "Maya", lastName: "Thompson", registered: false, signupCode: "PLR7K9Q" },
  { id: "preview-3", firstName: "Eli", lastName: "Santos", registered: true, userUID: "preview-auth-2" },
  { id: "preview-4", firstName: "Avery", lastName: "Chen", registered: false, signupCode: "PLR4M8T" },
];

type GridMode = { kind: "loading" } | { kind: "list" } | { kind: "error"; message: string };

export default function RosterPage({ managementOnly = false, organizationId, teamId, onChanged }: { managementOnly?: boolean; organizationId?: string; teamId?: string; onChanged?: () => void } = {}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [players, setPlayers] = useState<any[]>([]);
  // Legacy summary/search visibility only change once render() has run.
  const [rendered, setRendered] = useState(false);
  const [gridMode, setGridMode] = useState<GridMode>({ kind: "loading" });
  const [orgLabel, setOrgLabel] = useState("Coach dashboard");
  const [searchTerm, setSearchTerm] = useState("");
  const [addTab, setAddTab] = useState<"new" | "existing">("new");
  const [formMessage, setFormMessage] = useState({ text: "", success: false });
  const [createBusy, setCreateBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [pendingPlayer, setPendingPlayer] = useState<PendingRosterPlayer | null>(null);

  const [club, setClub] = useState<ClubContext | null>(null);
  const [clubTeamId, setClubTeamId] = useState("");
  const clubRef = useRef<{ context: ClubContext; teamId: string } | null>(null);
  const coachDocRef = useRef<any>(null);
  // The pending link is read inside async handlers, so keep a ref in step with
  // the rendered state (legacy used one closure variable for both).
  const pendingRef = useRef<PendingRosterPlayer | null>(null);
  const setPending = (value: PendingRosterPlayer | null) => {
    pendingRef.current = value;
    setPendingPlayer(value);
  };
  // Sign-out also fires onAuthStateChanged(null); legacy sent both redirects to
  // the same bare URL (kickai.html). Guard so we land on plain /signin, not
  // /signin?returnTo=… captured mid-sign-out.
  const signingOutRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState(emptyStaffPlayerProfile);
  const loadEpoch = useRef(0);
  const mounted = useRef(false);

  const setMessage = useCallback((text: string, success = false) => {
    setFormMessage({ text, success });
  }, []);

  const loadRoster = useCallback(async (requestedTeamId?: string) => {
    setGridMode({ kind: "loading" });
    const user = auth.currentUser;
    if (!user) return;
    const epoch = ++loadEpoch.current;
    const current = () => mounted.current && loadEpoch.current === epoch && auth.currentUser?.uid === user.uid;
    const context = await getClubContext(organizationId);
    if (!current()) return;
    if (!managementOnly && (context.role === "manager" || context.role === "admin")) { navigate("/organization", { replace: true }); return; }
    if (["coach", "manager", "admin"].includes(context.role) && context.organization) {
      const requested = requestedTeamId ?? teamId ?? new URLSearchParams(window.location.search).get("team");
      if (requested && !context.teams.some(entry => entry.id === requested)) throw new Error("This team is no longer available. Refresh Team Insights.");
      const chosen = selectedTeam(context.teams, requested);
      if (!chosen) { if (!managementOnly) navigate("/organization", { replace: true }); else setGridMode({ kind: "error", message: "Select a team before adding a player." }); return; }
      clubRef.current = { context, teamId: chosen.id }; setClub(context); setClubTeamId(chosen.id);
      coachDocRef.current = managementOnly ? null : await findCoach(user.uid);
      if (!current()) return;
      setOrgLabel(`${context.organization.name} · ${chosen.name}`);
      const loaded = managementOnly ? [] : sortByName(await loadClubPlayers(chosen));
      if (!current()) return;
      setPlayers(loaded); setRendered(true); setGridMode({ kind: "list" }); return;
    }
    clubRef.current = null; setClub(null);
    const coachDoc = await findCoach(user.uid);
    if (!current()) return;
    // Assign before the throw (legacy order): a failed refresh must clear the
    // stale coach doc so add/create can't write against it afterwards.
    coachDocRef.current = coachDoc;
    if (!coachDoc) throw new Error("No coach profile is linked to this sign-in.");
    const coach = coachDoc.data() || {};
    if (Object.hasOwn(coach, "organizationId") || Object.hasOwn(coach, "organizationRole")) throw new Error("Your club access is inactive or unavailable. Ask your organization manager to review it.");
    if (managementOnly) { setPlayers([]); setRendered(true); setGridMode({ kind: "list" }); return; }
    if ((coach.organization || coach.org)?.get) {
      try {
        const org = await (coach.organization || coach.org).get();
        setOrgLabel(org.exists ? org.data().name || "Coach dashboard" : "Independent coach");
      } catch {
        setOrgLabel("Coach dashboard");
      }
    } else setOrgLabel("Independent coach");
    const ids = [...new Set(Array.isArray(coach.members) ? coach.members : [])];
    const docs = await readAccessibleLegacyRoster(ids as string[], id => db.collection("players").doc(id).get());
    const loaded = sortByName(
      docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() })),
    );
    setPlayers(loaded);
    setRendered(true);
    setGridMode({ kind: "list" });
  }, [managementOnly, organizationId, teamId, navigate]);

  const showError = useCallback((error: any) => {
    console.error("[roster]", error);
    setGridMode({ kind: "error", message: error.message || "Please refresh and try again." });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!managementOnly) document.title = "Roster | PoseTek";
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1") {
      setOrgLabel("Vacaville Training");
      setPlayers([...PREVIEW_PLAYERS]);
      setRendered(true);
      setGridMode({ kind: "list" });
      return () => { mounted.current = false; ++loadEpoch.current; };
    }
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (!user) {
        ++loadEpoch.current; setPlayers([]); coachDocRef.current = null; clubRef.current = null;
        if (signingOutRef.current) return;
        // Legacy sent no returnTo from here: a signed-out player who lands on
        // the roster should sign in and get the role-based destination
        // (profile for players), not bounce back to the coach roster.
        navigate("/signin", { replace: true });
        return;
      }
      loadRoster().catch(showError);
    });
    return () => { mounted.current = false; ++loadEpoch.current; unsubscribe(); };
    // Boot once, like the legacy script tag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRoster, managementOnly, navigate, showError]);

  async function handleSignOut() {
    signingOutRef.current = true;
    await auth.signOut();
    navigate("/signin"); // legacy: location.href = "kickai.html"
  }

  function openDialog() {
    setMessage(pendingRef.current ? PENDING_LINK_MESSAGE : "");
    dialogRef.current?.showModal();
  }

  function switchTab(tab: "new" | "existing") {
    setAddTab(tab);
    setMessage(pendingRef.current ? PENDING_LINK_MESSAGE : "");
  }

  function handleSearch(value: string) {
    setSearchTerm(value);
    // Legacy input listener calls render(), which overwrites whatever the grid held.
    setRendered(true);
    setGridMode({ kind: "list" });
  }

  function openPlayer(id: string) {
    const preview = new URLSearchParams(location.search).get("preview") === "1";
    // legacy: profile.html?{preview=1&}player=<id>&userType=coach
    navigate(`/athlete?${preview ? "preview=1&" : ""}player=${encodeURIComponent(id)}&userType=coach`);
  }

  async function createPlayer() {
    const user = auth.currentUser;
    const coachDoc = coachDocRef.current;
    if (!user || (!clubRef.current && (!coachDoc || coachDoc.data().userUID !== user.uid))) {
      return setMessage("Please sign in again with your coach account.");
    }
    const firstName = firstNameRef.current?.value.trim() ?? "";
    const lastName = lastNameRef.current?.value.trim() ?? "";
    const missing = missingRequirement(profile);
    if (clubRef.current) {
      if (!firstName || !lastName) return setMessage("Enter both a first and last name.");
      if (missing) return setMessage(missing);
      setCreateBusy(true); setMessage("");
      try {
        await clubCall("createClubPlayer", { organizationId: clubRef.current.context.organization!.id, teamId: clubRef.current.teamId, firstName, lastName, ...staffPlayerProfileFields(profile) });
        if (firstNameRef.current) firstNameRef.current.value = "";
        if (lastNameRef.current) lastNameRef.current.value = "";
        setProfile(emptyStaffPlayerProfile());
        if (!mounted.current || auth.currentUser?.uid !== user.uid) return;
        dialogRef.current?.close(); await loadRoster(clubRef.current.teamId); onChanged?.();
      } catch (failure: any) { setMessage(failure.message || "The player could not be created."); }
      finally { setCreateBusy(false); }
      return;
    }
    const pendingBefore = pendingRef.current;
    if (pendingBefore && (pendingBefore.uid !== user.uid || pendingBefore.coachId !== coachDoc.id)) {
      return setMessage("Return to the coach account that created the pending player to finish its roster link.");
    }
    if (!pendingBefore && (!firstName || !lastName)) return setMessage("Enter both a first and last name.");
    if (!pendingBefore && missing) return setMessage(missing);
    setCreateBusy(true);
    setMessage(pendingBefore ? "Retrying roster link…" : "Creating player…", true);
    try {
      if (!pendingRef.current) {
        const playerRef = db.collection("players").doc();
        await playerRef.set({
          firstName,
          lastName,
          coachUID: user.uid,
          coachDocId: coachDoc.id,
          registered: false,
          signupCode: makeCode(),
          signupCodeVersion: 2,
          ...staffPlayerProfileFields(profile),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        setPending({ id: playerRef.id, uid: user.uid, coachId: coachDoc.id });
      }
      const pending = pendingRef.current!;
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error("The signed-in account changed. Sign back in to finish the roster link.");
      }
      // The player exists before membership changes. A transaction makes a
      // repeated link idempotent, including a retry after a lost acknowledgement.
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(coachDoc.ref);
        const coach: any = snapshot.data() || {};
        if (!snapshot.exists || coach.userUID !== user.uid) throw new Error("The coach profile could not be verified.");
        const members: string[] = Array.isArray(coach.members) ? coach.members : [];
        if (!members.includes(pending.id)) {
          transaction.update(coachDoc.ref, { members: [...members, pending.id], numberMembers: members.length + 1 });
        }
      });
      setPending(null);
      if (firstNameRef.current) firstNameRef.current.value = "";
      if (lastNameRef.current) lastNameRef.current.value = "";
      setProfile(emptyStaffPlayerProfile());
      dialogRef.current?.close();
      await loadRoster();
      if (mounted.current && auth.currentUser?.uid === user.uid) onChanged?.();
    } catch (error: any) {
      setMessage(
        pendingRef.current
          ? "Player created, but the roster link could not be saved. Keep this page open and tap Retry Roster Link."
          : error.message || "The player could not be created.",
      );
    } finally {
      setCreateBusy(false);
    }
  }

  // Roster attachment by code runs in the admission service: the coach never
  // queries other athletes' profiles, and only post-lockdown codes are accepted.
  async function addExisting() {
    if (clubRef.current) return setMessage("Ask your organization manager to move an existing club player into this team.");
    const user = auth.currentUser;
    const code = codeRef.current?.value.trim().toUpperCase() ?? "";
    if (!code) return setMessage("Enter the player's code.");
    const coachDoc = coachDocRef.current;
    if (!user || !coachDoc || coachDoc.data().userUID !== user.uid) {
      return setMessage("Please sign in again with your coach account.");
    }
    setAddBusy(true);
    setMessage("Adding player…", true);
    try {
      await cloud.httpsCallable("attachPlayerByCode")({ code });
      if (!mounted.current || auth.currentUser?.uid !== user.uid) return;
      if (codeRef.current) codeRef.current.value = "";
      dialogRef.current?.close();
      await loadRoster();
      onChanged?.();
    } catch (error: any) {
      setMessage(error.message || "The player could not be added.");
    } finally {
      setAddBusy(false);
    }
  }

  let gridContent: ReactNode;
  if (gridMode.kind === "loading") {
    gridContent = (
      <div className="portal-loading">
        <span className="spinner" />
        <p>Loading your roster…</p>
      </div>
    );
  } else if (gridMode.kind === "error") {
    gridContent = (
      <div className="error-card">
        <span className="material-symbols-outlined">error</span>
        <h3>Roster unavailable</h3>
        <p>{gridMode.message}</p>
      </div>
    );
  } else {
    const shown = filterPlayers(players, searchTerm);
    if (!shown.length) {
      gridContent = (
        <div className="empty-card">
          <span className="material-symbols-outlined">group_add</span>
          <h3>{players.length ? "No matching athletes" : "No players yet"}</h3>
          <p>{players.length ? "Try another name or player code." : "Add the first athlete to begin collecting results."}</p>
        </div>
      );
    } else {
      gridContent = shown.map(player => {
        const registered = isRegistered(player);
        return (
          <button
            key={player.id}
            className="roster-player"
            type="button"
            data-player={player.id}
            onClick={() => openPlayer(player.id)}
          >
            <span className="player-avatar">{initials(player)}</span>
            <span className="player-copy">
              <strong>{fullName(player)}</strong>
              <span className="player-meta">
                <span className={`status-chip ${registered ? "active" : "pending"}`}>
                  {registered ? "Active" : "Invite pending"}
                </span>
                {registered ? null : <span>Code {player.signupCode || player.code || "—"}</span>}
              </span>
            </span>
            <span className="player-chevron material-symbols-outlined">chevron_right</span>
          </button>
        );
      });
    }
  }

  return (
    <div className={managementOnly ? "insights-roster-management" : "pt-pose portal-body roster-body"}>
      {!managementOnly && <header className="portal-header">
        <Link className="quiet-button" to="/feed">Community feed</Link>
        <Link
          className="portal-brand"
          to="/roster?userType=coach"
          aria-label="PoseTek roster"
          onClick={() => {
            // Legacy brand link full-reloaded coachesview.html, refetching the
            // roster; self-navigation in the SPA must refetch too. Skipped in
            // preview mode (no signed-in user to load for).
            if (auth.currentUser) loadRoster().catch(showError);
          }}
        >
          <span className="portal-brand-mark">P</span>
          <span>POSETEK</span>
        </Link>
        <Link className="quiet-button" to={club ? `/dashboard?team=${encodeURIComponent(clubTeamId)}` : "/dashboard"} style={{ marginLeft: "auto" }}>
          <span className="material-symbols-outlined">dashboard</span>
          <span>Dashboard</span>
        </Link>
        <button className="quiet-button" id="signOutButton" type="button" onClick={handleSignOut}>
          <span className="material-symbols-outlined">logout</span>
          <span>Sign Out</span>
        </button>
      </header>}

      {!managementOnly && <main className="roster-shell">
        <section className="roster-heading">
          <div>
            <p className="eyebrow" id="organizationName">{orgLabel}</p>
            <h1>Roster</h1>{club && <Link className="quiet-button" to="/organization">Organization and teams</Link>}
            <p id="rosterSummary">{rendered ? summaryText(players) : "Loading athletes…"}</p>
          </div>
          <button
            className="icon-button"
            id="refreshButton"
            type="button"
            aria-label="Refresh roster"
            onClick={() => loadRoster().catch(showError)}
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </section>

        {club && <label style={{ display: "grid", gap: 8, marginBottom: 20 }}>Team<select aria-label="Selected team" value={clubTeamId} onChange={event => { const id = event.target.value; navigate(`/roster?team=${encodeURIComponent(id)}`); void loadRoster(id).catch(showError); }}>{club.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
        <label className="search-field" id="searchWrap" hidden={!rendered || players.length <= 6}>
          <span className="material-symbols-outlined">search</span>
          <input
            id="playerSearch"
            type="search"
            placeholder="Search athletes"
            autoComplete="off"
            value={searchTerm}
            onChange={event => handleSearch(event.target.value)}
          />
        </label>

        <section className="roster-list" id="playersGrid" aria-live="polite">
          {gridContent}
        </section>

        <button className="primary-cta roster-add" id="addPlayerButton" type="button" onClick={openDialog}>
          <span className="material-symbols-outlined">person_add</span>Add Player
        </button>
      </main>}
      {managementOnly && <><button className="quiet-button" type="button" disabled={gridMode.kind !== "list"} onClick={openDialog}>Add player</button>{gridMode.kind === "error" && <p role="alert">{gridMode.message}</p>}</>}

      <dialog className="portal-dialog" id="addPlayerDialog" ref={dialogRef}>
        <form method="dialog" className="dialog-card" id="dialogShell">
          <header>
            <div>
              <p className="eyebrow">Roster</p>
              <h2>Add a player</h2>
            </div>
            <button className="icon-button" value="cancel" aria-label="Close">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="segmented-control" role="tablist">
            <button
              type="button"
              className={addTab === "new" ? "active" : ""}
              data-add-tab="new"
              onClick={() => switchTab("new")}
            >
              New player
            </button>
            {!club && <button
              type="button"
              className={addTab === "existing" ? "active" : ""}
              data-add-tab="existing"
              onClick={() => switchTab("existing")}
            >
              Player code
            </button>}
          </div>
          <section data-add-panel="new" hidden={addTab !== "new"}>
            <label>
              First name
              <input id="newFirstName" maxLength={80} autoComplete="off" ref={firstNameRef} disabled={Boolean(pendingPlayer)} />
            </label>
            <label>
              Last name
              <input id="newLastName" maxLength={80} autoComplete="off" ref={lastNameRef} disabled={Boolean(pendingPlayer)} />
            </label>
            <StaffPlayerProfileFields value={profile} onChange={setProfile} disabled={Boolean(pendingPlayer)} />
            <button
              className="primary-cta"
              id="createPlayerButton"
              type="button"
              disabled={createBusy}
              onClick={createPlayer}
            >
              {pendingPlayer ? "Retry Roster Link" : "Create Player"}
            </button>
          </section>
          <section data-add-panel="existing" hidden={addTab !== "existing"}>
            <label>
              Player code
              <input id="existingPlayerCode" maxLength={20} placeholder="PLR123" autoComplete="off" ref={codeRef} />
            </label>
            <button
              className="primary-cta"
              id="addExistingButton"
              type="button"
              disabled={addBusy}
              onClick={addExisting}
            >
              Add to Roster
            </button>
          </section>
          <p className={`form-message${formMessage.success ? " success" : ""}`} id="formMessage" aria-live="polite">
            {formMessage.text}
          </p>
        </form>
      </dialog>
    </div>
  );
}
