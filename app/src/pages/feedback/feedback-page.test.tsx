import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackPage, { FeedbackForm, FeedbackIdentityNotice, FeedbackSignInGate, FEEDBACK_QUESTIONS } from "./FeedbackPage";
import { emptyFeedbackAnswers } from "./feedback-session";
import type { FeedbackAnswers, FeedbackStep } from "./feedback-session";

function renderForm(step: FeedbackStep, answers: FeedbackAnswers = emptyFeedbackAnswers(), retry = false) {
  return renderToStaticMarkup(<FeedbackForm step={step} answers={answers} saving={false} retry={retry}
    error={retry ? "Your answers are still here. Check your connection and retry sending." : ""}
    onChoose={() => {}} onComment={() => {}} onNext={() => {}} onSkip={() => {}} onBack={() => {}} />);
}

describe("public feedback form", () => {
  it("uses the agreed words and native keyboard-accessible choices in all three steps", () => {
    for (const step of [0, 1, 2] as const) {
      const html = renderForm(step);
      expect(html).toContain(`<legend tabindex="-1">${FEEDBACK_QUESTIONS[step].question}</legend>`);
      expect(html).toContain(`Question ${step + 1} of 3`);
      expect(html).toContain("Skip question");
      expect(html.match(/type="radio"/g)?.length).toBe(FEEDBACK_QUESTIONS[step].choices.length);
      expect(html).not.toContain("required");
      for (const [value, label] of FEEDBACK_QUESTIONS[step].choices) {
        expect(html).toContain(`value="${value}"`);
        expect(html).toContain(`<span>${label}</span>`);
      }
    }
  });

  it("offers back navigation after the first question", () => {
    expect(renderForm(0)).not.toContain("←</span> Back");
    expect(renderForm(1)).toContain("←</span> Back");
    expect(renderForm(2)).toContain("←</span> Back");
    expect(renderForm(3)).toContain("←</span> Back");
  });

  it("lets players confirm that they have not used the app without asking ratings", () => {
    const html = renderForm(0, { ...emptyFeedbackAnswers(), feature: "notUsed" });
    expect(html).toContain("Send feedback");
    expect(html).toContain("without rating the app");
    expect(html).not.toContain("How easy was it");
    expect(html).not.toContain("Anything else we should know?");
  });

  it("keeps writing optional with a label, limit and privacy reminder", () => {
    const html = renderForm(3, { ...emptyFeedbackAnswers(), comment: "The buttons were easy to tap" });
    expect(html).toContain("Anything else we should know?");
    expect(html).toContain("You can leave this blank");
    expect(html.toLowerCase()).toContain('maxlength="1000"');
    expect(html).toContain('for="feedback-comment"');
    expect(html.toLowerCase()).toContain('autocomplete="off"');
    expect(html).toContain("Please don’t include names, contact details or private information");
    expect(html).not.toContain("required");
  });

  it("preserves the accepted answer snapshot during retry and clearly names the retry action", () => {
    const html = renderForm(3, { ...emptyFeedbackAnswers(), comment: "Still here" }, true);
    expect(html).toContain("Still here");
    expect(html).toContain("Retry sending");
    expect(html).toContain('role="alert"');
    expect(html).toContain("<fieldset disabled");
  });

  it("renders independently from application auth, router and navigation injectors", () => {
    const html = renderToStaticMarkup(<FeedbackPage search="?preview=1&source=qr&playerId=secret" />);
    expect(html).toContain("Preview · nothing you enter here will be sent");
    expect(html).toContain("The PoseTek team reads your feedback");
    expect(html).toContain("No account is linked and nothing you enter will be sent");
    expect(html).toContain('href="/privacy#app-feedback"');
    expect(html).not.toContain("secret");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("type=\"email\"");
  });

  it("prominently discloses automatic account attribution without a consent checkbox", () => {
    const html = renderToStaticMarkup(<FeedbackIdentityNotice account={{ uid: "private-uid", label: "Player example" }} />);
    expect(html).toContain("Your signed-in account <strong>Player example</strong> will be included with this feedback and visible to PoseTek administrators.");
    expect(html).not.toContain("private-uid");
    expect(html).not.toContain("checkbox");
    const anonymous = renderToStaticMarkup(<FeedbackIdentityNotice account={null} />);
    expect(anonymous).toContain("No account is linked to this response");
    expect(anonymous).toContain("anonymously");
  });

  it("requires sign-in from workout/results while preserving a source-only return link", () => {
    const html = renderToStaticMarkup(<FeedbackSignInGate source="workout" />);
    expect(html).toContain("Sign in to give feedback");
    expect(html).toContain('href="/signin?returnTo=%2Ffeedback%3Fsource%3Dworkout"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("anonymously");
  });
});
