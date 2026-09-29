/** Recovered from deployment 6aa9b6f0d8faf6177db8fd97. See PROVENANCE.md. */
import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { callSocial } from "./api";
import { formatMeasurement, mergeActivities, initials, formatDate } from "./model";
import PlayerShell, { playerTabPath } from "../athlete-portal/player/PlayerShell";
import { communityPanel, communityPanelPath, communityPersonPath } from "./navigation";
import { coachWorkspacePath } from "../../lib/coach-navigation";
import { loadAccountAccess } from "../../lib/account-access";
import "./feed.css";
import "../../styles/pose-portal.css";
import "./feed-cascade.css";

var sampleContext = {
  uid: `sample`,
  playerId: `sample`,
  name: `Alex Morgan`,
  organizationId: `sample`,
  organizationName: `Vacaville United Soccer Club`,
  teamId: `sample-team`,
  teamName: `Boys · Coach Niall`,
  staff: false,
  admin: false,
  enabled: true,
  preferences: {
    audience: `organization`,
    automatic: true,
    videos: true
  }
};
var sampleActivityDefaults = {
  playerId: `example`,
  authorUid: null,
  teamName: `Boys · Coach Niall`,
  mine: false,
  audience: `organization`,
  hidden: false,
  liked: false,
  comments: 0,
  partial: false,
  canViewVideo: false,
  score: null
};
var sampleActivities = [
  {
    ...sampleActivityDefaults,
    id: `sample-1`,
    authorName: `Jamie Rivera`,
    title: `Shooting session`,
    subtitle: `12 measured reps`,
    kind: `session`,
    occurredAt: Date.now() - 3600000,
    metrics: [
      {
        label: `Reps`,
        value: 12,
        unit: ``
      },
      {
        label: `Best`,
        value: 58.4,
        unit: `mph`
      },
      {
        label: `Average`,
        value: 53.2,
        unit: `mph`
      }
    ],
    chart: [
      43,
      48,
      46,
      51,
      50,
      55,
      53,
      51,
      56,
      54,
      58.4,
      57
    ],
    drill: `shooting`,
    repCount: 12,
    kudos: 8
  },
  {
    ...sampleActivityDefaults,
    id: `sample-2`,
    authorName: `Sam Chen`,
    title: `Build strength. Move faster.`,
    subtitle: `Split squat · Calf raises · Lateral bounds`,
    kind: `workout`,
    occurredAt: Date.now() - 7200000,
    metrics: [
      {
        label: `Drills`,
        value: 3,
        unit: ``
      },
      {
        label: `Sets`,
        value: 9,
        unit: ``
      },
      {
        label: `Active time`,
        value: 24,
        unit: `min`
      }
    ],
    chart: [],
    drill: null,
    repCount: 0,
    kudos: 5
  },
  {
    ...sampleActivityDefaults,
    id: `sample-3`,
    authorName: `Taylor Brooks`,
    teamName: `Girls · Coach Niall`,
    title: `Vertical jump session`,
    subtitle: `6 measured reps`,
    kind: `session`,
    occurredAt: Date.now() - 86400000,
    metrics: [
      {
        label: `Reps`,
        value: 6,
        unit: ``
      },
      {
        label: `Best`,
        value: 22.8,
        unit: `in`
      },
      {
        label: `Average`,
        value: 21.4,
        unit: `in`
      }
    ],
    chart: [
      20,
      21,
      20.8,
      22,
      22.8,
      21.9
    ],
    drill: `jump`,
    repCount: 6,
    kudos: 11
  }
];
var feedScopes = [
  [`all`, `All activity`],
  [`team`, `My team`],
  [`organization`, `My organization`],
  [`friends`, `Friends`],
  [`mine`, `My activity`]
];
var audienceLabels = {
  organization: `Organization + friends`,
  team: `Team only`,
  friends: `Friends only`,
  private: `Only me`
};
function Icon({ name }) {
  return <span className={`material-symbols-outlined`} aria-hidden={`true`}>
    {name}
  </span>;
}
function FeedPage({ embedded = false, organizationId: workspaceOrganizationId, onNavigatePlayer } = {}) {
  let location = useLocation();
  let navigate = useNavigate();
  let query = new URLSearchParams(location.search);
  let preview = query.get(`preview`) === `1`;
  let viewAsPlayerId = query.get(`viewAsPlayerId`) || void 0;
  let athletePreview = !!viewAsPlayerId;
  let organizationId = workspaceOrganizationId || query.get(`organizationId`) || void 0;
  let linkedPlayer = query.get(`connect`) || void 0;
  let activityId = query.get(`activity`) || void 0;
  let [context, setContext] = React.useState(preview ? sampleContext : null);
  let [status, setStatus] = React.useState(preview ? `ready` : `loading`);
  let [error, setError] = React.useState(``);
  let [scope, setScope] = React.useState(`all`);
  let requestedPanel = communityPanel(location.search);
  let panel = requestedPanel === `moderation` && !context?.admin ? `feed` : requestedPanel;
  let setPanel = next => navigate(communityPanelPath(location.pathname, location.search, next));
  let [activities, setActivities] = React.useState(preview ? sampleActivities : []);
  let [cursor, setCursor] = React.useState(null);
  let [loading, setLoading] = React.useState(false);
  let authRequest = React.useRef(0);
  let feedRequest = React.useRef(0);
  let authReturnTo = React.useRef(location.pathname + location.search);
  authReturnTo.current = location.pathname + location.search;
  React.useEffect(() => {
    if (!embedded) document.title = `Community | PoseTek`;
  }, [embedded]);
  React.useEffect(() => {
    if (!embedded && !preview && context?.staff && !context.admin && !context.playerId && !athletePreview) {
      navigate(coachWorkspacePath(location.search, { view: `community`, orgId: context.organizationId || undefined, organizationId: undefined }), { replace: true });
    }
  }, [embedded, preview, context, athletePreview, navigate, location.search]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  /* oxlint-disable react-hooks/exhaustive-deps -- These refs are request counters, not DOM nodes; cleanup must invalidate their latest values. */
  React.useEffect(() => {
    if (preview)
      return;
    let t = true;
    let r = auth.onAuthStateChanged(r => {
      let i = ++authRequest.current;
      ++feedRequest.current;
      setActivities([]);
      setContext(null);
      setError(``);
      setStatus(`loading`);
      if (!r) {
        navigate(`/signin?returnTo=` + encodeURIComponent(authReturnTo.current), {
          replace: true
        });
        return;
      }
      callSocial(`getSocialContext`, {
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      }).then(e => {
        if (t && authRequest.current === i) {
          setContext(e);
          setStatus(`ready`);
        }
      }).catch(async e => {
        // Independent coaches have no social organization. Resolve their existing
        // account before showing the player feed's error chrome on a legacy link.
        if (!embedded && !athletePreview && t && authRequest.current === i) {
          try {
            const access = await loadAccountAccess(r, () => t && authRequest.current === i);
            if (t && authRequest.current === i && access.kind === `active` && access.role === `independent`) {
              navigate(coachWorkspacePath(authReturnTo.current.split(`?`)[1] || ``, { view: `community` }), { replace: true });
              return;
            }
          } catch { /* Keep the original access error if the account cannot be resolved. */ }
        }
        if (t && authRequest.current === i) {
          setError(e.message);
          setStatus(`error`);
        }
      });
    });
    return () => {
      t = false;
      ++authRequest.current;
      ++feedRequest.current;
      r();
    };
  }, [
    preview,
    embedded,
    organizationId,
    viewAsPlayerId,
    navigate,
    location.pathname
  ]); /* oxlint-enable react/set-state-in-effect */
  /* oxlint-enable react-hooks/exhaustive-deps */
  let loadFeed = React.useCallback(async (e = null) => {
    if (preview) {
      setActivities(sampleActivities.filter(e => scope !== `mine` || e.mine));
      return;
    }
    let t = ++feedRequest.current;
    setLoading(true);
    setError(``);
    try {
      let n = activityId ? {
        items: [await callSocial(`getSocialActivity`, {
          id: activityId,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        })],
        cursor: null
      } : await callSocial(`getSocialFeed`, {
        scope: scope,
        cursor: e,
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      });
      if (t === feedRequest.current) {
        setActivities(t => e ? mergeActivities(t, n.items) : n.items);
        setCursor(n.cursor);
      }
    }
    catch (e) {
      if (t === feedRequest.current) {
        setError(e.message);
      }
    }
    finally {
      if (t === feedRequest.current) {
        setLoading(false);
      }
    }
  }, [
    scope,
    preview,
    organizationId,
    activityId,
    viewAsPlayerId
  ]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  /* oxlint-disable react-hooks/exhaustive-deps -- These refs are request counters, not DOM nodes; cleanup must invalidate their latest values. */
  React.useEffect(() => {
    if (context) {
      setActivities([]);
      setCursor(null);
      loadFeed();
    }
    return () => {
      ++feedRequest.current;
    };
  }, [context, loadFeed]); /* oxlint-enable react/set-state-in-effect */
  /* oxlint-enable react-hooks/exhaustive-deps */
  let feedUrl = location.pathname + (location.search || ``);
  let athleteUrl = e => athletePreview ? feedUrl : playerTabPath(e, location.search, location.pathname);
  let staffOnly = !!context && (context.staff || context.admin) && !context.playerId;
  let sharedPlayerShell = !embedded && !athletePreview && !staffOnly;
  let sharedChrome = sharedPlayerShell || embedded;
  let Content = sharedChrome ? `section` : `main`;
  let tabs = staffOnly ? [
    [
      feedUrl,
      `home`,
      `Home`
    ],
    [
      `/organization`,
      `groups`,
      `Club`
    ],
    [
      context?.admin ? `/admin` : `/roster`,
      `dashboard`,
      context?.admin ? `Admin` : `Roster`
    ]
  ] : [
    [
      feedUrl,
      `home`,
      `Home`
    ],
    [
      athleteUrl(`drills`),
      `sports_soccer`,
      `Drills`
    ],
    [
      athleteUrl(`training`),
      `fitness_center`,
      `Training`
    ],
    [
      athleteUrl(`leaderboards`),
      `leaderboard`,
      `Leaderboards`
    ],
    [
      athleteUrl(`home`),
      `person`,
      `You`
    ]
  ];
  let content = <div className={embedded ? `social-app social-embedded social-coach` : sharedPlayerShell ? `social-app social-embedded` : `pt-pose social-app`}>
    {!sharedChrome && <header className={`social-header`}>
      <Link className={`social-brand`} to={feedUrl}>
        {`POSETEK`}
        <span>
          {`●`}
        </span>
      </Link>
      <span className={`social-header-label`}>
        {`THE WORK. TOGETHER.`}
      </span>
      <div className={`social-header-actions`}>
        <button aria-label={`Find people`} onClick={() => setPanel(`people`)}>
          <Icon name={`person_add`} />
        </button>
        <button aria-label={`Sharing settings`} onClick={() => setPanel(`settings`)}>
          <Icon name={`tune`} />
        </button>
        <Link className={`social-avatar small`} aria-label={`Your profile`} to={athleteUrl(`home`)}>
          {initials(context?.name || `You`)}
        </Link>
      </div>
    </header>}
    <div className={`social-layout`}>
      {!sharedChrome && <aside className={`social-sidebar`}>
        <div className={`social-club-mark`}>
          <Icon name={`sports_soccer`} />
        </div>
        <p className={`social-eyebrow`}>
          {`Your community`}
        </p>
        <h2>
          {context?.organizationName || `PoseTek athletes`}
        </h2>
        <p>
          {context?.teamName || `A little stronger, together.`}
        </p>
        <nav aria-label={`Community`}>
          <button aria-current={panel === `feed` ? `page` : void 0} onClick={() => setPanel(`feed`)}>
            <Icon name={`home`} />
            {`Activity feed`}
          </button>
          <button aria-current={panel === `people` ? `page` : void 0} onClick={() => setPanel(`people`)}>
            <Icon name={`group`} />
            {`People & friends`}
          </button>
          <button aria-current={panel === `settings` ? `page` : void 0} onClick={() => setPanel(`settings`)}>
            <Icon name={`tune`} />
            {`Sharing settings`}
          </button>
          {context?.admin && <button onClick={() => setPanel(`moderation`)}>
            <Icon name={`flag`} />
            {`Reports`}
          </button>}
        </nav>
        <Link className={`social-coach-link`} to={staffOnly ? `/organization` : athleteUrl(`aiCoach`)}>
          <Icon name={`auto_awesome`} />
          <span>
            {`Make your next rep count.`}
            <strong>
              {staffOnly ? `Open your organization ↗` : `Ask your AI Coach ↗`}
            </strong>
          </span>
        </Link>
        {context?.staff && <Link to={`/organization`}>
          {`Back to organization →`}
        </Link>}
        {!preview && <button className={`social-signout`} onClick={() => void auth.signOut()}>
          {`Sign out`}
        </button>}
      </aside>}
      <Content className={`social-main`}>
        {sharedChrome && <nav className="social-toolbar" aria-label="Community sections">
          <button aria-current={panel === `feed` ? `page` : undefined} onClick={() => setPanel(`feed`)}><Icon name="dynamic_feed" /><span>Activity</span></button>
          <button aria-current={panel === `people` ? `page` : undefined} onClick={() => setPanel(`people`)}><Icon name="person_add" /><span>Find people</span></button>
          <button aria-current={panel === `settings` ? `page` : undefined} onClick={() => setPanel(`settings`)}><Icon name="tune" /><span>Sharing settings</span></button>
          {context?.admin && <button aria-current={panel === `moderation` ? `page` : undefined} onClick={() => setPanel(`moderation`)}><Icon name="flag" /><span>Reports</span></button>}
        </nav>}
        {context?.adminViewer && <AdminDirectory organizationId={context.organizationId || ``} selectedPlayer={viewAsPlayerId || ``} onSwitch={() => {
          ++feedRequest.current;
          setActivities([]);
          setCursor(null);
          setScope(`all`);
        }} />}
        {athletePreview && <p className={`social-notice`} role={`status`}>
          {`Read-only athlete preview · `}
          {context?.name || `Loading athlete`}
          {` · Account actions are disabled. `}
          <Link to={`/admin`}>
            {`Back to admin`}
          </Link>
        </p>}
        {preview && <p className={`social-notice`}>
          {`Design preview · sample activity · no account changes`}
        </p>}
        {status === `loading` && <div className={`social-empty`} role={`status`}>
          {`Loading your community…`}
        </div>}
        {error && <div className={`social-error`} role={`alert`}>
          {error}
          <button onClick={() => status === `error` ? window.location.reload() : void loadFeed()}>
            {`Try again`}
          </button>
        </div>}
        {context && <>
          {panel === `feed` && <>
            <div className={`social-heading`}>
              <div>
                {!embedded && <p className={`social-eyebrow`}>
                  {`Show up. Put in the work.`}
                </p>}
                {embedded ? <h2>Community activity</h2> : <h1>Better together<span>.</span></h1>}
                <p>
                  {`The latest from your training community.`}
                </p>
              </div>
              <button aria-label={`Refresh activity`} disabled={loading} onClick={() => void loadFeed()}>
                <Icon name={`refresh`} />
              </button>
            </div>
            {!sharedChrome && <div className={`social-mobile-links`}>
              <button onClick={() => setPanel(`people`)}>
                <Icon name={`group`} />
                {`Find friends`}
              </button>
              <Link to={staffOnly ? `/organization` : athleteUrl(`aiCoach`)}>
                <Icon name={`auto_awesome`} />
                {staffOnly ? `Organization` : `AI Coach`}
              </Link>
            </div>}
            <nav className={`social-filters`} aria-label={`Activity audience`}>
              {feedScopes.map(([e, t]) => <button aria-pressed={e === scope} onClick={() => {
                setScope(e);
                if (activityId) {
                  navigate(communityPanelPath(location.pathname, location.search, `feed`));
                }
              }} key={e}>
                {t}
              </button>)}
            </nav>
            <div className={`social-feed`} aria-busy={loading}>
              {activities.map(e => <ActivityCard activity={e} organizationId={organizationId} preview={preview} onChange={e => setActivities(t => t.map(t => t.id === e.id ? e : t))} onPerson={e => {
                if (embedded && onNavigatePlayer) onNavigatePlayer(e);
                else navigate(communityPersonPath(location.pathname, location.search, e));
              }} key={`${context.uid}:${e.id}`} />)}
            </div>
            {loading && <div className={`social-skeleton`} role={`status`}>
              {`Loading activity…`}
            </div>}
            {!loading && !activities.length && !error && <div className={`social-empty`}>
              <Icon name={`sports_soccer`} />
              <h2>
                {`Your next chapter starts here.`}
              </h2>
              <p>
                {scope === `team` && !context.teamId && !context.staff ? `You are not assigned to a team yet. Your organization feed is still available.` : scope === `friends` ? `Connect with a friend to see their training here.` : `Finished workouts and measured sessions will appear here as your community trains.`}
              </p>
              <button onClick={() => setPanel(`people`)}>
                {`Meet your community`}
              </button>
            </div>}
            {cursor && <button className={`social-load`} disabled={loading} onClick={() => void loadFeed(cursor)}>
              {`Load more activity`}
            </button>}
            {!!activities.length && !cursor && !loading && <p className={`social-end`}>
              {`You’re all caught up. Time to put in the work.`}
            </p>}
          </>}
          {panel === `people` && <People context={context} linkedPlayer={linkedPlayer} preview={preview} organizationId={organizationId} key={context.uid + (organizationId || ``) + (linkedPlayer || ``)} />}
          {panel === `settings` && <SharingSettings context={context} preview={preview} organizationId={organizationId} onSave={e => setContext({
            ...context,
            preferences: e
          })} key={`${context.uid}:${organizationId || ``}`} />}
          {panel === `moderation` && context.admin && <Moderation organizationId={organizationId} />}
        </>}
      </Content>
      {!sharedChrome && <aside className={`social-right`}>
        <p className={`social-eyebrow`}>
          {`Small steps. Real progress.`}
        </p>
        <h2>
          {`Your work inspires someone else.`}
        </h2>
        <p>
          {`A session. A new best. One more rep. Show your team what you’re working on.`}
        </p>
        <Link className={`social-primary`} to={staffOnly ? `/organization` : athleteUrl(`training`)}>
          {staffOnly ? `Open your organization` : `Open your training`}
          {` `}
          <span>
            {`↗`}
          </span>
        </Link>
        <div className={`social-right-note`}>
          <Icon name={`verified_user`} />
          <p>
            {`Your activity stays with your chosen audience. You’re in control of what you share.`}
          </p>
          <button onClick={() => setPanel(`settings`)}>
            {`Manage sharing →`}
          </button>
        </div>
      </aside>}
    </div>
    {!sharedChrome && <nav className={`social-bottom`} aria-label={staffOnly ? `Staff navigation` : `Athlete preview navigation`}>
      {tabs.map(([e, t, n]) => <Link to={e} aria-current={n === `Home` ? `page` : void 0} onClick={() => {
        if (n === `Home`) {
          setPanel(`feed`);
        }
      }} key={n}>
        <Icon name={t} />
        <span>
          {n}
        </span>
      </Link>)}
    </nav>}
  </div>;
  return sharedPlayerShell ? <PlayerShell activeView="feed" search={location.search} pathname={location.pathname} className="player-community" navigationDisabled={!context} onSignOut={preview ? undefined : () => { void auth.signOut(); }} onNavigate={view => {
    if (view === `feed`) setPanel(`feed`);
    else navigate(athleteUrl(view));
    window.scrollTo({ top: 0 });
  }}>{content}</PlayerShell> : content;
}
function ActivityCard({ activity, organizationId, preview, onChange, onPerson }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [busy, setBusy] = React.useState(false);
  let [error, setError] = React.useState(``);
  let [commentsOpen, setCommentsOpen] = React.useState(false);
  let [videoUrl, setVideoUrl] = React.useState(``);
  let [videoNotice, setVideoNotice] = React.useState(``);
  let [reportReason, setReportReason] = React.useState(``);
  let [notice, setNotice] = React.useState(``);
  let mounted = React.useRef(true);
  let viewerUid = auth.currentUser?.uid;
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  let runAction = async (e) => {
    if (!busy) {
      if (preview || viewAsPlayerId) {
        setNotice(viewAsPlayerId ? `Athlete previews are read-only.` : `Sample preview. Sign in to interact with real activity.`);
        return;
      }
      setBusy(true);
      setError(``);
      try {
        await e();
      }
      catch (e) {
        if (mounted.current) {
          setError(e.message);
        }
      }
      finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    }
  };
  let refreshActivity = async () => {
    let n = await callSocial(`getSocialActivity`, {
      id: activity.id,
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    if (mounted.current && auth.currentUser?.uid === viewerUid) {
      onChange(n);
    }
  };
  let chartMaximum = Math.max(...activity.chart, 1);
  return <article className={`social-card`}>
    <div className={`social-card-author`}>
      <button className={`social-avatar`} onClick={() => onPerson(activity.playerId)} aria-label={`View ${activity.authorName}`}>
        {initials(activity.authorName)}
      </button>
      <div>
        <button className={`social-author-name`} onClick={() => onPerson(activity.playerId)}>
          {activity.authorName}
        </button>
        <p>
          {activity.teamName || `PoseTek athlete`}
        </p>
        <time dateTime={new Date(activity.occurredAt).toISOString()}>
          {formatDate(activity.occurredAt)}
        </time>
      </div>
      <span className={`social-activity-icon`}>
        <Icon name={activity.kind === `workout` ? `fitness_center` : `sports_soccer`} />
      </span>
    </div>
    <h2>
      {activity.title}
    </h2>
    <p className={`social-card-subtitle`}>
      {activity.subtitle}
      {activity.partial ? ` · Finished with partial work` : ``}
    </p>
    <div className={`social-metrics`}>
      {activity.metrics.map(e => <div key={e.label}>
        <span>
          {e.label}
        </span>
        <strong>
          {formatMeasurement(e.value, e.unit)}
        </strong>
      </div>)}
    </div>
    {activity.score !== null && <div className={`social-score`}>
      <Icon name={`insights`} />
      <span>
        <strong>
          {Math.round(activity.score)}
          {` benchmark rating`}
        </strong>
        {` · 100 = reference median for this metric`}
      </span>
    </div>}
    {videoUrl ? <video className={`social-video`} src={videoUrl} controls={true} playsInline={true} preload={`metadata`} onError={() => {
      setVideoUrl(``);
      setVideoNotice(`Video link expired or unavailable. Tap Watch saved rep to retry.`);
    }} /> : activity.chart.length > 0 ? <div className={`social-chart`} role={`img`} aria-label={`Last ${activity.chart.length} rep results: ${activity.chart.map(e => e.toFixed(1)).join(`, `)}`}>
      <div className={`social-chart-heading`}>
        <span>
          {`EVERY REP COUNTS`}
        </span>
        <Icon name={`trending_up`} />
      </div>
      <div className={`social-bars`}>
        {activity.chart.map((e, t) => <span style={{
          height: `${Math.max(8, e / chartMaximum * 100)}%`
        }} key={t} />)}
      </div>
      <div className={`social-chart-footer`}>
        <span>
          {`Rep by rep`}
        </span>
        <span>
          {activity.chart.length}
          {` recorded results`}
        </span>
      </div>
    </div> : <div className={`social-workout-art`}>
      <Icon name={`fitness_center`} />
      <span>
        {`WORK PUT IN.`}
      </span>
      <small>
        {`One session closer.`}
      </small>
    </div>}
    {activity.canViewVideo && !videoUrl && <button className={`social-watch`} disabled={busy} onClick={() => {
      if (!preview) {
        setBusy(true);
        setError(``);
        (async () => {
          let n = await callSocial(`getSocialMedia`, {
            id: activity.id,
            organizationId: organizationId,
            viewAsPlayerId: viewAsPlayerId
          });
          if (mounted.current && auth.currentUser?.uid === viewerUid) {
            setVideoUrl(n.url || ``);
            setVideoNotice(n.url ? `` : `No saved video is available for this rep.`);
          }
        })().catch(e => setError(e.message)).finally(() => setBusy(false));
      }
    }}>
      <Icon name={`play_circle`} />
      {`Watch saved rep`}
    </button>}
    {videoNotice && <p role={`status`}>
      {videoNotice}
    </p>}
    <div className={`social-engagement`}>
      <span className={`social-kudos-dot`}>
        {`↗`}
      </span>
      <span>
        {activity.kudos ? `${activity.kudos} gave kudos` : `Be the first to give kudos`}
      </span>
      <span>
        {activity.comments ? `${activity.comments} comments` : ``}
      </span>
    </div>
    <div className={`social-card-actions`}>
      <button disabled={busy || !!viewAsPlayerId} aria-pressed={activity.liked} onClick={() => void runAction(async () => {
        await callSocial(`setSocialKudos`, {
          id: activity.id,
          liked: !activity.liked,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        });
        await refreshActivity();
      })}>
        <Icon name={`thumb_up`} />
        {`Kudos`}
      </button>
      <button aria-expanded={commentsOpen} onClick={() => setCommentsOpen(!commentsOpen)}>
        <Icon name={`chat_bubble`} />
        {`Comment`}
      </button>
      <button onClick={() => void runAction(async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/feed?activity=${encodeURIComponent(activity.id)}`);
        setNotice(`Activity link copied. Your sharing settings still apply.`);
      })}>
        <Icon name={`ios_share`} />
        {`Share`}
      </button>
    </div>
    <details className={`social-card-options`}>
      <summary>
        {`Activity options`}
      </summary>
      {activity.mine ? <>
        <label>
          {`Audience`}
          <select disabled={busy || !!viewAsPlayerId} value={activity.audience} onChange={n => void runAction(async () => {
            await callSocial(`setSocialVisibility`, {
              id: activity.id,
              audience: n.target.value,
              hidden: activity.hidden,
              organizationId: organizationId,
              viewAsPlayerId: viewAsPlayerId
            });
            await refreshActivity();
          })}>
            {Object.entries(audienceLabels).map(([e, t]) => <option value={e} key={e}>
              {t}
            </option>)}
          </select>
        </label>
        <button disabled={busy || !!viewAsPlayerId} onClick={() => void runAction(async () => {
          await callSocial(`setSocialVisibility`, {
            id: activity.id,
            audience: activity.audience,
            hidden: !activity.hidden,
            organizationId: organizationId,
            viewAsPlayerId: viewAsPlayerId
          });
          await refreshActivity();
        })}>
          {activity.hidden ? `Show activity again` : `Hide activity from others`}
        </button>
      </> : <form onSubmit={n => {
        n.preventDefault();
        runAction(async () => {
          await callSocial(`reportSocialActivity`, {
            id: activity.id,
            reason: reportReason,
            organizationId: organizationId,
            viewAsPlayerId: viewAsPlayerId
          });
          setReportReason(``);
          setNotice(`Report sent to PoseTek.`);
        });
      }}>
        <label>
          {`Report a problem`}
          <textarea required={true} maxLength={500} value={reportReason} onChange={e => setReportReason(e.target.value)} />
        </label>
        <button disabled={busy || !!viewAsPlayerId}>
          {`Send report`}
        </button>
      </form>}
    </details>
    {commentsOpen && <Comments activity={activity} preview={preview} organizationId={organizationId} onChanged={refreshActivity} />}
    {notice && <p className={`social-notice`} role={`status`}>
      {notice}
    </p>}
    {error && <p className={`social-error`} role={`alert`}>
      {error}
    </p>}
  </article>;
}
function Comments({ activity, organizationId, preview, onChanged }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [comments, setComments] = React.useState([]);
  let [cursor, setCursor] = React.useState(null);
  let [text, setText] = React.useState(``);
  let [error, setError] = React.useState(``);
  let [busy, setBusy] = React.useState(false);
  let pendingCommentId = React.useRef(``);
  let mounted = React.useRef(true);
  let loadComments = React.useCallback(async (r = null) => {
    if (preview)
      return;
    let i = await callSocial(`getSocialComments`, {
      id: activity.id,
      cursor: r,
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    if (mounted.current) {
      setComments(e => r ? [...e, ...i.items] : i.items);
      setCursor(i.cursor);
    }
  }, [
    preview,
    activity.id,
    organizationId,
    viewAsPlayerId
  ]);
  React.useEffect(() => {
    mounted.current = true;
    loadComments().catch(e => {
      if (mounted.current) {
        setError(e.message);
      }
    });
    return () => {
      mounted.current = false;
    };
  }, [loadComments]);
  let saveComment = async (e) => {
    setBusy(true);
    setError(``);
    try {
      await e();
      await loadComments();
      await onChanged();
    }
    catch (e) {
      if (mounted.current) {
        setError(e.message);
      }
    }
    finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  return <section className={`social-comments`} aria-label={`Comments`}>
    {comments.map(n => <div key={n.id}>
      <strong>
        {n.name}
      </strong>
      <p>
        {n.text}
      </p>
      <small>
        {formatDate(n.createdAt)}
      </small>
      {n.canDelete && <button disabled={busy || !!viewAsPlayerId} onClick={() => void saveComment(async () => {
        await callSocial(`saveSocialComment`, {
          id: activity.id,
          commentId: n.id,
          remove: true,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        });
      })}>
        {`Delete`}
      </button>}
    </div>)}
    {cursor && <button disabled={busy} onClick={() => void loadComments(cursor).catch(e => setError(e.message))}>
      {`More comments`}
    </button>}
    {!comments.length && <p>
      {`Start the encouragement.`}
    </p>}
    <form onSubmit={r => {
      r.preventDefault();
      if (preview || viewAsPlayerId) {
        setError(`Read-only preview. Comments are available on real activity after sign-in.`);
        return;
      }
      saveComment(async () => {
        pendingCommentId.current ||= crypto.randomUUID();
        await callSocial(`saveSocialComment`, {
          id: activity.id,
          commentId: pendingCommentId.current,
          text: text,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        });
        setText(``);
        pendingCommentId.current = ``;
      });
    }}>
      <label htmlFor={`comment-${activity.id}`}>
        {`Add a comment`}
      </label>
      <textarea id={`comment-${activity.id}`} required={true} maxLength={1000} value={text} onChange={e => {
        pendingCommentId.current = ``;
        setText(e.target.value);
      }} />
      <button className={`social-primary`} disabled={busy || !!viewAsPlayerId || !text.trim()}>
        {`Post comment`}
      </button>
    </form>
    {error && <p role={`alert`}>
      {error}
    </p>}
  </section>;
}
function People({ context, linkedPlayer, organizationId, preview }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [people, setPeople] = React.useState([]);
  let [cursor, setCursor] = React.useState(null);
  let [search, setSearch] = React.useState(``);
  let [error, setError] = React.useState(``);
  let [busy, setBusy] = React.useState(false);
  let [notice, setNotice] = React.useState(``);
  let mounted = React.useRef(true);
  let loadPeople = React.useCallback(async (e = null) => {
    if (preview) {
      setPeople(sampleActivities.map(e => ({
        playerId: e.playerId + e.id,
        name: e.authorName,
        uid: `sample`,
        mine: false,
        sameTeam: true,
        relationship: `none`
      })));
      return;
    }
    let i = await callSocial(`getSocialPeople`, {
      cursor: e,
      playerId: linkedPlayer,
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    if (mounted.current) {
      setPeople(t => e ? [...new Map([...t, ...i.people].map(e => [e.playerId, e])).values()] : i.people);
      setCursor(i.cursor);
    }
  }, [
    preview,
    linkedPlayer,
    organizationId,
    viewAsPlayerId
  ]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  React.useEffect(() => {
    mounted.current = true;
    loadPeople().catch(e => {
      if (mounted.current) {
        setError(e.message);
      }
    });
    return () => {
      mounted.current = false;
    };
  }, [loadPeople]); /* oxlint-enable react/set-state-in-effect */
  let changeConnection = async (e, t) => {
    if (preview || viewAsPlayerId) {
      setNotice(`Read-only preview. Connections are available after sign-in.`);
      return;
    }
    setBusy(true);
    setError(``);
    try {
      await callSocial(`socialConnection`, {
        playerId: e.playerId,
        action: t,
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      });
      await loadPeople();
    }
    catch (e) {
      if (mounted.current) {
        setError(e.message);
      }
    }
    finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  return <section className={`social-people`}>
    <p className={`social-eyebrow`}>
      {`Find your people`}
    </p>
    <h1>
      {`Stronger connections.`}
    </h1>
    <p>
      {`Your teammates, your club, and the friends who keep you going.`}
    </p>
    {context.playerId && <button onClick={() => {
      if (preview) {
        setNotice(`Sample preview — no connection link.`);
        return;
      }
      navigator.clipboard.writeText(`${window.location.origin}/feed?connect=${encodeURIComponent(context.playerId)}`).then(() => setNotice(`Connection link copied. Send it to a friend.`)).catch(() => setError(`Could not copy. Try again.`));
    }}>
      {`Copy my connection link`}
    </button>}
    <label>
      {`Find a person`}
      <input type={`search`} value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search loaded members by name`} />
    </label>
    {error && <p className={`social-error`} role={`alert`}>
      {error}
    </p>}
    {notice && <p role={`status`}>
      {notice}
    </p>}
    {people.filter(e => e.name.toLowerCase().includes(search.toLowerCase())).map(t => <article className={`social-person`} key={t.playerId}>
      <div className={`social-avatar`}>
        {initials(t.name)}
      </div>
      <div>
        <strong>
          {t.name}
        </strong>
        <small>
          {t.mine ? `You` : t.relationship === `accepted` ? `Friends` : t.sameTeam ? `Your teammate` : t.uid ? `PoseTek athlete` : `Not signed up yet`}
        </small>
      </div>
      {!t.mine && t.uid && context.playerId && <div className={`social-person-actions`}>
        {t.relationship === `none` && <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `request`)}>
          {`Connect`}
        </button>}
        {t.relationship === `received` && <>
          <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `accept`)}>
            {`Accept`}
          </button>
          <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `remove`)}>
            {`Decline`}
          </button>
        </>}
        {[`sent`, `accepted`].includes(t.relationship) && <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `remove`)}>
          {t.relationship === `sent` ? `Cancel request` : `Remove friend`}
        </button>}
        <details>
          <summary aria-label={`More options for ${t.name}`}>
            {`•••`}
          </summary>
          <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, t.relationship === `blocked` ? `unblock` : `block`)}>
            {t.relationship === `blocked` ? `Unblock` : `Block`}
          </button>
        </details>
      </div>}
    </article>)}
    {cursor && <button disabled={busy} onClick={() => void loadPeople(cursor).catch(e => setError(e.message))}>
      {`Load more people`}
    </button>}
    {!people.length && !error && <p>
      {`No people to show yet.`}
    </p>}
  </section>;
}
function SharingSettings({ context, organizationId, preview, onSave }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [preferences, setPreferences] = React.useState(context.preferences);
  let [busy, setBusy] = React.useState(false);
  let [notice, setNotice] = React.useState(``);
  return <section className={`social-settings`}>
    <p className={`social-eyebrow`}>
      {`Your activity. Your choice.`}
    </p>
    <h1>
      {`Sharing settings`}
    </h1>
    <p>
      {`These defaults apply to activity without an individual audience override. Video sharing applies to all of your activity.`}
    </p>
    {context.playerId ? <form onSubmit={e => {
      e.preventDefault();
      if (preview || viewAsPlayerId) {
        setNotice(`Read-only preview — settings were not saved.`);
        return;
      }
      setBusy(true);
      callSocial(`saveSocialPreferences`, {
        ...preferences,
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      }).then(() => {
        setNotice(`Sharing settings saved.`);
        onSave(preferences);
      }).catch(e => setNotice(e.message)).finally(() => setBusy(false));
    }}>
      <fieldset disabled={busy || !!viewAsPlayerId}>
        <label>
          {`Default audience`}
          <select value={preferences.audience} onChange={e => setPreferences({
            ...preferences,
            audience: e.target.value
          })}>
            {Object.entries(audienceLabels).map(([e, t]) => <option value={e} key={e}>
              {t}
            </option>)}
          </select>
        </label>
        <label className={`social-check`}>
          <input type={`checkbox`} checked={preferences.automatic} onChange={e => setPreferences({
            ...preferences,
            automatic: e.target.checked
          })} />
          {`Automatically share recorded sessions and finished workouts`}
        </label>
        <label className={`social-check`}>
          <input type={`checkbox`} checked={preferences.videos} onChange={e => setPreferences({
            ...preferences,
            videos: e.target.checked
          })} />
          {`Include saved rep videos`}
        </label>
        <p>
          {`Turning off sharing stops new video links immediately. A link already issued can remain playable for up to five minutes.`}
        </p>
        <button className={`social-primary`} disabled={busy || !!viewAsPlayerId}>
          {`Save preferences`}
        </button>
      </fieldset>
    </form> : <p>
      {`Activity sharing preferences belong to athlete accounts.`}
    </p>}
    {notice && <p role={`status`}>
      {notice}
    </p>}
  </section>;
}
function Moderation({ organizationId }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [reports, setReports] = React.useState([]);
  let [error, setError] = React.useState(``);
  let [busy, setBusy] = React.useState(false);
  let loadReports = React.useCallback(async () => {
    let n = await callSocial(`moderateSocialActivity`, {
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    setReports(n.reports || []);
  }, [organizationId, viewAsPlayerId]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  React.useEffect(() => {
    loadReports().catch(e => setError(e.message));
  }, [loadReports]); /* oxlint-enable react/set-state-in-effect */
  return <section>
    <h1>
      {`Activity reports`}
    </h1>
    {error && <p role={`alert`}>
      {error}
    </p>}
    {reports.map(n => <article className={`social-card`} key={n.id}>
      <p>
        {n.reason}
      </p>
      <Link to={`/feed?activity=${n.activityId}&organizationId=${organizationId || ``}`}>
        {`Review activity`}
      </Link>
      {[true, false].map(r => <button disabled={busy || !!viewAsPlayerId} onClick={() => {
        setBusy(true);
        callSocial(`moderateSocialActivity`, {
          id: n.activityId,
          hidden: r,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        }).then(loadReports).catch(e => setError(e.message)).finally(() => setBusy(false));
      }} key={String(r)}>
        {r ? `Hide activity` : `Dismiss report / restore`}
      </button>)}
    </article>)}
    {!reports.length && <p>
      {`No open reports.`}
    </p>}
  </section>;
}
function AdminDirectory({ organizationId, selectedPlayer, onSwitch }) {
  let navigate = useNavigate();
  let [directory, setDirectory] = React.useState({
    organizations: [],
    players: []
  });
  let [error, setError] = React.useState(``);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  React.useEffect(() => {
    let t = true;
    setDirectory({
      organizations: [],
      players: []
    });
    setError(``);
    callSocial(`getSocialAdminDirectory`, {
      organizationId: organizationId
    }).then(e => {
      if (t) {
        setDirectory(e);
      }
    }).catch(e => {
      if (t) {
        setError(e.message);
      }
    });
    return () => {
      t = false;
    };
  }, [organizationId]); /* oxlint-enable react/set-state-in-effect */
  let switchPlayer = (e, t = ``) => {
    onSwitch();
    navigate(`/feed?` + new URLSearchParams({
      organizationId: e,
      ...t ? {
        viewAsPlayerId: t
      } : {}
    }));
  };
  return <section className={`social-admin-controls`} aria-label={`Admin feed preview`}>
    <Link to={`/admin`}>
      {`← Admin`}
    </Link>
    <div>
      <label>
        {`Organization`}
        <select aria-label={`Organization`} value={organizationId} onChange={e => switchPlayer(e.target.value)}>
          {directory.organizations.map(e => <option value={e.id} key={e.id}>
            {e.name}
          </option>)}
        </select>
      </label>
      <label>
        {`View as athlete`}
        <select aria-label={`View as athlete`} value={selectedPlayer} onChange={t => switchPlayer(organizationId, t.target.value)}>
          <option value={``}>
            {`Administrator view`}
          </option>
          {directory.players.map(e => <option value={e.id} disabled={!e.canPreview} key={e.id}>
            {e.name}
            {e.canPreview ? `` : ` · Signup pending`}
          </option>)}
        </select>
      </label>
    </div>
    {error && <p role={`alert`}>
      {error}
    </p>}
  </section>;
}
export { ActivityCard, FeedPage as default };
