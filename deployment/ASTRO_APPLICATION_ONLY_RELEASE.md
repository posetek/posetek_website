# Application-only Astro release

Use this procedure when the authenticated application changes and the current
Players/home and Coaches marketing pages must retain their exact approved bytes.
It preserves the current Astro application format and the ordinary live-application
guard. The older `--marketing-snapshot` option deliberately composes a historical
Vite release; it is not the application-only Astro option.

The current marketing HTML is outside `homepage-baseline.json`. Before building,
the release operator captures the two original deployed source documents into an
ignored private directory, plus their current served-page hashes. Original source
and served bytes can differ after hosting normalization. Confirm the current
deployment independently; a copied declaration of its ID is not provider proof.
The private manifest has this format:

```json
{
  "deploymentId": "verified-current-deployment-id",
  "sourceDirectory": "C:/absolute/private/marketing-capture",
  "files": [
    { "path": "/index.html", "sha": "original-source-sha1", "size": 12345 },
    { "path": "/coaches/index.html", "sha": "original-source-sha1", "size": 12345 }
  ],
  "served": [
    { "path": "/", "sha": "current-served-sha1" },
    { "path": "/coaches", "sha": "current-served-sha1" }
  ]
}
```

Real hashes must be forty hexadecimal characters and byte counts must match.
Only these two compiled marketing documents are copied, whether their approved
build used Astro or the earlier Vite workflow. They must retain their exact entry
markers and root element. All directly referenced same-origin runtime scripts
and styles, including `/_astro/`, `/marketing/assets/` and the navigation bridge,
must already be in the verified protected baseline. That baseline
keeps the original asset bytes and navigation bridge, including shared chunks;
the snapshot cannot replace assets or add arbitrary public files. The source
directory must be separate from output, without release-path junctions.

An existing suitable runtime is available at
`C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
(observed v24.19.0). The application's actual engine constraint is `>=22.19.0`;
the cached runtime satisfies it. The PATH-installed v22.18.0 does not. These local
build choices do not alter the cloud functions' Node 22 runtime. Do not download
or install another runtime just for this procedure.

```powershell
$node = 'C:/Users/dylan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$manifestPath = '.netlify/approved-astro-marketing/manifest.json'
$releaseLabel = 'source-VERIFIED_FROZEN_SOURCE_DIGEST'
$env:PUBLIC_RELEASE_SHA = $releaseLabel
$env:VITE_RELEASE_SHA = $releaseLabel
& $node --test scripts/astro-release.test.mjs scripts/application-release.test.mjs
& $node scripts/build-application-release.mjs --preserve-marketing $manifestPath
```

Use an actual frozen source-manifest digest for the build label. An old Git SHA
must not be presented as the identity of different uncommitted source. Keep the
label at most eighty characters for issue-record retention.

The ordinary build first verifies the current application against its baseline,
type-checks and compiles Astro, and restores all protected application/public
files. Composition then freshly checks both served marketing pages against the
manifest and verifies both original documents and their asset references before
changing the application. It substitutes their exact source bytes for the newly
compiled marketing entries, and changes only the application entry and new hashed
assets. Full-site Astro builds without this option retain their existing behavior.

The private build receipt records `framework: astro` for the application,
`marketingPreserved: true`,
the declared marketing deployment ID, fresh served hashes, original source hashes,
the new application entry and added assets. Treat deployment identity as verified
only when joined to the operator's provider receipt. After preview and promotion,
read back all three documents and asset hashes, reconcile the application baseline,
and preserve the held training/mobile acceptance gates. A source build alone is
not a production release or a crash-delivery acceptance result.
