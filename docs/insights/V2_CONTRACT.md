# Expanded Insights V2 contract

Implementation contract, not a production receipt. The existing V1 callable remains unchanged.

See [COACH_WORKSPACE_CONTRACT.md](COACH_WORKSPACE_CONTRACT.md) for the additive
independent-coach scope, player comparison, roster search and rollout contract.

`getClubInsightsV2` accepts:

```ts
{
  scope: { kind: 'global' } | { kind: 'organization'; organizationId: string }
    | { kind: 'team'; organizationId: string; teamId: string }
    | { kind: 'coachRoster' }, // caller resolved; no coach ID input
  timeZone?: string, // IANA; default America/Los_Angeles
  startDate?: string, endDate?: string, // YYYY-MM-DD, inclusive, default last 56 local dates
  testingMode?: 'cumulative' | 'period', // default cumulative, through selected end
  filters?: {
    division?: 'boys' | 'girls' | 'unknown',
    ageBand?: 'under10' | '10-12' | '13-15' | '16-18' | '19+' | 'unknown',
    testingStatus?: 'fullyTested' | 'partiallyTested' | 'noSuccessfulTests' | 'noRecordedTests',
    workoutStatus?: 'completed' | 'inProgress' | 'endedEarly' | 'abandoned' | 'none',
    usageStatus?: 'returning' | 'active' | 'inactive' | 'notCollected',
    usagePlatform?: 'web' | 'ios' | 'both',
    usageFeature?: 'workout' | 'video' | 'training' | 'results' | 'planner' | 'feed' | 'overview' | 'other',
    teamAssignment?: 'assigned' | 'unassigned'
  },
  nameSearch?: string, // <=120 characters; roster only, not report totals
  pageSize?: number, // 1..100, default 50
  cursor?: string, // opaque; reset when selection changes or failed-precondition asks to refresh
  rosterPlayerIds?: string[] // admin only; 1..20 unique canonical player IDs in the selected scope
}
```

The response is an allowlisted object:

```ts
{
  schemaVersion: 2,
  scope: { kind, organizationId?: string, teamId?: string, coachId?: string, label: string,
    access: 'admin' | 'manager' | 'coach', assignedTeamsOnly: boolean },
  choices: { global: boolean, coachRoster: {coachId: string; label: string} | null, organizations: Array<{id: string; name: string;
    role: 'admin' | 'manager' | 'coach'; teams: Array<{id: string; name: string}>}> },
  period: {startDate: string; endDate: string; timeZone: string;
    startMillis: number; endMillis: number}, // end exclusive, observations never beyond now
  testingMode: 'cumulative' | 'period', filters: {...}, nameSearch: string, generatedAtMillis: number,
  freshness: {complete: true; projectionVersion: number;
    oldestRebuiltAtMillis: number | null; newestRebuiltAtMillis: number | null;
    qualification: 'verified-artifacts'; historicalOwnership: 'current'},
  roster: {total: number; included: number; excluded: number; filtered: number; matched?: number},
  participation: {testingPlayers: number; workoutPlayers: number; anyPlayers: number},
  demographics: {division: Array<{key: string; count: number}>;
    ageBand: Array<{key: string; count: number}>},
  scopeBreakdown: {organizations: Array<{id: string; name: string; count: number}>;
    teams: Array<{id: string | null; organizationId: string; name: string; count: number}>},
  testing: {
    statuses: Array<{key: string; count: number}>,
    progress: Array<{drill: string; unit: 'm/s' | 'm' | 's'; lowerIsBetter: boolean;
      samples: number; players: number; weeks: Array<{weekStart: string;
        best: number | null; samples: number; players: number}>}>,
    recordedDocuments: number, distinctAttempts: number, qualifyingTests: number,
    failureReports: number, linkedFailureReports: number, unmatchedFailureReports: number,
    undatedFailureReports: number, futureDatedFailureReports: number,
    duplicateDocuments: number, needsReview: number, noResultDocuments: number, undatedDocuments: number,
    futureDatedDocuments: number,
    exercises: Array<{key: string; playersQualified: number; qualifyingTests: number;
      distinctAttempts: number}>,
    days: Array<{date: string; recordedDocuments: number; distinctAttempts: number;
      qualifyingTests: number; failureReports: number; linkedFailureReports: number; unmatchedFailureReports: number}>
  },
  workouts: {
    statuses: Array<{key: string; count: number}>, started: number, completed: number,
    inProgress: number, endedEarly: number, abandoned: number, unknownEnding: number, duplicateLogs: number,
    outcomeEvents: number, timerRecords: number, estimatedRecords: number, knownPrescription: number,
    doneBlocks: number, partialBlocks: number, skippedBlocks: number,
    setsCompleted: number, timerMinutes: number, estimatedMinutes: number,
    unknownDuration: number, allPrescribedSetsCompleted: number, unknownPrescription: number,
    days: Array<{date: string; started: number; completed: number;
      timerMinutes: number; estimatedMinutes: number}>
  },
  usage: {
    statuses: Array<{key: string; count: number}>, collectedPlayers: number,
    notCollectedPlayers: number, activePlayers: number, returningPlayers: number,
    webCollectedPlayers: number, iosCollectedPlayers: number,
    activeMinutes: number, webMinutes: number, iosMinutes: number, overlapMinutes: number,
    collectionStartedAtMillis: number | null, featureMinutes: Record<string, number>,
    webCollectionStartedAtMillis: number | null, iosCollectionStartedAtMillis: number | null,
    days: Array<{date: string; activeMinutes: number | null; webMinutes: number | null;
      iosMinutes: number | null; collectedPlayers: number; webCollectedPlayers: number; iosCollectedPlayers: number}>
  },
  players: Array<{
    id: string; firstName: string; lastName: string; organizationId: string;
    organizationName: string; teamId: string | null; teamName: string | null;
    division: string; age: number | null; ageBand: string; registered: boolean; signupInvitationReady: boolean;
    testing: {status: string; exercisesComplete: number; recordedDocuments: number;
      distinctAttempts: number; qualifyingTests: number; exerciseKeys: string[];
      missingExerciseKeys: string[]; undatedDocuments: number; futureDatedDocuments: number;
      dateUnknownAttempts: number; hasDateUnknownAttempts: boolean},
    workouts: {status: string; started: number; completed: number;
      timerMinutes: number; estimatedMinutes: number; allPrescribedSetsCompleted: number; unknownPrescription: number;
      outcomeEvents: number; timerRecords: number; estimatedRecords: number; unknownDuration: number; knownPrescription: number},
    usage: {status: string; collected: boolean; activeMinutes: number;
      webMinutes: number; iosMinutes: number; activeDays: number; webCollected: boolean; iosCollected: boolean}
  }>,
  pagination: {total: number; pageSize: number; nextCursor: string | null},
  rosterMetrics?: Array<
    {playerId: string; status: 'included'; player: /* same allowlisted players row above */ ExpandedPlayer}
    | {playerId: string; status: 'excluded'}
  >
}
```

Charts and totals cover every filtered player, independent of the displayed page
or roster name search. Pagination totals count search matches; roster.filtered
retains the complete reporting-filter population.

The optional `rosterPlayerIds` lookup connects an admin directory's visible page
to the same authoritative player metrics without draining reporting pages or
issuing separate comparison calls. It is restricted to verified, nonanonymous
PoseTek admins; organization managers and coaches cannot use it. Its input must
contain 1–20 unique IDs accepted by the canonical player-ID validator. Empty,
duplicate, malformed and oversized lists return `invalid-argument` before
directory/history reads. `getCoachPlayerComparison` rejects this field with
`invalid-argument`, including for admins.

`rosterMetrics` is omitted when the field is absent. When requested, it preserves
input order, and each included `player` is the exact same allowlisted shape as a
normal `players` entry. The lookup uses the selected scope, reporting period,
testing mode and existing usage definitions, before optional report filters,
name search and pagination. It does not change report totals, the normal player
page, existing cursors or the projection schema. The ID list is copied after
validation; lookup selection does not become part of the reporting cursor.

Every requested ID must belong to the freshly authorized canonical scope both
before history loading and during the final read-only transaction. Missing,
foreign, wrong-team, deleted and transferred-out requested profiles receive the
same generic `permission-denied` response; no per-ID existence detail is returned.
An authorized player whose server-owned reporting inclusion is false returns
only `{playerId, status: 'excluded'}` and its projection/history and usage are not
loaded. If inclusion changes during a read, newly excluded rows remain hidden;
newly included rows require the existing complete-report retry before any
metrics are returned. The existing legacy-scope restrictions remain authoritative;
the lookup does not broaden canonical reporting to legacy organizations.
Participation counts distinct athletes with selected-period recording documents
and actual workout starts/endings, plus their union. Plans and usage time do not
substitute for either activity.
Testing status uses all six required exercises, cumulative by default; the daily
series always covers the selected period. Workout status is an exclusive player
classification, prioritizing completed, then no ending record (`inProgress`), ended
early, abandoned, none; event totals retain every distinct workout. Started totals
use `startedAt`; completed totals use `endedAt`, including workouts started before
the selected period. Durations belong to logs ending in the period, or logs with
no ending that started in the period. These are reported workout evidence, not
proof of physical exercise. `allPrescribedSetsCompleted` requires an immutable
workout snapshot and every prescribed set; a completed session with a skipped
block does not satisfy it. Usage is returning (two or more
active local days), active, inactive after collection, or not collected.

Workout outcome events cover completed-as-logged, ended early, no ending record,
abandoned and unknown ending. Logs ending outside the selected period contribute
to starts when appropriate, but not to that outcome denominator or its block/set
totals. `timerRecords + estimatedRecords + unknownDuration = outcomeEvents`;
`knownPrescription + unknownPrescription = outcomeEvents`. A recorded zero-minute
timer is known time, while missing time is not. Prescription coverage spans all
outcomes, so label the numerator as all prescribed sets recorded rather than
completed sessions.

Failure reports are selected-period source reports counted separately from
recording documents and distinct recorded attempts. Their linked/unmatched counts
sum to `failureReports`; linked reports can overlap the recording documents and
must not be added as extra attempts. Explicit different session document IDs veto
numeric-session/folder fallback links because native failed retries can reuse
those coordinates. Explicit same-rep IDs remain authoritative. Undated and future
failure reports are separate review counts.

Verified performance series use the same filtered full roster, selected dates and
time zone as the rest of V2. Their local Monday weeks are clipped to the selected
period, including partial boundary weeks. Each point is the best qualifying
canonical-unit result across that roster, with qualifying sample and distinct
athlete counts; series totals count unique athletes across all weeks. Empty weeks
have a null best. Series with no qualifying samples are omitted. These are roster
best values, not averages or evidence of improvement for each athlete. Cumulative
coverage mode does not widen the performance trend's selected date range.

Usage platform filters select positive exclusive web time, exclusive iOS time, or
overlap (`both`). Feature filters select positive attributed feature time. Daily
series return null before collection started; platform coverage is independent.
The full filtered roster can have fewer collected players than its total; coverage
counts remain visible. Null team identifiers in scope breakdown mean unassigned.
Use organization scope plus the unassigned filter for that drilldown.

Global access is verified PoseTek admin only and includes canonical organizations;
independent legacy profiles are excluded from global. The separate coachRoster
scope resolves only the current independent coach, rejects managed/inactive staff
fallback and excludes organization-owned players. Managers include unassigned organization
players. Coach organization scope is the intersection of current assigned teams
and canonical team ownership. Current memberships and profile ownership are
rechecked after reads. New profiles are included unless server-owned
`players/{id}/insightMetadata/reporting.include` is explicitly false. Division is
explicit reporting metadata; names and team labels never infer it. Age is valid
DOB first, then a legacy age recorded within 365 days, otherwise Unknown.

The service publishes only complete, versioned server projections. Its factory is
`createInsightsV2({db, bucket, HttpsError})` in `functions/insights-v2.js`, returning
`getClubInsightsV2(data, caller)`, `getCoachPlayerComparison(data, caller)`,
`invalidateInsightPlayer(playerId)`,
`rebuildInsightPlayer(playerId)` and `loadInsightPlayer(playerId)`. Caller fields
are the existing verified callable wrapper's `uid`, `email`, `emailVerified` and
`isAnonymous`. The root index owns callable and trigger wiring.

Projection version 4 adds qualified profile metrics for player comparison, retaining
duration-source and failure-report facts. Older
versions rebuild automatically. Projections use server-only `players/{id}/insightSummaries/current` and `state`,
with immutable `players/{id}/insightSummaryDays/{generation-page}` documents. A
complete manifest publishes only after checking its invalidation token. Previous
published pages are removed after publication; a racing reader refreshes rather
than accepting an incomplete manifest. Profile deletion removes projection pages.
Qualification is recomputed from current positive root primary fields, actual
generation-pinned metadata and reprocess sidecar evidence, matching accepted
revision documents, and owner-scoped linked `failureCases`. Missing or conflicting
evidence becomes Needs review; no positive result is No result. A proven pathless
jump mirror is preserved as a document and excluded from distinct attempts.

Freshness reports the latest received source invalidation and rebuild timestamp.
Cross-service changes can precede asynchronous events; this is not a claim of a
transactional snapshot across Firestore and Storage. The response rechecks current
membership, canonical ownership, reporting inclusion and projection token. All
historical testing follows the current owner. Undated and future documents remain
separately visible and cannot contribute to dated completion or progress.
An athlete with undated attempts is never classified as having no recorded tests:
when there is no dated success, the response uses `noSuccessfulTests` with explicit
`dateUnknownAttempts` / `hasDateUnknownAttempts` review markers. Dated totals and
period trends exclude these records because their window cannot be established.
Legacy jump inches are converted to meters before comparing processing evidence.
Skipped workout blocks retain any previously performed set counts, while still
failing the all-prescribed-sets-completed condition.

Operational
read bounds fail explicitly with `resource-exhausted`; missing, dirty or old
projections are rebuilt automatically, at most 25 players per request. Additional
work fails with `failed-precondition` and `details.reason: 'insights-rebuild-required'`;
a retry advances the remaining rebuild, and
missing immutable pages also trigger repair. Other
errors use standard callable `unauthenticated`, `permission-denied`, `not-found`
and `invalid-argument`, plus retryable `aborted` on concurrent change. Bounds are
500 canonical directory documents, 2,000 teams per organization, 5,000 scoped
players, 20,000 reps and 10,000 workout logs per player, and 200,000 selected-scope
event facts per request. Queries paginate internally, retaining undated source
documents. No partial global summary is presented as a total.
Private metadata, artifact paths, contacts, notes and prompts never leave the API.
