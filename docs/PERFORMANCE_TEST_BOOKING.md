# Performance test booking refresh

## Scope and current status

September 30, 2026 review candidate. This work updates the page reached by the
public site's **Book a test / Book a performance test** links. The existing links
already point to the correct route, so the homepage and Coaches page do not need
to be rebuilt for this change.

The user confirmed `dylank@posetek.net` as the destination for booking requests.
The review draft uses a request-for-confirmation flow: a preferred date and time
are not availability, a reservation, or a payment. The previous page had Stripe
placeholder credentials, generated times without checking availability, and no
staff booking email. The choice between a request and paid reservation was asked;
request mode is the stated draft assumption pending any further direction.

Implementation alone does not publish the page or enable the new endpoint.
Production release and actual inbox delivery must be recorded separately.

The September 30 user-issue alert release went live during this work. Its committed
source and reconciled baseline were merged into the booking branch, and the exact
matching release artifact was used for composition. The booking candidate is based
on `6abd8f957e046e8059376091`; it preserves all 1,386 other protected files and both
marketing documents. It does not roll back the concurrent issue-alert update.

## Design reference and decisions

The current Players and Coaches pages are the visual reference. The booking page
uses their dark green canvas (`#04130e`), lime actions (`#b7f34a`), off-white text,
green borders, Barlow Condensed headings, Inter copy, and IBM Plex Mono labels.
The form remains the primary interaction, with introductory context alongside it
on desktop and above it on mobile. No stock or generated imagery is needed.

| Decision | Source | Purpose |
| --- | --- | --- |
| Palette, typography, brand mark, compact buttons | `home.scss`, `MarketingHeader.tsx`, live Players page | Continue the existing public identity |
| Preferred date/time and pending-confirmation language | Existing booking audit; request-mode draft assumption | Avoid claiming unverified availability or a confirmed appointment |
| Recipient `dylank@posetek.net` | Explicit user answer | Send each request to the intended inbox |
| Labels, visible focus, inline errors, preserved form values | Refero form craft and existing project accessibility constraints | Support keyboard, phone, and retry workflows |
| Self-contained legacy HTML and a scoped release composer | Current protected release architecture | Change the booking page without rebuilding the application |

## Submission contract

The page posts JSON to `requestPerformanceTestBooking` in project `kickai-69dd0`.
The request includes a UUID, contact name/email, preferred date/time, Pacific
timezone, request type, optional notes, and a honeypot. The server fixes the
recipient; client input cannot select another destination. The contact email is
used as Reply-To so staff can respond to the person making the request.

Only confirmed provider acceptance yields a successful request receipt. It does
not establish inbox delivery or reserve an appointment. Failed or uncertain
sends retain a durable server record and return an error; an unchanged retry
reuses the same request identity and provider idempotency key. The page does not
send customer confirmation emails or promise a price, duration, or response time.
Only the random request reference and a SHA-256 content digest are kept in session
storage for reload recovery; contact details and form values are not stored there.

Read `deployments/performance-test-booking/README.md` for the scoped backend
preparation, limits, unresolved-send handling, and release requirements. Existing
workout notification jobs and their provider adapter are outside this scope.

## Preview and release composition

The ordinary preservation build intentionally retains the published booking
bytes. A booking release uses the separate `scripts/build-booking-release.mjs`
over a freshly verified `production-dist`. It verifies the current live
application and all protected baseline files before replacing only
`/bookperformancetest.html`. It then verifies every other output byte and writes
an ignored receipt at `.netlify/booking-release-build.json`.

```powershell
node --test scripts/booking-release.test.mjs scripts/homepage-preview.test.mjs scripts/production-baseline.test.mjs
node scripts/build-booking-release.mjs
node scripts/test-production-entry.cjs --booking-release --http-only
node scripts/serve-astro-preview.mjs
```

The composed page is available at
`http://127.0.0.1:4175/bookPerformanceTest.html`, including the lowercase and clean
URL aliases. The production endpoint is not a local test stub; browser form
verification must use an isolated local mock to avoid sending real requests.

For release, review the exact Netlify draft, deploy only the scoped booking
function, verify configured recipient and sender, and perform an explicitly
authorized test email. Promote the reviewed artifact without rebuilding it.
Reconcile the preservation baseline only after verifying the published artifact;
otherwise a later ordinary build would restore the previous booking page. Keep
the existing homepage, Coaches page, application, Firebase rules, gateway, and
training data intact. Do not deploy all root Firebase functions.

## Verification of the review candidate

- 38 Node checks passed across booking delivery, provider/HTTP contracts, booking
  composition, preview aliases and production preservation; six mocked Python
  release-helper checks passed.
- The exact composed artifact passed two homepage routes, three Coaches routes,
  five booking aliases, 25 application routes and 1,222 referenced asset checks.
  This is not authenticated application acceptance.
- Browser review covered desktop, 768px tablet, 390px phone and 320px phone
  viewports, with no horizontal overflow. Required-field validation, focused
  inline error feedback, field retention, a simulated 503 followed by success,
  and the pending-confirmation receipt were checked.
- The isolated loopback fixture recorded identical request IDs and payloads for
  unchanged retries and for re-entry after page reload. No actual email was sent.
- Existing Clarity integration remains present; no payment SDK, new frontend
  dependency, price or unverified test duration was added.
