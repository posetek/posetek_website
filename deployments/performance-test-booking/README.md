# Performance test requests: scoped backend draft

This is an **unpublished review draft**. No booking endpoint, sender acceptance,
email receipt or production release is claimed. The user's confirmed destination
is `dylank@posetek.net`. Request-for-confirmation mode is the draft assumption;
the legacy page's Stripe placeholders do not represent a usable payment service.

## Scope and contract

The independent `performance-test-booking` codebase exports only
`requestPerformanceTestBooking`. Root `functions/index.js` is unchanged. Never
deploy all root functions to install this endpoint. The source reuses the existing
`RESEND_API_KEY` Secret Manager binding, with a separate guarded sender
`PoseTek Bookings <bookings@alerts.posetek.net>`. It does not change workout email
transport, webhooks, records, settings, sender, DNS or recipient configuration.

POST JSON from `https://posetek.net` or `https://www.posetek.net`:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "fullName": "Example Contact",
  "email": "contact@example.com",
  "appointmentDate": "2026-10-02",
  "timeSlot": "flexible",
  "timezone": "America/Los_Angeles",
  "bookingType": "individual",
  "notes": "Please discuss location.",
  "website": ""
}
```

Generate a fresh UUID v4 per new request; the example is not a production key.
Keep that same ID and unchanged payload for retry. The page retains only the UUID
and a SHA-256 content digest in session storage to recover retries after reload;
it does not store form values there. In-memory retries remain available if browser
storage is blocked. Changing request details requires a new
ID; warn before making another request after an uncertain response.

- Name: required, at most 120 characters. Email: required, at most 254.
- Preferred date: an actual `YYYY-MM-DD`, today through 366 days ahead in Pacific
  time for a new request. Prior identical requests remain retryable after their
  preferred date passes.
- Preferred time: `flexible` or half-hour values `09:00` through `17:00` inclusive.
  These are preferences, not available/reserved slots. Timezone is exactly
  `America/Los_Angeles`.
- Request type: `individual`, `team`, or `other`; omitted means `individual`.
- Notes: optional, at most 1,500 characters. `website`: optional empty honeypot.
  Unexpected fields, controls and bodies over 8 KiB are rejected.
- 200 `{requestId,status:"received"}` means the request was durably saved and the
  provider accepted its email. It does not establish delivery, reading, a reserved
  appointment or a customer confirmation email.
- 503 `delivery_unconfirmed` exposes only a safe message, reference and optional
  retry delay. The UI must retain the ID/payload, honor `Retry-After`, offer retry
  and the direct email address, and never show successful submission for this
  response. There is no background delivery worker.
- 400: invalid request; 409: same ID with changed payload; 429: new-request quota.
  Unsupported origin/method/media type/body size returns 403/405/415/413.

No customer autoresponse, charge, calendar availability or reservation is created.
The visitor's validated address is Reply-To, never the sender or destination.
Local and hosted-preview browser tests must mock the request. Preview origins are
deliberately excluded from the production endpoint allowlist. The endpoint URL
after a verified scoped release would be
`https://us-central1-kickai-69dd0.cloudfunctions.net/requestPerformanceTestBooking`.

## Persistence and recovery

Only two new private Firestore roots are used:

- `performanceTestBookingRequests/{requestId}` stores normalized contact and
  preference data, frozen email payload, payload fingerprint, timestamps,
  send lease, attempt count and provider-acceptance receipt.
- `performanceTestBookingLimits/{hashedIp}` stores a SHA-256 hash of the
  platform-provided IP, five-new-requests-per-15-minute quota and logical expiry.
  Raw IPs and forwarding headers are not stored. Hashing is not anonymization.

The normalized request fingerprint must match for a retry. A 60-second
transactional lease prevents concurrent sends, including retries at terminal
attempt/window boundaries. Every attempt uses the same frozen payload and Resend
idempotency key. Failed/uncertain attempts wait at least 30 seconds, honoring a
provider retry delay up to one hour. Accepted receipts short-circuit later retries.
No contact details, raw provider responses or credentials are logged or returned.
The transport fields follow Resend's [send-email API](https://resend.com/docs/api-reference/emails/send-email);
the 23-hour cutoff stays inside its documented [24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).

Unresolved attempts stop at 23 hours from the first send, 12 attempts, or a
permanent provider failure and become `attention`. They are not silently retried
beyond the provider's idempotency window. A visitor who leaves after an error may
have an unsent durable request: no unattended worker or inbox delivery monitoring
is included in this draft.

Authorized operators inspect a request by its exact reference in Firestore and
review `deliveryStatus` (`sending`, `pending`, `accepted`, `attention`), timestamps,
attempt count and safe failure code. Bounded status queries can identify pending
requests for manual follow-up. Inspect the provider evidence using the stable key
and saved message ID before any recovery. Never delete a receipt, assign a new ID
or blindly resend an uncertain email. A permanent failure requires correcting the
specific configuration and reviewed recovery; it cannot be reset by the visitor.
An `accepted` request has no automatic delivery/bounce status integration; the
existing workout webhook ignores messages that do not match workout jobs.

No automatic deletion or TTL policy is installed. Preserve request receipts for
deduplication; determine retention and cleanup policy separately. The new roots
must remain denied to direct clients by the canonical mobile-repository rules.
Verify this against the actual canonical rules before any backend release. Do not
copy rules into this repository or publish them from here.

## Local validation

All commands below are local mocked tests; they never contact Resend:

```powershell
node --test functions/performance-test-booking.test.js
python -B deployments/performance-test-booking/test_prepare.py
```

The service tests cover fixed recipient/Reply-To, validation and timezone bounds,
honeypot, HTTP restrictions, hashed IP limits, duplicate/conflicting requests,
concurrent final attempts, provider failure and uncertain persistence, bounded
retry, immutable message/idempotency, and the isolated endpoint definition.
The release-helper tests use synthetic inventories and archives to check exact
source, unrelated-function preservation, transport, runtime, IAM and secret scope.
They are not production acceptance or Firestore emulator verification.

## Preparation and later authorized release

`prepare.py` reuses the repository's immutable source/inventory/IAM auditor. It
does not deploy or send email. It copies exactly the scoped entrypoint, three
booking modules and existing dependency lockfiles. It captures any prior endpoint
for recovery and rejects unrelated function inventory changes during verification.

Before a separately authorized release, verify the real Resend domain and existing
domain-restricted secret, denied client access to both roots, the public endpoint's
platform IP behavior, and the new booking sender. Do not substitute placeholder
secrets or claim the workout sender's prior acceptance as this sender's acceptance.
Live acceptance that sends a synthetic email must be explicitly authorized.

Use a fresh ignored run directory and an existing authorized owner session file
following the Expanded Insights operations workflow. Do not print credentials.

```powershell
python -B deployments/performance-test-booking/prepare.py --mode prepare --run-dir .netlify/performance-test-booking/RELEASE_ID --credential-file .netlify/OWNER_SESSION.json
npm --prefix .netlify/performance-test-booking/RELEASE_ID/source ci --ignore-scripts --no-audit --no-fund
```

Only after reviewing that exact prepared source and obtaining release authorization:

```powershell
firebase deploy --project kickai-69dd0 --config .netlify/performance-test-booking/RELEASE_ID/firebase.json --only functions:performance-test-booking --non-interactive
python -B deployments/performance-test-booking/prepare.py --mode verify --run-dir .netlify/performance-test-booking/RELEASE_ID --credential-file .netlify/OWNER_SESSION.json
```

The scoped config contains no Firestore/Storage rules, gateway, scheduler or
unrelated exports. Publish the frontend only after backend behavior and the
authorized synthetic send have been reviewed; an unpublished endpoint is not a
working request form. Record verified release and recovery evidence in a new
receipt rather than altering historical workout or Stripe receipts.
