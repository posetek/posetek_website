# Coach overview refresh

Published website: `6ac38fde67d690075984e58b`, source `7b1aa186`,
October 5, 2026 at 4:55:11 AM PDT. See the
[verified receipt](../deployment/COACH_OVERVIEW_PRODUCTION.json).

Kai (`suzkai`) authored the dashboard changes on `Coach-Dashboard` in commits
`0bad2029` and `7007871`. Dylan reviewed the synthetic preview and authorized
website deployment on October 5, 2026. The release branch preserves both commits
and merges them with the current feedback and approved P-icon source.

## Experience and definitions

Coach Overview leads with a dated Team snapshot: the filtered reporting player
population, players with testing activity and players with workout activity in
the selected period. Worth reviewing opens Testing with No recorded tests or
Workouts with No workout status. Missing records, unrecognized endings and
workouts ending outside the period can have this status even when activity was
recorded. Missing activity records do not establish the reason for inactivity.
Review actions preserve other reporting filters and clear roster name search so
the resulting player count matches the snapshot; zero-count actions are disabled.
Testing coverage retains its cumulative/selected-period control.

The roster starts collapsed. Opening it retains search, pagination, signup
actions and existing player links. It stays expanded through loading, retries,
search, pagination, date changes and refresh; another account/team starts
collapsed. Removable active-filter chips, included/filtered population counts
and Clear all filters remain visible on Overview. Name search affects roster
rows, not report totals or measured comparison cohorts.

Testing, Workouts, Active use, Community and individual player detail keep their
existing tabs. The previous coach Overview charts and summary breakdowns are
removed from that tab. Admin and manager reporting retain their existing views.
Weekly qualified-performance lines connect between available results across
empty weeks; explanatory text and the data table identify the missing weeks.
Different players can set each weekly best; this is not individual improvement.

## Release boundary

This is a website presentation release. Reporting calculations, cohorts,
canonical access, account roles, private drafts/conversations, workout records,
training/catalog holds, backend functions, rules, gateway and native releases
are unchanged. Feedback and the four stable P icon assets retain their exact
production artifact bytes. Players and Coaches retain verified original
documents, runtime assets and served content from the current production.

Use the deliberate Astro application build with a freshly verified marketing
snapshot. This release also restored the exact provider-bound `/feedback.html`
from its verified baseline cache after composition: Astro's newly compiled head
reordered unchanged links. The feedback runtime assets remained protected. Record
that substitution in the build receipt and verify it against the prior provider
inventory before upload. Review the exact Netlify draft, compare its full provider inventory
with the local artifact, verify served routes/headers and promote that same
draft. Reconcile `deployment/homepage-baseline.json` only after production
verification, then run the ordinary preservation build.

The confirmed publication, source, validation counts and recovery deployment
are recorded in `deployment/COACH_OVERVIEW_PRODUCTION.json`. Production contains
1,587 artifact files and 1,588 provider records; the reconciled baseline protects
1,585 files and the ordinary TypeScript/Astro preservation build passed.
Synthetic checks demonstrate UI behavior; they do not constitute a new audit
of every production club/player measurement or device acceptance.
