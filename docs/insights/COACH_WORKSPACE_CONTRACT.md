# Unified coach workspace contract

Implementation contract; the release receipt records deployment and live acceptance separately.
Team Insights owns the coach reporting totals, with roster, player tabs and Community sharing its shell.

## Additive reporting interface

`getClubInsightsV2` retains schema version 2 and existing global/organization/team semantics.

- Request `scope: {kind: 'coachRoster'}` resolves the current independent coach. No coach ID input is accepted.
- Response scope adds `coachId`, `label: 'My roster'`, `access: 'coach'`, `assignedTeamsOnly: false`. `choices.coachRoster` is `{coachId, label}` when available, otherwise null.
- Optional `nameSearch` is a string of at most 120 characters, trimmed and matched case-insensitively against the displayed full name. It narrows only returned players and `pagination.total`; charts and `roster.filtered` retain all reporting-filter matches. A nonempty search adds `roster.matched`. The normalized search is echoed as `nameSearch`, and cursors bind it.
- Player rows add `registered` (registered or authentication-linked) and `signupInvitationReady`. Codes never enter Insights; existing invitation callables revalidate access and preserve valid codes.
- Independent rows have empty organization names/IDs and null team values. Existing organization fields and reporting filters remain available.

## Player comparison

`getCoachPlayerComparison` accepts `{scope, playerId, startDate?, endDate?, timeZone?, testingMode?}`. Scope must be a selected team (`{kind:'team', organizationId, teamId}`) or `{kind:'coachRoster'}`. Date/default validation matches V2. Table search, filters and page parameters never narrow its cohort.

The allowlisted response is:

```ts
{
  schemaVersion: 1,
  scope: /* resolved V2 scope */,
  period: /* resolved V2 period */,
  testingMode: 'cumulative' | 'period',
  generatedAtMillis: number,
  freshness: /* complete V2 freshness, projectionVersion 4 */,
  player: {id: string; firstName: string; lastName: string; age: number | null},
  roster: {total: number; included: number; excluded: number},
  axes: Array<{
    key: 'power' | 'speed' | 'agility' | 'ballControl' | 'striking',
    label: string,
    measuredScore: number | null,
    percentile: number | null,
    sampleCount: number,
    status: 'measured' | 'unmeasured' | 'insufficientComparison'
  }>
}
```

The chart is labeled **Team percentile** or **Roster percentile**, not D1 rank.
`sampleCount` counts included athletes with measured scores on that axis, including the selected athlete. Missing measurements are null, never zero. Fewer than two measured athletes gives `insufficientComparison` for a measured athlete; an unmeasured athlete retains `unmeasured`.

Axis scoring preserves the existing athlete-profile method: best qualifying observation per metric, normalized using the unchanged benchmark reference/direction, then mean of available metric scores per axis. Browser and server share `functions/athlete-profile-spec.json`. Only canonical `effectiveRep` values enter scoring, preserving explicit nulls, accepted-revision precedence and normalized units. Failed/unqualified, duplicate, provisional, undated and future values cannot contribute. Cumulative mode includes dated results through the selected end; period mode also enforces the selected start. Reporting-excluded athletes never enter the cohort.

Percentile = `100 * (numberBelow + (numberTied - 1) / 2) / (sampleCount - 1)`.
All equal scores give 50. Existing D1 comparisons remain separate in testing details; cohort ranking has no added age/division adjustment. Peer scores and raw results are not returned.

## Authorization and age

Organization/team authority remains current canonical membership and team ownership. Independent authority requires exactly one owned `coaches` document with `userUID` equal to the caller. Candidates come from `members` and existing coach-link fields, then intersect the canonical Firestore read predicate: `coachUID`, `coachId` or `coachDocId` must equal the caller UID, or the player's `coachDocId` (defaulting to caller UID when absent) must identify the owned coach and its `members` must include the player. This avoids listing legacy document-ID aliases that the existing profile/workout rules deny. A player with any `organizationId` property is excluded, even when stale legacy mirrors still list them.

A canonical organization membership at the caller UID, including an inactive or malformed one, blocks independent fallback. Any owned coach document with an `organizationId` or `organizationRole` property also blocks it. Ambiguous owned coach documents grant no independent access. Verified PoseTek admins keep existing global/organization/team access; this scope does not introduce impersonation.

Both callables authorize before history reads and again in the response-time read-only transaction. They compare complete roster identity sets and recheck each profile's ownership, reporting inclusion and projection token. Concurrent change aborts; bounds fail explicitly instead of returning partial cohorts. No contacts, notes, paths or conversations enter the response.

Backend age checks recorded `birthDate`, `dateOfBirth`, `dob`, `birthdate`, then `birthday`, accepting valid ISO dates, Date/Timestamp values and serialized seconds. UTC calendar age must be 5–80. Invalid/future dates do not qualify. Fallback requires an integer `age` with nonfuture `ageRecordedAt` no more than 365 days old; the observation is never incremented. Missing evidence returns null and displays **Not recorded**. Division, team labels and planning assumptions never supply age.

## Projection rollout and acceptance

Projection version 4 adds qualified profile metric facts, preserving existing qualification and totals. Older summaries rebuild lazily, at most 25 players per request. Exhaustion returns `failed-precondition` with `details.reason: 'insights-rebuild-required'`; each retry advances the remainder. Clients retry only that reason, up to five attempts with a brief delay and a current auth/request guard, then offer Refresh. Large scopes may need more refreshes; no stale or partial chart is shown.

Use the guarded expanded-insights deployment package for these nine functions: `getClubInsightsV2`, `getCoachPlayerComparison`, `projectInsightPlayer`, `projectInsightRecords`, `projectInsightRevisions`, `projectInsightFailures`, `projectInsightArtifacts`, `projectInsightArtifactDeletes`, and `recordInsightUsage`. The existing usage callable is included unchanged by the codebase package; notification functions, rules, gateway and native UI are untouched. Older separately deployed testing-event code can write version-3 summaries; the next report read repairs them through the same bounded path. No unrelated testing deployment is required.

Before promotion, use temporary independent and assigned-team accounts, including revocation/transfer denials. Authorized reporting reads may prewarm real server-owned projections; they do not change source profiles, workouts or evidence. Scope and retry those reads without raising bounds or fabricating facts. Verify exact roster counts and full-cohort comparisons. Clean temporary accounts/profiles, invitation indexes, projection pages, storage evidence and asynchronous deletion tombstones. Live workout notification settings remain untouched; synthetic histories must not queue or send notification email; remove any derived historical activity records.

Tests cover independent authority aliases, inactive/managed fallback denial, response-time revocation, search-only pagination, ties, missing data, windows, exclusions, canonical secondary-null precedence, stored birth formats, complete-report bounds, verified callable wrappers and exact browser/server scoring parity. Existing Insights, effective-results and notification regressions remain required.
