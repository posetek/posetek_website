# PoseTek website icons

Dylan requested the PoseTek P for browser tabs and Google Search on October 3,
2026. Use the exact previously approved lime P badge, including its evergreen
canvas and lower-right notch. The outlined master was recovered from
`codex/official-brand-icon` at `4ca3227`,
`images/brand/posetek-app-icon.svg`. Its September 18 handoff records Dylan's
approval of the existing website badge as the official app icon.

The website master is `app/astro/public/brand/posetek-p.svg`. It contains paths,
requires no font download and preserves the original geometry and colors.
The outlined Inter glyph license is in `SITE_ICONS_FONT_LICENSE.txt`.
`node scripts/export-website-icons.mjs` produces the committed 96px PNG,
180px Apple touch icon and ICO with 16/32/48/256px entries. It also synchronizes
the Vite public copies and replaces the unused starter SVG in source.

`WebsiteIcons.astro` provides the shared links for Players, Coaches, the
application and isolated feedback. Compatibility HTML entries use the same
links. All icon URLs are stable and same-origin. The full PoseTek wordmark in
`images/logo.svg` remains available for page content.

Google's [favicon requirements](https://developers.google.com/search/docs/appearance/favicon-in-search)
call for a square image and recommend a size greater than 48px. The 96px PNG
and multi-size ICO meet that format requirement. The homepage and icons must
remain crawlable. Google controls search display and may take several days to
weeks to recrawl and process the change; a website release does not prove a
Google Search refresh.

## Scoped publication

For this metadata-only release, capture the two original production marketing
documents, match their provider inventory hashes and record freshly checked
served hashes using the existing Astro marketing snapshot format. Keep that
snapshot outside Git. Run:

```powershell
node scripts/build-icon-release.mjs --preserve-marketing .netlify/site-icons-marketing-manifest.json
```

This first runs the ordinary production preservation guard. It restores the
exact marketing documents, updates only icon link elements inside HTML heads,
adds the four declared icon files and removes newly compiled unused Astro
assets. Its receipt is `.netlify/icon-release-build.json`. HTML bodies,
non-icon head bytes and retained runtime assets are preserved, including
historical filename aliases. Head scripts, styles and comments are excluded
from link replacement. Feedback retains its isolated document and CSP.

Review a Netlify draft, compare its complete inventory to the local artifact
and original production inventory, verify served routes/icons and browser
rendering, then promote that exact draft. Reconcile
`deployment/homepage-baseline.json` only after production verification and run
the ordinary preservation build again. `mergeWebsiteIcons` refuses changed
pinned icon bytes; the application guard remains enforced.

The current icon-release builder supports the initial four-file addition and
head metadata changes. Replacing an already-pinned icon file requires a reviewed
extension that explicitly records and verifies its old/new bytes. Ordinary
builds intentionally reject that replacement; do not edit baseline hashes ahead
of publication or bypass its checks.

No functions, rules, gateway, native release or training records are involved.
The production receipt belongs in `deployment/SITE_ICONS_PRODUCTION.json`.
