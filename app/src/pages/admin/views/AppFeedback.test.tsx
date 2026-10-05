import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppFeedbackQr, AppFeedbackResponses, AppFeedbackRow, AppFeedbackSummary } from "./AppFeedbackContent";
import { normalizeAppFeedbackResponse } from "../lib/appFeedback";
import type { AppFeedbackPage } from "../lib/appFeedback";

vi.mock("../../../lib/firebase", () => ({ cloud: {} }));
import AppFeedback from "./AppFeedback";

const response = normalizeAppFeedbackResponse("response-1", { formVersion: 1, entrySource: "message", answers: { feature: "videosTechnique", ease: "veryHard", obstruction: "broken", comment: '<script>alert("x")</script>\n<img src=x onerror="alert(1)">' }, createdAtMillis: Date.UTC(2026, 9, 3, 17), durationSeconds: 18 });
const page: AppFeedbackPage = { responses: [response], nextCursor: { at: response.createdAtMillis!, id: response.id } };
const noop = () => {};
const responseHtml = (overrides: Partial<Parameters<typeof AppFeedbackResponses>[0]> = {}) => renderToStaticMarkup(<AppFeedbackResponses load={{ kind: "ready", value: page }} pageNumber={1} busy={false} pageError="" onRetry={noop} onPrevious={noop} onNext={noop} {...overrides} />);

describe("private app feedback rendering", () => {
  it("escapes comments, maps answer codes and shows Pacific time without athlete/account joins", () => {
    const html = renderToStaticMarkup(<AppFeedbackRow response={response} />);
    expect(html).toContain("Videos or technique"); expect(html).toContain("Very hard"); expect(html).toContain("Something didn’t work");
    expect(html).toContain("Shared message link"); expect(html).toContain("10:00 AM"); expect(html).toContain("Pacific");
    expect(html).toContain("18 seconds");
    expect(html).not.toContain("<script"); expect(html).not.toContain("<img"); expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("response-1"); expect(html).not.toContain("/admin/accounts/player/");
  });

  it("marks skipped items and an absent comment clearly", () => {
    const html = renderToStaticMarkup(<AppFeedbackRow response={normalizeAppFeedbackResponse("x", { answers: { feature: "notUsed", ease: null, obstruction: null, comment: "" } })} />);
    expect(html).toContain("Haven’t used it yet"); expect(html.match(/Skipped/g)).toHaveLength(2);
    expect(html).toContain("No comment added."); expect(html).toContain("Date unavailable"); expect(html).not.toContain("Time on form");
  });

  it("shows an escaped signed-in account snapshot privately without implying a verified person or joining a player", () => {
    const attributed = normalizeAppFeedbackResponse("account-response", { ...response, formVersion: 2, identityMode: "account",
      author: { uid: '<uid onclick="run()">', displayName: '<img src=x onerror="run()">', email: 'person+<tag>@example.com', emailVerified: true } });
    const html = renderToStaticMarkup(<AppFeedbackRow response={attributed} />);
    expect(html).toContain("Submitted by"); expect(html).toContain("Signed-in account"); expect(html).toContain("Email verified");
    expect(html).toContain("&lt;img"); expect(html).toContain("person+&lt;tag&gt;@example.com"); expect(html).toContain("Account ID:");
    expect(html).toContain("&lt;uid"); expect(html).not.toContain("<img"); expect(html).not.toContain("Verified person");
    expect(html).not.toContain('href='); expect(html).not.toContain("/admin/accounts/player/");
  });

  it("uses email or exact UID when no name is available and labels unverified email accurately", () => {
    for (const author of [{ uid: "uid-with-email", displayName: null, email: "user@example.com", emailVerified: false },
      { uid: "uid-only", displayName: null, email: null, emailVerified: false }]) {
      const html = renderToStaticMarkup(<AppFeedbackRow response={normalizeAppFeedbackResponse("x", { ...response, formVersion: 2, identityMode: "account", author })} />);
      expect(html).toContain(`<strong>${author.email ?? author.uid}</strong>`);
      expect(html).toContain("Signed-in account"); expect(html).toContain(author.uid);
      expect(html).not.toContain("Anonymous"); expect(html).not.toContain("Unknown player");
      if (author.email) expect(html).toContain("Email not verified");
    }
  });

  it("keeps historical and future anonymous responses explicit without fabricating account associations", () => {
    for (const formVersion of [1, 2]) {
      const html = renderToStaticMarkup(<AppFeedbackRow response={normalizeAppFeedbackResponse("x", { ...response, formVersion, identityMode: "anonymous",
        author: { uid: "never-disclose", displayName: "Never infer this name", email: "never@example.com", emailVerified: true } })} />);
      expect(html).toContain("Submitted by"); expect(html).toContain("Anonymous"); expect(html).toContain("account linked");
      expect(html).not.toContain("never-disclose"); expect(html).not.toContain("never@example.com");
      expect(html).not.toContain("Never infer this name"); expect(html).not.toContain("Signed-in account");
      if (formVersion === 1) expect(html).toContain("Historical anonymous response");
    }
  });

  it("keeps the current page visible after a next-page error and exposes retry/disabled pagination states", () => {
    const html = responseHtml({ pageNumber: 2, pageError: "App feedback could not be loaded. Please retry." });
    expect(html).toContain("The current page is still shown."); expect(html).toContain("Videos or technique"); expect(html).toContain('role="alert"'); expect(html).toContain("Page 2");
    expect(responseHtml()).toMatch(/disabled="">Previous/);
    expect(responseHtml({ load: { kind: "ready", value: { ...page, nextCursor: null } } })).toMatch(/disabled="">Next/);
    const busy = responseHtml({ busy: true }); expect(busy.match(/disabled=""/g)).toHaveLength(2); expect(busy).toContain("Loading page…");
    const failed = responseHtml({ load: { kind: "error", message: "Sign in again, then retry." } });
    expect(failed).toContain("Retry responses"); expect(failed).toContain("Sign in again");
  });

  it("distinguishes empty results from loading and reports counts as sessions", () => {
    expect(responseHtml({ load: { kind: "ready", value: { responses: [], nextCursor: null } } })).toContain("No feedback yet");
    expect(responseHtml({ load: { kind: "loading" } })).toContain("Loading responses…");
    const html = renderToStaticMarkup(<AppFeedbackSummary load={{ kind: "ready", value: { opened: 100, started: 60, submitted: 30 } }} onRetry={noop} />);
    expect(html).toContain("30%"); expect(html).toContain("50%"); expect(html).toContain("last 90 days"); expect(html).toContain("more than one session");
    expect(html).not.toContain("unique players");
    expect(renderToStaticMarkup(<AppFeedbackSummary load={{ kind: "error", message: "Please retry." }} onRetry={noop} />)).toContain("Retry counts");
  });

  it("labels synthetic preview and keeps share links available for manual copy", () => {
    const html = renderToStaticMarkup(<AppFeedback preview />);
    expect(html).toContain("Synthetic preview"); expect(html).toContain("https://posetek.net/feedback?source=qr");
    expect(html).toContain("https://posetek.net/feedback?source=message"); expect(html).toContain('readOnly=""');
    expect(html).toContain("Copy message feedback link"); expect(html).not.toContain("Send message");
  });

  it("renders the generated QR image with accessible text, a local SVG download and a recoverable failure state", () => {
    const image = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E";
    const html = renderToStaticMarkup(<AppFeedbackQr load={{ kind: "ready", value: image }} onRetry={noop} />);
    expect(html).toContain('alt="QR code for the optional PoseTek app feedback form"');
    expect(html).toContain('download="posetek-app-feedback-qr.svg"'); expect(html).toContain(image);
    expect(html).not.toMatch(/src="https?:/);
    const failed = renderToStaticMarkup(<AppFeedbackQr load={{ kind: "error", message: "The QR code could not be created." }} onRetry={noop} />);
    expect(failed).toContain("Retry QR code"); expect(failed).toContain("You can still copy the QR link"); expect(failed).toContain('role="alert"');
  });
});
