# Rules emulator suites

These suites test the **canonical** Firestore and Storage rules, which live only in
`PoseTek-mobile-app/firebase/firestore.rules` and `storage.rules`. This repository has
no rules files and cannot publish rules: `firebase.json` carries Firestore *indexes*
only. Rules are published only by `python firebase/operations.py publish` in the mobile
repo. A rules change is a change to the mobile repo, where its own emulator suite
(`firebase/tests`, hash-bound receipt) runs as well.

## Running

```sh
node scripts/run-rules-tests.mjs                          # every suite
node scripts/run-rules-tests.mjs socialRules adminRules   # named suites
```

The runner writes a throwaway emulator config outside the repo, then runs each suite
in its own `firebase emulators:exec` under a `demo-` project. It reports the
SHA-256 of both rules files it tested, and it fails if either file changed during the
run.

| Variable | Default | Meaning |
|---|---|---|
| `RULES_PATH` | `../PoseTek-mobile-app/firebase/firestore.rules` | Canonical Firestore rules |
| `STORAGE_RULES_PATH` | `../PoseTek-mobile-app/firebase/storage.rules` | Canonical Storage rules |
| `FIREBASE_BIN` | `firebase` on `PATH` | Firebase CLI |
| `JAVA_HOME` / `PATH` | — | Java 11+ for the emulators |

The defaults assume both repos are checked out side by side. To test a rules change
before it merges, point the two variables at the branch or worktree that holds it.

This repo does not depend on `firebase-tools`. The mobile repo's `firebase/package.json`
pins the CLI, so `npm ci --prefix <dir>` with a copy of that file gives a
`<dir>/node_modules/.bin/firebase` for `FIREBASE_BIN`.
On Windows, set `FIREBASE_BIN` to the absolute
`<dir>/node_modules/firebase-tools/lib/bin/firebase.js` path; the runner invokes
that entrypoint with Node directly instead of a shell shim.

| Suite | Emulators | Covers |
|---|---|---|
| `adminRules` | Firestore | Admin predicate, catalog authoring, plan-edit closure, staff test recording |
| `insightsRules` | Firestore | Insight usage and summary projections are server-only |
| `workoutNotifications` | Firestore | Notification settings, activity and outbox deny direct client access |
| `personalizedRules` | Firestore | Personalized planner capabilities, draft views, private context |
| `socialRules` | Firestore + Storage | Feed roots, protected invitations, recording media |
| `testingEventRules` | Firestore | Testing events and their stations |
| `trainingExpansion` | Firestore | Whole-body authoring, imports, reviewers, workout starts |
| `trainingMedia` | Firestore + Storage | Managed-drill catalog media |

`insightUsage.emulator.cjs` is not a rules suite: it is an Admin SDK aggregation test.

Each suite takes its emulator address from `firebase emulators:exec` and its rules
from `canonicalRules.mjs`; none reads a rules file of its own. A new suite should do
the same and be added to the runner's list.
