# Offline dependency policy candidate

The local CI workflow now includes this scanner lane; no hosted run, push, or
required-check activation has been performed. `dependency_audit_policy.py`
accepts npm's `audit --omit=dev --json` report, the matching npm v3
lockfile, npm's exit status, and a separately reviewed exception file. It
prints every production high/critical advisory path, blocks a newly seen
high/critical path or severity increase, and treats scanner errors, malformed
reports, missing graph nodes, and invalid or expired exceptions as incomplete
evidence. It never edits packages, lockfiles, or exceptions.

`run_dependency_audit.py` supplies a fixed scope (`app`, `functions`,
or `legacy`) to `npm audit --omit=dev --json`, captures its exit code and feeds
both into the validator. It runs no install or upgrade command, times out, and
returns a nonzero result on scanner failure. Its `--baseline` argument is
mandatory. Valid scanner reports list high/critical advisory paths even when
an exception file is missing; that error remains nonzero. The three current
exception files name exact paths, a maintainer owner, inspection reasons, and
2026-10-14 expiry under the orchestrator's delegated assessment. These are
short-lived, reviewed assumptions, not a blanket acceptance of npm findings.

An exception file has `schema: 1` and an `exceptions` array. Each entry must
name the advisory URL, root-to-package `path`, approved severity, named owner,
reason, and ISO `expires` date. The parser rejects placeholder owners/reasons.
No generated snapshot becomes an exception automatically. Any baseline
addition or renewal needs explicit review; because this is ordinary
repository-controlled CI code, it is not tamper-resistant protection against
someone who can change the policy itself.

The current `app/package-lock.json` SHA-256 is
`79b13d965e78c4ed2220d56d7231cb94e270db8fc647c4bcad50a4ece75e6f66`;
`functions/package-lock.json` is
`a8fe6b8e4487c7d263942a6df98c440863107a80940f41cc9b21730b28584a2e`;
and `functions/legacy-upload-processor/package-lock.json` is
`5f6a01cec4842b0f63dc5ab7cb908aa48c6e7d11856c3e5ecb9e16d121f67a6f`.
Fresh production audits on 2026-10-07 found 4, 12, and 11 vulnerable package
nodes respectively, with one remaining high advisory
path per scope: app `firebase -> @firebase/firestore -> @grpc/grpc-js`, and
Functions/legacy `firebase-admin -> node-forge`. Each has an exact seven-day
exception, while all other current production high/critical findings were
patched. The runner passed against fresh registry responses for all three
scopes; this is local evidence, not a hosted required-check result.

Before hosted enforcement, run the checked-in workflow on GitHub, confirm
advisory visibility and runner behavior, and protect its aggregate check from
unreviewed policy changes. Reassess each exception before 2026-10-14 and on
SDK/hosting changes. Scanner failure blocks; no `npm audit fix` or automatic
dependency merge is part of this workflow. Development-only findings still
need separate CI/build-input triage.
