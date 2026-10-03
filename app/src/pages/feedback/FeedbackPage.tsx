import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  createFeedbackSession,
  emptyFeedbackAnswers,
  FEEDBACK_COMMENT_LIMIT,
  nextFeedbackStep,
  readFeedbackEntry,
} from "./feedback-session";
import type { FeedbackAnswers, FeedbackStep } from "./feedback-session";
import "./feedback.scss";

export const FEEDBACK_QUESTIONS = [
  {
    field: "feature",
    question: "Last time you used PoseTek, what did you use?",
    choices: [
      ["results", "Results"], ["workouts", "Workouts"], ["aiCoach", "AI Coach"],
      ["videosTechnique", "Videos or technique"], ["other", "Something else"], ["notUsed", "Haven’t used it yet"],
    ],
  },
  {
    field: "ease",
    question: "How easy was it to do what you wanted?",
    choices: [
      ["veryHard", "Very hard"], ["hard", "Hard"], ["inBetween", "In between"],
      ["easy", "Easy"], ["veryEasy", "Very easy"], ["notSure", "Not sure"],
    ],
  },
  {
    field: "obstruction",
    question: "Did anything get in your way?",
    choices: [
      ["none", "No"], ["find", "Couldn’t find something"], ["understand", "Didn’t understand something"],
      ["broken", "Something didn’t work"], ["other", "Other"],
    ],
  },
] as const;

interface FeedbackFormProps {
  step: FeedbackStep;
  answers: FeedbackAnswers;
  saving: boolean;
  retry: boolean;
  error: string;
  onChoose: (field: "feature" | "ease" | "obstruction", value: string) => void;
  onComment: (value: string) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

export function FeedbackForm({ step, answers, saving, retry, error, onChoose, onComment, onNext, onSkip, onBack }: FeedbackFormProps) {
  const titleRef = useRef<HTMLLegendElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const firstStepRef = useRef(true);
  useEffect(() => {
    if (firstStepRef.current) { firstStepRef.current = false; return; }
    titleRef.current?.focus();
  }, [step]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const question = step === 3 ? null : FEEDBACK_QUESTIONS[step];
  const submittingUnused = step === 0 && answers.feature === "notUsed";
  const nextLabel = saving ? "Sending…" : retry ? "Retry sending" : step === 3 || submittingUnused ? "Send feedback" : "Next";

  return <form className="feedback-card" onSubmit={(event: FormEvent) => { event.preventDefault(); onNext(); }} aria-busy={saving}>
    <p className="feedback-step">{step < 3 ? `Question ${step + 1} of 3` : "One last thing · optional"}</p>
    <fieldset disabled={saving || retry}>
      <legend ref={titleRef} tabIndex={-1}>{question?.question ?? "Anything else we should know?"}</legend>
      <p className="feedback-question-hint">{step < 3 ? "Choose one, or skip this question." : "A few words are enough. You can leave this blank."}</p>
      {question ? <div className="feedback-choices">
        {question.choices.map(([value, label]) => <label className="feedback-choice" key={value}>
          <input type="radio" name={question.field} value={value} checked={answers[question.field] === value}
            onChange={() => onChoose(question.field, value)} />
          <span className="feedback-choice-dot" aria-hidden="true" />
          <span>{label}</span>
        </label>)}
      </div> : <div className="feedback-comment">
        <label className="feedback-sr-only" htmlFor="feedback-comment">Anything else we should know?</label>
        <textarea id="feedback-comment" name="feedback-comment" rows={4} maxLength={FEEDBACK_COMMENT_LIMIT}
          value={answers.comment} onChange={event => onComment(event.target.value)} autoComplete="off"
          aria-describedby="feedback-comment-help feedback-comment-count" placeholder="Tell us what worked or what got in your way…" />
        <div className="feedback-comment-caption">
          <p id="feedback-comment-help">Please don’t include names, contact details or private information.</p>
          <span id="feedback-comment-count">{answers.comment.length}/{FEEDBACK_COMMENT_LIMIT}</span>
        </div>
      </div>}
    </fieldset>
    {submittingUnused && <p className="feedback-unused-note">That’s okay. You can send this answer without rating the app.</p>}
    {error && <p className="feedback-error" ref={errorRef} tabIndex={-1} role="alert">{error}</p>}
    <div className="feedback-actions">
      <button className="feedback-primary" type="submit" disabled={saving}>{nextLabel}<span aria-hidden="true">{step === 3 || submittingUnused || retry ? "↑" : "→"}</span></button>
      {step < 3 && <button className="feedback-text-button" type="button" onClick={onSkip} disabled={saving || retry}>Skip question</button>}
    </div>
    <div className="feedback-back-row">
      {step > 0 && <button className="feedback-text-button" type="button" onClick={onBack} disabled={saving || retry}><span aria-hidden="true">←</span> Back</button>}
      <span>All questions are optional</span>
    </div>
  </form>;
}

interface FeedbackPageProps {
  search?: string;
  endpoint?: string;
}

export default function FeedbackPage({ search, endpoint }: FeedbackPageProps) {
  const [entry] = useState(() => readFeedbackEntry(search ?? (typeof window === "undefined" ? "" : window.location.search)));
  const [session] = useState(() => createFeedbackSession({ source: entry.source, preview: entry.preview, endpoint }));
  const [answers, setAnswers] = useState(emptyFeedbackAnswers);
  const [step, setStep] = useState<FeedbackStep>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"submitted" | "empty" | null>(null);
  const savingRef = useRef(false);
  const completionRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { session.open(); }, [session]);
  useEffect(() => { if (outcome) completionRef.current?.focus(); }, [outcome]);

  async function submit(currentAnswers: FeedbackAnswers) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      setOutcome(await session.submit(currentAnswers));
    } catch {
      setError("We couldn’t send your feedback. Your answers are still here. Check your connection and retry sending.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function next() {
    session.start();
    const target = nextFeedbackStep(step, answers);
    if (target === "submit") { void submit(answers); return; }
    setStep(target);
  }

  function skip() {
    if (step === 3) return;
    session.start();
    const field = FEEDBACK_QUESTIONS[step].field;
    setAnswers(current => ({ ...current, [field]: null }));
    setStep((step + 1) as FeedbackStep);
  }

  return <div className="pt-feedback">
    <header className="feedback-header">
      <a className="feedback-brand" href="/" rel="noreferrer" aria-label="PoseTek home"><span className="feedback-brand-mark" aria-hidden="true">P</span> POSETEK</a>
      <a className="feedback-exit" href="/application.html" rel="noreferrer">Back to PoseTek <span aria-hidden="true">↗</span></a>
    </header>
    <main className="feedback-shell">
      {entry.preview && <p className="feedback-preview" role="status">Preview · nothing you enter here will be sent</p>}
      <div className="feedback-intro">
        <p className="feedback-eyebrow">Your experience</p>
        <h1>Help us improve PoseTek.</h1>
        <p className="feedback-lead">Three quick questions about what worked and what got in your way.</p>
        <p className="feedback-privacy-note">The PoseTek team reads your feedback. No name or login needed, and your answers aren’t linked to your player account. Please don’t include names or contact details.</p>
      </div>
      {outcome ? <section className="feedback-card feedback-complete" aria-live="polite">
        <span className="feedback-complete-mark" aria-hidden="true">{outcome === "submitted" ? "✓" : "—"}</span>
        <h2 ref={completionRef} tabIndex={-1}>{outcome === "submitted" ? (entry.preview ? "Preview complete" : "Thanks for helping us improve.") : "No feedback sent"}</h2>
        <p>{outcome === "empty" ? "You skipped the questions. That’s okay — you can give feedback another time." : entry.preview ? "In the live form, this is where you’ll see confirmation that your feedback was saved." : "Your feedback has been saved for the PoseTek team."}</p>
        <a className="feedback-primary" href="/application.html" rel="noreferrer">Back to PoseTek <span aria-hidden="true">→</span></a>
      </section> : <FeedbackForm step={step} answers={answers} saving={saving} error={error} retry={Boolean(error)}
        onChoose={(field, value) => { session.start(); setAnswers(current => ({ ...current, [field]: value } as FeedbackAnswers)); }}
        onComment={comment => { session.start(); setAnswers(current => ({ ...current, comment })); }}
        onNext={next} onSkip={skip} onBack={() => { session.start(); setStep((step - 1) as FeedbackStep); }} />}
      <footer className="feedback-footer"><span>Giving feedback is your choice.</span><a href="/privacy#app-feedback" rel="noreferrer">Feedback privacy</a></footer>
    </main>
  </div>;
}
