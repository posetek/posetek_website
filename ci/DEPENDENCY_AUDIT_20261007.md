# Website dependency audit candidate — 2026-10-07

This section preserves the **pre-patch baseline at `dab0602`**. The compatible
lockfile patches and current unresolved findings are recorded in
[DEPENDENCY_POLICY_CANDIDATE.md](DEPENDENCY_POLICY_CANDIDATE.md). Do not use the
critical counts below as the current lockfile state or treat the remaining
high findings as accepted exceptions.

This is a read-only preparation record. It does not enable a scanner, change a
package, waive an advisory, or claim exploitability. The repository contains no
tracked Dependabot, Renovate, CodeQL, or dependency-scanning configuration. Its
active CI installs from lockfiles, but does not run `npm audit`. Account-level
GitHub security settings were not inspected for this record.

At source commit `dab060293306f328641b94999a6f92c094cc1203`, npm 10.9.9
queried the public npm registry with `npm --prefix <directory> audit --json` and
`npm --prefix <directory> audit --omit=dev --json`, for each directory below.
The registry returned advisory results, so each command exited 1. The first
sandboxed requests failed DNS; retrying through the approved network boundary
succeeded. No `audit fix`, install, or lockfile edit was run.

| Lockfile (SHA-256) | All dependencies: low / moderate / high / critical | `--omit=dev`: low / moderate / high / critical |
| --- | --- | --- |
| `app/package-lock.json` (`79b13d965e78c4ed2220d56d7231cb94e270db8fc647c4bcad50a4ece75e6f66`) | 0 / 0 / 7 / 0 | 0 / 0 / 4 / 0 |
| `functions/package-lock.json` (`50a3b53078a82209bf36b6123e4cc27d01614274cd3aa3e9ed86d0dd420a4ea0`) | 3 / 15 / 39 / 3 | 2 / 10 / 7 / 3 |
| `functions/legacy-upload-processor/package-lock.json` (`f901ab27e74c2903cf0f9a937af38f4c43263728407e714bbd72a7ba600eebb2`) | 2 / 17 / 42 / 5 | 1 / 12 / 7 / 5 |

These are vulnerable package-node counts reported by npm, not unique advisories.
`--omit=dev` includes production and installed optional dependency chains. The
subtracted entries are development-only lockfile findings, including Jest,
`firebase-functions-test`, and their toolchain dependencies in the two Functions
packages. Development tooling can still matter when it parses untrusted input;
the classification is not a blanket waiver.

## Specific production paths and exposure to verify

| Package / npm severity | Exact root-to-package path in locked tree | Code use and limit of evidence |
| --- | --- | --- |
| Website `@grpc/grpc-js@1.9.16`, high ([GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4)) | `app` → `firebase@12.18.0` → `@firebase/firestore@4.17.1` → `@grpc/grpc-js@1.9.16` | `app/src/lib/firebase.ts` creates a Firestore client. This is a production *package-tree* path; the browser bundle's inclusion of the Node gRPC transport and the advisories' preconditions remain unverified. |
| Functions `protobufjs@7.5.4`, critical ([GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)) | `functions` → `firebase-functions@4.9.0` → `protobufjs@7.5.4`; also `firebase-admin@12.7.0` → optional `@google-cloud/firestore@7.11.6` → `protobufjs@7.5.4` | `functions/index.js` loads Firebase Functions and Admin SDKs. Vulnerable package is installed in the server runtime tree; no crafted-protobuf call path was proven. |
| Functions `proxy-addr@2.0.7`, critical ([GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)) | `functions` → `firebase-functions@4.9.0` → `express@4.22.1` → `proxy-addr@2.0.7` | Server HTTP framework path. Whether the vulnerable IPv4-mapped IPv6 trust-subnet configuration is used needs targeted review. |
| Functions `websocket-driver@0.7.4`, critical ([GHSA-xv26-6w52-cph6](https://github.com/advisories/GHSA-xv26-6w52-cph6), [GHSA-mp7j-qc5w-4988](https://github.com/advisories/GHSA-mp7j-qc5w-4988)) | `functions` → `firebase-admin@12.7.0` → `@firebase/database-compat@1.0.8` → `@firebase/database@1.0.8` → `faye-websocket@0.11.4` → `websocket-driver@0.7.4` | Runtime package tree includes Realtime Database compatibility. Whether these handlers use that client or accept websocket data is unverified. |
| Legacy `axios@1.9.0`, high (multiple npm advisories) | `functions/legacy-upload-processor` → `axios@1.9.0` | Directly imported in `functions/legacy-upload-processor/index.js:3` and used for outbound processor POSTs at lines 75 and 103. This is a concrete execution path; review request URL construction, redirects and response handling for the applicable advisories. |
| Legacy `fast-xml-parser@4.5.3`, critical ([GHSA-m7jm-9gc2-mpf2](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2)) | `functions/legacy-upload-processor` → `@google-cloud/storage@7.16.0` → `fast-xml-parser@4.5.3` | Storage SDK is directly instantiated in `functions/legacy-upload-processor/index.js:8`. XML parser invocation and attacker-controlled XML exposure are unverified. |
| Legacy `form-data@4.0.2`, critical ([GHSA-fjxv-7rqg-78g4](https://github.com/advisories/GHSA-fjxv-7rqg-78g4), [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx)) | `functions/legacy-upload-processor` → `axios@1.9.0` → `form-data@4.0.2` | Axios is called with JSON objects in the visible processor POSTs. Multipart construction through this path was not shown. |
| Legacy `protobufjs@7.5.0`, critical ([GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)) | `functions/legacy-upload-processor` → `firebase-functions@6.3.2` → `protobufjs@7.5.0` | Runtime SDK tree; exploit-relevant parser input remains to be traced. |
| Legacy `proxy-addr@2.0.7`, critical ([GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)) | `functions/legacy-upload-processor` → `firebase-functions@6.3.2` → `express@4.21.2` → `proxy-addr@2.0.7` | HTTP framework path; trust-subnet configuration remains to be traced. |
| Legacy `websocket-driver@0.7.4`, critical ([GHSA-xv26-6w52-cph6](https://github.com/advisories/GHSA-xv26-6w52-cph6), [GHSA-mp7j-qc5w-4988](https://github.com/advisories/GHSA-mp7j-qc5w-4988)) | `functions/legacy-upload-processor` → `firebase-admin@13.3.0` → `@firebase/database-compat@2.0.5` → `@firebase/database@1.0.14` → `faye-websocket@0.11.4` → `websocket-driver@0.7.4` | Installed runtime chain; handler reachability is unverified. |

The table prioritizes critical findings and direct execution paths. Other
production high findings include Functions `@fastify/busboy`, gRPC, `fast-xml-*`,
`form-data`, `node-forge`, and `path-to-regexp`; the legacy tree also includes
`jws`. Reproduce the full advisory list from the unchanged lockfiles before
assigning a remediation owner. A package-tree path establishes that a package
is installed, not that a particular malicious input reaches the affected API.

## Proposed blocking policy for review

1. Keep this existing finding set visible as a dated baseline with an owner,
   exploitability assessment, target version, and review date for each retained
   high/critical advisory. Do not mark the present totals green or hide a failed
   registry query as “no findings.”
2. Once a scanner and baseline exceptions are reviewed, block a new critical or
   high advisory in a production lockfile, or a severity increase of an existing
   finding. Triage a development-only finding for its CI/build input exposure;
   block it when it can process untrusted PR or external data under useful
   credentials or write authority. Never automatically merge an upgrade.
3. Treat a scanner error, missing lockfile, malformed response, or unexpected
   skip as incomplete evidence for any required gate. A manually reviewed,
   time-bounded exception must name the package, advisory, dependency path,
   affected service, rationale, owner, and expiration. No severity-wide waiver.
4. Before enabling required scanning, run it on a representative merge commit,
   compare npm and GitHub advisory output, decide alert ownership and response
   time, verify fork behavior and permissions, and measure runtime/cost. Keep
   software update PRs reviewable and separate from automatic deployment.

The two Functions lockfiles describe different Node engines (22 and 20) and
different Firebase SDK versions. They require separate remediation and runtime
validation; one package update does not prove the other service safe.

## Bounded dependency update proposal — separate approval required

The root `firebase.json` selects `functions/` at Node 22, and `functions/index.js`
loads both Firebase SDKs. Treat this as the active Functions dependency surface.
The separate `functions/legacy-upload-processor/index.js` exports a Storage
finalize trigger, imports Axios and Storage directly, and is absent from that
root deploy configuration. Historical release notes say this processor was
active. Its present deployed status must be verified before anyone calls it
retired or excludes it from remediation.

For active Functions, propose a **separate reviewed lockfile-only change** to
`functions/package-lock.json`, leaving `functions/package.json` and runtime
semantics unchanged if the existing semver ranges permit resolution. At minimum:

- Resolve `protobufjs@7.5.4` to **7.6.5 or newer within major 7**. The official
  [code-execution advisory](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)
  fixes at 7.5.5, but npm reports other advisories through 7.6.4. This case
  requires an attacker-controlled protobuf schema/JSON descriptor; none is
  shown in website handlers, so installed status does not establish exposure.
- Resolve `proxy-addr@2.0.7` to **2.0.8 or newer within major 2**. The
  [advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) requires a
  misconfigured IPv4-mapped IPv6 trusted-proxy subnet; no such application
  configuration was found in this pass. The Express transitive path remains
  deployed and should be patched rather than silently exempted.
- Resolve `websocket-driver@0.7.4` to **0.7.5 or newer within 0.7**. The
  [critical length-header advisory](https://github.com/advisories/GHSA-xv26-6w52-cph6)
  affects pre-0.7.5, but direct Realtime Database/WebSocket use by these
  handlers was not demonstrated. `faye-websocket` currently allows `>=0.5.1`.

The locked parent specs `firebase-functions → protobufjs ^7.2.2`, `express →
proxy-addr ~2.0.7`, and `faye-websocket → websocket-driver >=0.5.1` appear to
allow these targets. That is a resolution proposal, not a tested lockfile. After
approval, regenerate only this lockfile, review **every transitive change**,
run `npm ci --ignore-scripts`, the full Functions Node suite, targeted HTTP/auth
and retry tests, emulator transactions where available, then rerun both audit
modes. Verify Firebase SDK/Node 22 compatibility before any deployment review.

For the legacy processor, make a **different reviewed change** to
`functions/legacy-upload-processor/package-lock.json` only if the exact semver
ranges can resolve all affected versions. Its five critical nodes include the
three above plus `fast-xml-parser@4.5.3` through direct
`@google-cloud/storage@7.16.0` and `form-data@4.0.2` through direct
`axios@1.9.0`. The [XML advisory](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2)
fixes that specific 4.x flaw at 4.5.4; the full npm advisory set must be clear
at the selected 4.x version. The [multipart-header advisory](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx)
fixes 4.x at 4.0.6. The visible Axios calls send JSON objects to fixed URLs;
they do not establish a multipart-input path. Separate tests should cover
the Storage finalize guard, unmarked MOV and body-scan routing, signed-URL
lifetimes, request body/timeout/error behavior, and Node 20 load compatibility,
without calling processors or production Storage. Recheck the direct Axios
high-severity advisories and all remaining criticals before a release decision.

Both proposals change material that predates this pipeline iteration, so obtain
the user's specific approval before editing either package or lockfile. Do not
use `npm audit fix` as an unreviewed blanket mutation or make the present
critical findings a permanent green baseline exception.
