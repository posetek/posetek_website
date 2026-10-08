# Offline dependency policy candidate

`dependency_audit_policy.py` is deliberately outside active GitHub workflows.
It accepts npm's `audit --omit=dev --json` report, the matching npm v3
lockfile, npm's exit status, and a separately reviewed exception file. It
prints every production high/critical advisory path, blocks a newly seen
high/critical path or severity increase, and treats scanner errors, malformed
reports, missing graph nodes, and invalid or expired exceptions as incomplete
evidence. It never edits packages, lockfiles, or exceptions.

`run_dependency_audit_candidate.py` supplies a fixed scope (`app`, `functions`,
or `legacy`) to `npm audit --omit=dev --json`, captures its exit code and feeds
both into the validator. It runs no install or upgrade command, times out, and
returns a nonzero result on scanner failure. Its `--baseline` argument is
mandatory; until owners and dates are approved there is deliberately no file
to pass. This runner is not referenced by an active workflow.

An exception file has `schema: 1` and an `exceptions` array. Each entry must
name the advisory URL, root-to-package `path`, approved severity, named owner,
reason, and ISO `expires` date. The parser rejects placeholder owners/reasons.
No production exception file is committed: existing findings lack confirmed
maintainer owners and deadlines, so treating a generated snapshot as approved
would silently waive them. Any baseline addition or renewal needs explicit
review; because this is ordinary repository-controlled CI code, it is not a
tamper-resistant protection against someone who can change the policy itself.

The policy was exercised against saved successful npm audit responses and the
current lockfiles on 2026-10-07. The current `app/package-lock.json` SHA-256 is
`79b13d965e78c4ed2220d56d7231cb94e270db8fc647c4bcad50a4ece75e6f66`;
`functions/package-lock.json` is
`a803ea5ae6cd4068ef4310a1df37a7f5150b432514167f3e3513db8406dc969b`;
and `functions/legacy-upload-processor/package-lock.json` is
`451e9a8460e37c75d4d0beff6810645092012712502fde33d074bf4412b8b250`.
The matching saved production reports contained 4, 18, and 18 vulnerable
package nodes respectively. The policy resolved 1, 14, and 15 high/critical
advisory-path pairs; these are different units from npm's package-node counts.
The website pair includes `firebase -> @firebase/firestore -> @grpc/grpc-js`.
None of these pairs has an approved owner/deadline exception. A fresh npm audit
attempt in the local sandbox failed DNS, so this is a parser/lock-graph check,
not a claim of fresh registry evidence or a green release gate.

Before hosted activation, maintainers must review advisory applicability and
assign concrete owners, remediation dates, and expiring exceptions for any
retained finding. Run the scanner with `--omit=dev` for each lockfile, retain
both stdout JSON and its exit status, then feed them to the validator. Scanner
failure must block; no `npm audit fix` or automatic dependency merge is part of
this candidate. Development-only findings need separate CI/build-input triage.
