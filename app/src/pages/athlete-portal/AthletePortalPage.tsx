// Port of profile.html + athlete-portal.js (shell, state machine, access modes)
// with the secondary views from athlete-mobile-pages.js rendered as components.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../../styles/pose-portal.css";
import { auth, cloud } from "../../lib/firebase";
import type { ProvisionalEstimate } from "../../lib/provisional-estimates";
import AthleteStats from "../../components/athlete-stats/AthleteStats";
import { DRILLS, drillByKey } from "./lib/drills";
import { allStatsReps, avatarInitials, fullName } from "./lib/metrics";
import { VIEW_LABELS } from "./lib/mobile";
import type { Access, PortalData } from "./lib/loaders";
import { loadAuthenticated, loadShared } from "./lib/loaders";
import { athleteRosterNavigation } from "./lib/navigation";
import { previewData } from "./lib/preview";
import DrillDashboard from "./views/DrillDashboard";
import SessionView from "./views/SessionView";
import BodyProfileView from "./views/BodyProfileView";
import AiCoachView from "./views/AiCoachView";
import TrainingView from "./views/TrainingView";
import LeaderboardsView from "./views/LeaderboardsView";
import { PortalLoading } from "./views/shared";
import type { PortalContext } from "./views/shared";
import PlayerExperience from "./player/PlayerExperience";

const NAV_ITEMS = [
  { view: "home", icon: "home", title: "Athlete Home", subtitle: "Skill chart and breakdown" },
  { view: "profile", icon: "accessibility_new", title: "Body Profile", subtitle: "Scan and measurements" },
  { view: "aiCoach", icon: "forum", title: "AI Coach", subtitle: "Ask about your performance" },
  { view: "drills", icon: "exercise", title: "Drill Results", subtitle: "Sessions, metrics, and video" },
  { view: "training", icon: "fitness_center", title: "Training", subtitle: "Plan, workouts, and history" },
  { view: "leaderboards", icon: "leaderboard", title: "Leaderboards", subtitle: "Team rankings and standards" },
];

// Legacy setUrl(): sync ?view= / ?drill= via history.replaceState.
function setUrl(view: string, drill: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  if (view === "drills") url.searchParams.set("drill", drill);
  else url.searchParams.delete("drill");
  url.searchParams.delete("session");
  url.searchParams.delete("rep");
  window.history.replaceState({}, "", url);
}

function allowedViews(access: Access | null): string[] {
  if (access === "shared") return ["home", "drills"];
  if (access === "manager" || access === "admin") return ["home", "drills", "profile", "training", "leaderboards"];
  return Object.keys(VIEW_LABELS);
}

export default function AthletePortalPage() {
  const navigate = useNavigate();
  // Legacy captured URLSearchParams once at script start.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const shareToken = params.get("share");

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<any>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [athlete, setAthlete] = useState<any>(null);
  const [reps, setReps] = useState<Record<string, any[]>>(() => Object.fromEntries(DRILLS.map(d => [d.key, []])));
  const [provisionalEstimates, setProvisionalEstimates] = useState<ProvisionalEstimate[]>([]);
  const [view, setView] = useState("home");
  const [viewEpoch, setViewEpoch] = useState(0);
  const [drill, setDrill] = useState("shooting");
  const [session, setSession] = useState<{ folder: string; repId: any } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);

  // Toast (legacy notify()).
  const [toastText, setToastText] = useState("");
  const [toastShown, setToastShown] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (text: string) => {
    setToastText(text);
    setToastShown(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShown(false), 2600);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Drawer (legacy openDrawer/closeDrawer, incl. body.drawer-open).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerShown, setDrawerShown] = useState(false);
  const [backdropHidden, setBackdropHidden] = useState(true);
  const openDrawer = () => {
    setBackdropHidden(false);
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);
  useEffect(() => {
    if (drawerOpen) {
      document.body.classList.add("drawer-open");
      const raf = requestAnimationFrame(() => setDrawerShown(true));
      return () => {
        cancelAnimationFrame(raf);
        document.body.classList.remove("drawer-open");
      };
    }
    setDrawerShown(false);
    const timer = setTimeout(() => setBackdropHidden(true), 230);
    return () => clearTimeout(timer);
  }, [drawerOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Legacy finishLoad().
  const finishLoad = (data: PortalData) => {
    document.title = `${fullName(data.athlete)} | PoseTek`;
    const requested = params.has("drill") ? "drills" : params.get("view") || "home";
    const allowed = allowedViews(data.access);
    const nextView = allowed.includes(requested) ? requested : "home";
    const drillParam = params.get("drill");
    const nextDrill = DRILLS.some(d => d.key === drillParam)
      ? (drillParam as string)
      : DRILLS.find(d => data.reps[d.key].length)?.key || "shooting";
    setAccess(data.access);
    setPlayerId(data.playerId);
    setAthlete(data.athlete);
    setReps(data.reps);
    setProvisionalEstimates(data.access === "shared" ? [] : data.provisionalEstimates || []);
    setView(nextView);
    setDrill(nextDrill);
    setSession(null);
    setPhase("ready");
  };

  useEffect(() => {
    document.title = "Athlete Profile | PoseTek";
    let cancelled = false;
    const fail = (error: any, accessOnFail: Access | null = null) => {
      console.error("[athlete portal]", error);
      if (cancelled) return;
      if (accessOnFail) setAccess(accessOnFail);
      setLoadError(error);
      setPhase("error");
    };
    if (params.get("preview") === "1") {
      finishLoad(previewData());
      return;
    }
    if (shareToken) {
      // Legacy set state.access = "shared" before the callable round-trips.
      setAccess("shared");
      loadShared(shareToken)
        .then(data => { if (!cancelled) finishLoad(data); })
        .catch(error => fail(error, "shared"));
      return () => { cancelled = true; };
    }
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (!user) {
        const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
        navigate(`/signin?returnTo=${returnTo}`, { replace: true });
        return;
      }
      loadAuthenticated(user, params.get("player"))
        .then(data => { if (!cancelled) finishLoad(data); })
        .catch(error => fail(error));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legacy chooseView() re-ran render() unconditionally, so re-selecting the
  // active drawer item rebuilt (and re-fetched) the view; the epoch key mirrors
  // that by remounting the secondary views on every selection.
  const chooseView = (requested: string) => {
    const allowed = allowedViews(access);
    const nextView = allowed.includes(requested) ? requested : "home";
    const nextDrill = nextView === "drills" && !drill ? "shooting" : drill;
    setViewEpoch(epoch => epoch + 1);
    setView(nextView);
    setDrill(nextDrill);
    setSession(null);
    setUrl(nextView, nextDrill);
    closeDrawer();
  };

  // Legacy drill-tab click.
  const chooseDrill = (key: string) => {
    setView("drills");
    setDrill(key);
    setSession(null);
    setUrl("drills", key);
  };

  // Legacy share button handler.
  const handleShare = async () => {
    setShareBusy(true);
    try {
      const result = await cloud.httpsCallable("createAthleteResultsShare")({ playerDocId: playerId });
      const url = new URL("profile.html", window.location.href);
      url.search = "";
      url.searchParams.set("share", (result.data as any).token);
      await navigator.clipboard.writeText(url.href);
      notify("Secure athlete profile link copied");
    } catch (error: any) {
      console.error("[share]", error);
      notify(error.message || "Could not create the link");
    } finally {
      setShareBusy(false);
    }
  };

  const statsReps = () => allStatsReps(reps);
  const ctx: PortalContext = useMemo(
    () => ({ access: (access || "athlete") as Access, playerId, athlete, notify, allStatsReps: statsReps, provisionalEstimates, allResultReps: () => Object.values(reps).flat() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access, playerId, athlete, reps, provisionalEstimates],
  );

  const activeDrill = drillByKey(drill);
  const rosterNavigation = athleteRosterNavigation(access, athlete, params.toString());

  if (phase === 'ready' && (access === 'athlete' || access === 'preview')) {
    return <PlayerExperience key={playerId} ctx={ctx} initialReps={reps} />;
  }

  return (
    <div className="pt-pose portal-body athlete-body">
      <header className="portal-header athlete-header">
        <button
          className="portal-menu-button"
          id="portalMenuButton"
          type="button"
          aria-label="Open athlete navigation"
          aria-expanded={drawerOpen ? "true" : "false"}
          aria-controls="portalDrawer"
          onClick={openDrawer}
        >
          <span className="portal-brand-mark">P</span>
          <span className="menu-lines" aria-hidden="true"><i /><i /><i /></span>
        </button>
        <a
          className="portal-brand portal-wordmark"
          id="brandLink"
          href="profile.html"
          onClick={event => { event.preventDefault(); chooseView("home"); }}
        >
          <span>POSETEK</span>
        </a>
        <div className="portal-current-view" id="currentViewLabel">{VIEW_LABELS[view] || "Athlete Home"}</div>
        <div className="portal-header-actions">
          <Link className="quiet-button" id="rosterLink" to={rosterNavigation.to} state={access === "admin" ? { adminRestore: true } : undefined} hidden={!access || !["coach", "manager", "admin"].includes(access)}>
            <span className="material-symbols-outlined">groups</span><span>{rosterNavigation.label}</span>
          </Link>
          <button
            className="quiet-button share-button"
            id="shareButton"
            type="button"
            hidden={access !== "coach"}
            disabled={shareBusy}
            onClick={handleShare}
          >
            <span className="material-symbols-outlined">ios_share</span><span>Share</span>
          </button>
        </div>
      </header>

      <div
        className={`portal-drawer-backdrop${drawerShown ? " open" : ""}`}
        id="portalDrawerBackdrop"
        hidden={backdropHidden}
        onClick={closeDrawer}
      />
      <aside
        className={`portal-drawer${drawerShown ? " open" : ""}`}
        id="portalDrawer"
        aria-hidden={drawerShown ? "false" : "true"}
        aria-label="Athlete navigation"
      >
        <header className="drawer-header">
          <div><span className="portal-brand-mark">P</span><strong>POSETEK</strong></div>
          <button className="icon-button" id="portalDrawerClose" type="button" aria-label="Close navigation" onClick={closeDrawer}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="drawer-athlete" id="drawerAthlete">
          {athlete ? (
            <>
              <span className="athlete-avatar">{avatarInitials(fullName(athlete))}</span>
              <div>
                <strong>{fullName(athlete)}</strong>
                <small>{access === "shared" ? "Shared results access" : access === "coach" ? "Coach view" : access === "manager" ? "Organization manager view" : access === "admin" ? "PoseTek admin view" : "Athlete portal"}</small>
              </div>
            </>
          ) : (
            <>
              <span className="athlete-avatar">A</span>
              <div><strong>Athlete</strong><small>Performance portal</small></div>
            </>
          )}
        </div>
        <nav className="drawer-navigation" id="drawerNavigation">
          {NAV_ITEMS.map(item => (
            <button
              key={item.view}
              type="button"
              data-view={item.view}
              className={item.view === view ? "active" : ""}
              hidden={!allowedViews(access).includes(item.view)}
              onClick={() => chooseView(item.view)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
            </button>
          ))}
        </nav>
        <footer className="drawer-footer">
          <span className="material-symbols-outlined">verified_user</span>
          <span>Secure athlete access</span>
        </footer>
      </aside>

      <main className="athlete-shell">
        <nav className="drill-tabs" id="drillTabs" aria-label="Drill results" hidden={!(phase === "ready" && view === "drills")}>
          {phase === "ready" && DRILLS.map(item => (
            <button
              key={item.key}
              className={`drill-tab${item.key === drill ? " active" : ""}`}
              type="button"
              data-drill={item.key}
              onClick={() => chooseDrill(item.key)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.short || item.label}
              <span className="count">{reps[item.key].length}</span>
            </button>
          ))}
        </nav>
        <section id="portalApp" aria-live="polite">
          {phase === "loading" && <PortalLoading message="Loading athlete profile…" />}
          {phase === "error" && (
            <div className="error-card">
              <span className="material-symbols-outlined">link_off</span>
              <h2>Profile unavailable</h2>
              <p>{loadError?.message || "This profile could not be opened."}</p>
              {access !== "shared" && <Link className="primary-cta" to="/signin">Sign In</Link>}
            </div>
          )}
          {phase === "ready" && view === "home" && (
            <div className="athlete-overview">
              <AthleteStats athlete={athlete} athleteName={fullName(athlete)} reps={statsReps()} provisionalEstimates={provisionalEstimates} estimateReps={Object.values(reps).flat()} />
            </div>
          )}
          {phase === "ready" && view === "drills" && (
            session ? (
              <SessionView
                drill={activeDrill}
                folder={session.folder}
                selectedId={session.repId}
                reps={reps[activeDrill.key]}
                access={(access || "athlete") as Access}
                playerId={playerId}
                shareToken={shareToken}
                onBack={() => setSession(null)}
                onSelectRep={repId => setSession({ folder: session.folder, repId })}
              />
            ) : (
              <DrillDashboard
                key={activeDrill.key}
                drill={activeDrill}
                reps={reps[activeDrill.key]}
                athlete={athlete}
                onOpenRep={(folder, repId) => setSession({ folder, repId })}
              />
            )
          )}
          {phase === "ready" && view === "profile" && <BodyProfileView key={viewEpoch} ctx={ctx} />}
          {phase === "ready" && view === "aiCoach" && <AiCoachView key={viewEpoch} ctx={ctx} />}
          {phase === "ready" && view === "training" && <TrainingView key={viewEpoch} ctx={ctx} />}
          {phase === "ready" && view === "leaderboards" && <LeaderboardsView key={viewEpoch} ctx={ctx} />}
        </section>
      </main>

      <div className={`toast${toastShown ? " show" : ""}`} id="toast" role="status" aria-live="polite">{toastText}</div>
    </div>
  );
}
