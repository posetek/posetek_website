# Delegated Outlook read proxy

This deployed route lets the tracker read Dylan's mailbox through the existing
Power Automate Outlook connection. It does not establish an Exchange application
RBAC role. No import, mailbox read, deployment, setting change or shared-workbook
cutover is implied by the offline tests.

The dedicated Graph identity flow has since passed read-only semantic acceptance,
and the six tracker functions passed exact version-six source/configuration/IAM
checks. Identity settings and retained-alias publication remain pending. Use the
[current verification checkpoint](../../deployment/OUTLOOK_IDENTITY_AUTOMATION_PROGRESS.json)
for the capacity repair and remaining physical cloud acceptance gates. The
following version-five description records the earlier correction; its reader
header alone remains insufficient proof of mailbox identity.

For the October 2–3 correction, the tracker six-function source release was version
5 with the mail-identity cutover flag explicitly disabled. The old reader's
ImmutableId preference and corrected inputs were saved through code view; its
actual export passed exact runtime-definition review and the flow is On. These
checks do not prove canonical mailbox IDs or same-item alias equivalence. The
dedicated Graph connection and semantic acceptance were still pending. Do not
claim all reader/translation changes passed, or enable the separate Graph ID
translation route from a generated ZIP. Preserve the existing delegated route,
original email rows and unconfirmed aliases until exact identity proof passes.
See [the current handoff](../../docs/NOTIFICATION_COVERAGE_CORRECTION.md) and
[correction receipt](../../deployment/USER_ISSUE_COVERAGE_CORRECTION_PRODUCTION.json)
for that dated pending state. No broader mailbox authorization
is inferred.

## Historical initial reader acceptance

The actual reader `950eee98-d71a-48b8-b0b3-5fa5f2bd3c31` is now imported. Its v3
saved export passed exact validation at `2026-10-02T08:45:14Z` after the two-action
collection-path correction below. The reader-only validator also accounts for
Microsoft omitting empty `runAfter` at exactly the two branch-entry actions;
null, nonempty and other dependency changes still refuse. Read-only acceptance
passed at `2026-10-02T09:12:05.266Z`: 72 pages, 143 messages and replay of all 128
then-recorded legacy aliases using the connector-returned IDs. Those observations
did not establish authoritative Graph ID types or canonical same-item mappings.
The private audit checked 206
original responses. The receipt explicitly counts one unrelated message whose
provider response omitted headers; headers remain mandatory for every relevant
message, the Inbox reference, legacy alias fetches and fresh replay. Body, folder
and read-state remain mandatory for every item. No capture/publication checkpoint
was advanced, and no application RBAC claim is made. A different authenticated
principal was not runtime-tested. Guarded tracker activation passed at
`2026-10-02T10:13:41.205Z`; independent shared-master revision-eight readback
subsequently passed. These are historical checkpoints. Current capture/publication
coverage is recorded separately in the correction receipt.

## Read-only flow contract

`build_mail_read_flow.py` creates a new private import ZIP. Its HTTP trigger permits
only service principal object `cd9fa4b9-7716-4534-9cf1-620422f48aba`. The one external
operation is Office 365 Outlook `HttpRequest`, with `Uri` from the validated input,
`Method: GET`, and `CustomHeader1` set to
`Prefer: IdType="ImmutableId", outlook.body-content-type="html"`. It has no supplied
method, body or additional headers and no sending, marking, moving, deleting or
Excel action. Connector retries are disabled. Parse JSON, Compose and Response
use Microsoft's supported Secure Inputs setting, which also hides their outputs;
the trigger, Query operations and Outlook connector secure both. The unsupported
If security flags are absent: If receives only a boolean from a secured Compose
predicate, so the raw URL and message ID are evaluated inside the secured action.

The flow validates the object schema and independently rejects characters and
routes outside the exact `https://graph.microsoft.com/v1.0/users/dylank@posetek.net/messages`
collection or a single message ID. `%40` in the fixed user segment is supported.
Message IDs allow base64/url-safe characters and encoded plus/equal only. Path
traversal, encoded separators, other users, `/me`, custom ports, credentials and
fragments are rejected. Query bytes remain opaque: the accepted full nextLink is
sent unchanged. Unknown Graph URL shapes stop capture for review.

Trigger concurrency control is deliberately absent: this tenant rejected a
synchronous Response when trigger concurrency was enabled during writer setup.
This flow performs GET only. Backend source leases, two-page budgets, 45-second
read deadlines, fixed receipt windows and separate checkpoints remain the bounds;
alias acceptance reads are sequential. The response is synchronous. An initial
202 is always a failed read, never a cue to poll or evidence of completion.

The transport reuses `createFlowTokenProvider` and its verified resource scope
`https://service.flow.microsoft.com//.default`. Only HTTP 200 with an exact echoed
request UUID, fixed mailbox, schema 1, actual connector status 200 and complete
Graph object is accepted. Existing Graph message/window/nextLink validation then
runs. The flow returns only bounded error categories on failures. No cursor can
advance on denial, timeout, malformed output or changed read-provider proof.

## Build and activation

```powershell
python deployments/issue-tracker/build_mail_read_flow.py --output .netlify/mail-read-UNIQUE.zip --private-config .netlify/mail-read.config.private.json
```

Private configuration permits only `outlookConnectionName`. Without it the ZIP is
an explicit template. The package requests creation as a new stopped flow; actual
import state, native save eligibility, caller and connection must be verified in
the saved export and UI before invocation. A connection label alone is insufficient.

The endpoint has its own `ISSUE_TRACKER_MAIL_READ_FLOW_ENDPOINT` secret. The arrival
and source-capture functions also bind the existing `ISSUE_TRACKER_FLOW_TENANT_ID`,
`ISSUE_TRACKER_FLOW_CLIENT_ID`, `ISSUE_TRACKER_FLOW_CLIENT_SECRET` and Graph-route
secrets. Writer and Microsoft sending endpoints are separate. Rebuild the isolated
backend package from reviewed current source before deployment; older prepared
bundles lack this provider seam and the accepted OAuth/polling corrections.

After live read/alias acceptance, the reviewed settings require:

```json
{
  "mailReadProvider": "power_automate",
  "graphMailboxVerified": false,
  "mailReadProxyVerified": true,
  "mailReadProxyProof": {
    "schemaVersion": 1,
    "verified": true,
    "authorization": "delegated_proxy_route",
    "tenantId": "4fa074df-8075-45d3-a2ba-a94e9b3f2ea5",
    "clientId": "59fa6f0a-7982-410e-a006-606bdc05f310",
    "callerObjectId": "cd9fa4b9-7716-4534-9cf1-620422f48aba",
    "connectionAccount": "dylank@posetek.net",
    "flowId": "ACTUAL_SAVED_FLOW_GUID",
    "connectionName": "ACTUAL_VERIFIED_OUTLOOK_CONNECTION",
    "endpointSha256": "NORMALIZED_INVOKE_URL_SHA256",
    "exportSha256": "REVIEWED_SAVED_EXPORT_SHA256"
  }
}
```

Existing mailbox, alias, native-seed, writer connection and source-recovery gates
still apply. The guarded seed/cutover helper must support this explicit delegated
proof before activation; its older app-RBAC proof is not interchangeable. Keep
production recovery disabled while these gates are outstanding.

Persisted Outlook capture state binds the selected provider/proof. Changing it
during a read or page cannot advance completeness. Changing it between runs holds
the existing cursor pending deliberate reviewed migration; it does not silently
start over. Independent backend capture remains available. A proof change therefore
needs a planned capture-state migration, not merely a settings toggle.

Live acceptance must demonstrate: saved definition/connection and off state;
approved principal succeeds and unauthenticated/wrong-principal requests fail;
other mailbox routes are rejected before connector access; forced small-page
pagination preserves full nextLink and full bodies. Header arrays remain required
for the Inbox reference, all legacy identities/replay and relevant notices;
provider-native header absence on unrelated paged messages is explicitly counted
and preserved without inventing an empty array. Read/non-Inbox messages are
included; every frozen legacy Outlook ID resolves to an ImmutableId without
collisions; replay keeps original row IDs. Do not set `mailAliasesVerified` before
the full current ledger's IDs pass. Connector response shape and tenant behavior
remain native acceptance gates; offline expression evaluation is not that proof.

## Verification and references

```powershell
& 'C:/Program Files/nodejs/node.exe' --test functions/issue-tracker-mail-read-proxy.test.js functions/issue-tracker-source-capture.test.js
python -m unittest discover -s deployments/issue-tracker -p build_mail_read_flow_test.py -v
```

The tests cover emitted route expressions, package isolation and fixed GET/header/
caller/security settings, opaque nextLinks, HTTP failures, response identity,
explicit provider selection, proof revocation and mid-window cursor preservation.

Native v2 acceptance read the known Inbox item successfully but the first
collection request failed before connector access: `substring` rejected a start
at the end of the path. The collection-safe correction uses `slice` for the ID
tail and scans one allowed sentinel in the ID-character check, keeping its
`range` count positive. Original request URLs and the exact route predicate are
unchanged. The expression model now rejects out-of-bounds substring starts and
zero range counts, and covers collection, opaque paging and empty-ID paths.
The corrected saved-flow export and full native read acceptance described above
are verified. A successful single-message read alone does not prove mailbox coverage.

Microsoft documents the [Outlook HttpRequest parameters and supported Graph paths](https://learn.microsoft.com/en-us/connectors/office365connector/#send-an-http-request),
[supported security settings by action type](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history-by-using-obfuscation),
[workflow expression functions](https://learn.microsoft.com/en-us/azure/logic-apps/expression-functions-reference),
[message listing](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
and [ImmutableId preference](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
