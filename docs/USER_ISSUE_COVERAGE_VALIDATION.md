# User issue coverage and validation

This handoff describes the October 2–3 source contract and the checks required
for each production acceptance claim. The website and scoped backend release
results are recorded in [the coverage correction](NOTIFICATION_COVERAGE_CORRECTION.md)
and [its receipt](../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json).
A source test, successful Flow badge or
empty error query does not establish that every user experience was captured.
The existing shared tracker remains the master, and only Dylan receives alerts.
No automatic outreach, historical alert replay, native release or training-rule
change is part of this procedure.

## Testing finalization index

The actual `sweepTestingEventFinalizations` query reads the collection group
`projectionDirty` where `pending == true`. The observed Firestore error explicitly
requires a collection-group ascending index for that field. The checked-in
override adds that index and retains ascending, descending and array collection
indexes. Existing composites and other field overrides remain intact.

`scripts/projection-dirty-index-plan.cjs` is a pure operator planner. Immediately
before an approved live change, read the exact field
`projects/kickai-69dd0/databases/(default)/collectionGroups/projectionDirty/fields/pending`
from the Firestore Admin API. Pass that complete response to `plan(field)`.
If `needsPatch` is true, PATCH only that field with the returned body and
`updateMask=indexConfig`. The planner preserves existing definitions and removes
only their output-only name and state. Do not replace the complete project's
index configuration to repair this one field, or include TTL/rules in the update.

Read back the exact field until the required index is `READY`. Then verify the
actual collection-group query and the next genuine scheduled finalization run.
Index readiness repairs this query prerequisite; it does not prove that every
pending player projection finalized, or that training data/rules changed.

## Website request correlation

The existing fourteen social callable endpoints accept an opaque request
reference: `getSocialAdminDirectory`, `getSocialContext`, `getSocialFeed`,
`getSocialActivity`, `saveSocialPreferences`, `setSocialVisibility`,
`getSocialPeople`, `socialConnection`, `setSocialKudos`, `getSocialComments`,
`saveSocialComment`, `reportSocialActivity`, `moderateSocialActivity` and
`getSocialMedia`. The website generates a fresh diagnostic UUID for every explicit
invocation, including when the caller supplies a `requestId` or `jobId`. These
fourteen endpoints have no caller-supplied diagnostic-ID retry contract. The
wrapper copies the argument object, replaces only its `requestId` and preserves
business fields such as `jobId`; it does not mutate caller data or add fields to
unrelated callable/auth contracts. Internal Firebase transport retries receive
the same copied argument and diagnostic ID. A later explicit invocation gets a
new ID. Malformed positional payloads remain unchanged rather than inventing a
different callable contract, so their client and server failures may lack an
exact shared reference.

The account-bound durable error queue retains the original event ID, request ID,
occurrence time and account when intake is retried after a lost acknowledgement
or account switch. Error-object suppression is request-aware: a reused Error
object from another callable attempt still records that attempt, while an
unscoped global rejection observation does not duplicate a known wrapper capture.
Weak-keyed histories retain at most thirty-two references per surviving Error
object; old local suppression entries can expire without changing durable server
replay checks. Storage clearing, queue limits and unavailable intake can still
prevent capture, as described below.

`functions/social-callable-observation.js` records operation, reference, elapsed
time, safe outcome/error code and the exact authenticated caller UID. It never
uses a requested athlete, client-supplied UID, name or email as the actor. The
client's requested preview athlete is separately authorized by issue intake.
Validation and permission failures remain failed-attempt evidence, with validation
labelled separately. Cancellation is outcome telemetry and does not raise an
incident. Existing canonical AI-log exclusions remain unchanged.

The wrapper preserves known callable errors and exact successful response shapes.
Raw server exceptions receive one safe correlated log and a generic callable error,
avoiding an additional uncorrelated runtime exception copy. Logging failure cannot
fail an otherwise successful user operation. Exact actor/request evidence shares
a canonical occurrence and email permission only when the known operation and
authorized target are compatible. Durable source claims retain replay identity;
bounded branch registries isolate conflicting known endpoints, targets and
anonymous sessions. Missing context cannot choose a known conflicting branch.
Corroborating client/server observations retain their own provenance and context
without replacing canonical actor/target evidence. Unknown actors and ambiguous
overflow remain explicit. Duration is retained in the correlated Cloud Logging
record; it is not a new workbook column.

The null-caller source follow-up retains a bounded `callableOutcome` marker only
from the exact supported generation-1 function's original project log. Operation,
request ID, failed code and category must match the normalized occurrence; an
`action_validation` category requires the corresponding validation code. A
missing or rejected anonymous credential establishes a failed request with an
unknown actor, not automated service work. The accepted Auth UID validator remains
limited to 128 characters; request and target references retain their separate
160-character contract. Public normalization strips a fully shaped forged marker,
and intake rechecks its server source. Original observations, material capture,
summaries and native annotations retain the same distinction. Generic service/AI
logs are unchanged. Historical corrections require exact original structured log
evidence, not an unauthenticated code or a free-text match. The final receipt must
separately confirm the isolated backend and tracker deployment.

For a scoped server release, include `social-callable-observation.js` alongside
the exact existing dependencies for each individual endpoint. Use the
[social scoped workflow](../deployments/social-callables/README.md); previous
targeted releases have differing service/storage helper versions, which must not
be replaced by a common local version inadvertently. Preserve each endpoint's IAM, region,
runtime, environment, limits and unrelated triggers. Deploy only reviewed
endpoints, with a configuration readback. Client changes require the deliberate
application-release workflow and a verified marketing snapshot; preserve the
current marketing bytes, protected application guard and held training baseline.
Use the [explicit Astro application-only procedure](../deployment/ASTRO_APPLICATION_ONLY_RELEASE.md)
to preserve the two freshly verified marketing source documents.
This document itself grants no deployment authorization.

Contract checks cover fresh references for all fourteen endpoints despite supplied
IDs, copied arguments with preserved business job fields, reused Error objects,
global duplicate suppression, bounded object histories, internal transport retry
arguments, durable intake acknowledgement retries, account switches, requested
athletes, blocking validation, cancellation, raw-error redaction, response
preservation and compatible client/server corroboration. Server contract tests
also cover conflicting operations/known targets, anonymous sessions, ambiguity,
replay and both arrival orders. Run:

```text
node --test scripts/projection-dirty-index-plan.test.cjs
node --test functions/social-callable-observation.test.js functions/social-request-issue-correlation.test.js functions/social.test.js
node --test functions/user-issue-callable-classification.test.js functions/user-issue-classification.test.js functions/user-issue-summary.test.js functions/user-issue-observations.test.js functions/user-issue-request-identity.test.js functions/social-callable-observation.test.js functions/social-request-issue-correlation.test.js functions/user-issues.test.js functions/issue-tracker-normalize.test.js functions/issue-tracker-source-observation.test.js functions/issue-tracker-bridge.test.js functions/user-issue-source-packaging.test.js
npm --prefix app test -- src/lib/user-issues.test.ts
```

The twelve-file focused backend/tracker command passed 141 tests, including eight
new end-to-end cases. This proves the source contract and preserved generic-service
controls; it does not replace genuine delivery, fresh cloud publication, Graph
identity approval/semantics or owning-Mac/iPhone/TestFlight crash acceptance.

Also complete the project's TypeScript and guarded release checks. After release,
verify a genuine failed request's exact reference, actor, independent source
evidence and delivered Dylan-only notification against a fresh cloud workbook.
Do not fabricate a user incident or replay an old alert to claim acceptance.

The installed Firebase client currently defaults to 70 seconds while the social
server timeout is 120 seconds. Sequential source reads were a latency candidate
in the reviewed feed implementation, not a demonstrated cause of the recorded
timeout. Use correlated timings and the reviewed feed optimization checks to
establish behavior; increasing a timeout alone is not proof of a repair.

## Native crash export gate

A full read-only Firebase app-list response on October 2 confirmed the active
registration `1:839600313930:ios:bfa3172fbaa7b521e3f8b3`, bundle
`Nolan-Jetter.KickAI`, in project `kickai-69dd0`. The reviewed native candidate is
[`0f0d876aa0686470e92829dc237af7a3c80b0344` on `worktree-user-issue-alerts`](https://github.com/posetek/posetek-mobile-app/tree/worktree-user-issue-alerts).
It contains the Auth-bound `reporter_uid` key and durable reporting changes; the
legacy Crashlytics `user.id` remains a target player document reference. The
candidate has not passed owning-Mac/iPhone/TestFlight acceptance.

The October 2–3 console review confirms **Cloud Logging export On for that one
registered iOS app**. The exact configuration evidence is retained in the
[correction receipt](../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json).
Firebase's documented setting is **Project settings → Integrations → Cloud Logging
→ Link/Manage**. Export is a project service configuration; neither its On state
nor an empty bounded log query establishes genuine exported events. Preserve
optional sessions-export and cost choices in the configuration receipt.
[Firebase export setup](https://firebase.google.com/docs/crashlytics/cloud-logging-export)
notes that event delivery can be delayed or dropped, so no all-events guarantee
is appropriate.

The native candidate already includes a hidden intentional tester crash and a
Release-only Crashlytics dSYM upload phase. The owning Mac/iPhone operator must
compile the chosen candidate, verify signing/build registration and dSYMs,
detach the debugger, trigger a clearly identified test-device crash and relaunch
the app. Verify the genuine symbolicated Crashlytics event, exact build/launch
and original actor key, exported event ID, backend occurrence, Dylan-only
delivery receipt and matching published Excel evidence. Mark it as setup evidence
and keep it distinct from athlete incidents. Repeat the account-switch/offline
relaunch acceptance cases before distributing that native build. [Firebase's Apple
test procedure](https://firebase.google.com/docs/crashlytics/ios/test-implementation)
and [dSYM setup](https://firebase.google.com/docs/crashlytics/ios/get-started)
describe the device and symbol requirements. Windows source review cannot
complete this gate. Do not merge or deploy native rules as a substitute.

General MetricKit payloads and unclean exits do not prove a crash, memory
exhaustion or a known original operator. Their classification follows actual
artifact subtype/evidence. An uploader contact can identify who supplied a
diagnostic, not necessarily who experienced it.

## Coverage limits

These sources cover recorded reports, observed backend failures, instrumented
website attempts and configured native telemetry. Pre-load failures, blocked
network requests, handled errors outside instrumentation, unavailable device
exports, storage clearing/full queues and later arrivals outside a verified
source window can escape capture. Current exact-account contact lookup is
separate from occurrence-time token identity; unverified/missing contacts and
unknown actors remain explicit. Programmers should diagnose from the evidence,
and Dylan handles any user outreach manually.
