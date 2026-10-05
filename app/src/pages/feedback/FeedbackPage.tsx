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
import { feedbackAuthWithTimeout, feedbackNeedsSignIn, feedbackSignInPath } from "./feedback-identity";
import type { FeedbackAccount, FeedbackAuthAdapter, FeedbackAuthLoader } from "./feedback-identity";
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
  /** Test injection is honored only by a development build, never by URL. */
  authLoader?: FeedbackAuthLoader;
}

type FeedbackAuthState = { kind: "loading" } | { kind: "failed" }
  | { kind: "ready"; account: FeedbackAccount | null; adapter: FeedbackAuthAdapter | null };

export function FeedbackIdentityNotice({ account, preview = false, signInRequired = false }: { account: FeedbackAccount | null; preview?: boolean; signInRequired?: boolean }) {
  return <p className="feedback-identity-notice" role="note">{preview
    ? "Preview only. No account is linked and nothing you enter will be sent."
    : account ? <>Your signed-in account <strong>{account.label}</strong> will be included with this feedback and visible to PoseTek administrators.</>
      : <>No account is linked to this response. {signInRequired ? "Sign in below to give feedback from your workout or results." : "You can give feedback anonymously."}</>}</p>;
}

export function FeedbackSignInGate({ source }: { source: ReturnType<typeof readFeedbackEntry>["source"] }) {
  return <section className="feedback-card feedback-signin-gate">
    <h2>Sign in to give feedback</h2>
    <p>Feedback from your workout or results is linked to the account you use for PoseTek. Sign in to continue.</p>
    <a className="feedback-primary" href={feedbackSignInPath(source)} rel="noreferrer">Sign in to PoseTek <span aria-hidden="true">→</span></a>
    <p>Giving feedback is optional. Your saved results and progress are still available.</p>
  </section>;
}

export default function FeedbackPage({ search, endpoint, authLoader }: FeedbackPageProps) {
  const [entry] = useState(() => readFeedbackEntry(search ?? (typeof window === "undefined" ? "" : window.location.search)));
  const [authState, setAuthState] = useState<FeedbackAuthState>(() => entry.preview
    ? { kind: "ready", account: null, adapter: null } : { kind: "loading" });
  const [authAttempt, setAuthAttempt] = useState(0);
  const [accountChanged, setAccountChanged] = useState(false);
  const previousAccount = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (entry.preview) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    setAuthState({ kind: "loading" });
    const loader: FeedbackAuthLoader = import.meta.env.DEV && authLoader ? authLoader : async () =>
      (await import("./feedback-auth")).createFeedbackAuthAdapter();
    const ready = async () => {
      const adapter = await loader();
      const account = await adapter.ready();
      return { adapter, account };
    };
    void feedbackAuthWithTimeout(ready()).then(({ adapter, account }) => {
      if (!alive) return;
      const update = (next: FeedbackAccount | null) => {
        if (!alive) return;
        const uid = next?.uid ?? null;
        if (previousAccount.current !== undefined && previousAccount.current !== uid) setAccountChanged(true);
        previousAccount.current = uid;
        setAuthState({ kind: "ready", account: next, adapter });
      };
      update(account);
      unsubscribe = adapter.subscribe(update, () => { if (alive) setAuthState({ kind: "failed" }); });
    }).catch(() => { if (alive) setAuthState({ kind: "failed" }); });
    return () => { alive = false; unsubscribe?.(); };
  }, [entry.preview, authAttempt, authLoader]);

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
        <p className="feedback-privacy-note">The PoseTek team reads your feedback. All questions are optional. Please don’t include names, contact details or private information in your comment.</p>
      </div>
      {authState.kind === "loading" ? <section className="feedback-card feedback-auth-state" role="status"><p>Checking your sign-in status…</p></section>
        : authState.kind === "failed" ? <section className="feedback-card feedback-auth-state" role="alert"><h2>We couldn’t check your sign-in status.</h2><p>No feedback has been sent. Check your connection, then retry checking your account.</p><button className="feedback-primary" onClick={() => setAuthAttempt(value => value + 1)}>Retry checking account</button></section>
          : <><FeedbackIdentityNotice account={authState.account} preview={entry.preview} signInRequired={feedbackNeedsSignIn(entry.source, authState.account, entry.preview)} />
            {accountChanged && <p className="feedback-account-changed" role="status">Your sign-in status changed. This form has been reset. Check the account notice above before sending.</p>}
            <FeedbackExperience key={authState.account?.uid ?? "anonymous"} entry={entry} endpoint={endpoint} account={authState.account} adapter={authState.adapter} /></>}
      <footer className="feedback-footer"><span>Giving feedback is your choice.</span><a href="/privacy#app-feedback" rel="noreferrer">Feedback privacy</a></footer>
    </main>
  </div>;
}

function FeedbackExperience({ entry, endpoint, account, adapter }: {
  entry: ReturnType<typeof readFeedbackEntry>; endpoint?: string; account: FeedbackAccount | null; adapter: FeedbackAuthAdapter | null;
}) {
  const [session] = useState(() => createFeedbackSession({ source: entry.source, preview: entry.preview, endpoint,
    identityMode: account ? "account" : "anonymous", tokenSupplier: account && adapter ? () => adapter.tokenFor(account.uid) : undefined,
    isCurrentIdentity: adapter ? () => adapter.isCurrent(account?.uid ?? null) : undefined }));
  const [answers, setAnswers] = useState(emptyFeedbackAnswers);
  const [step, setStep] = useState<FeedbackStep>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"submitted" | "empty" | null>(null);
  const savingRef = useRef(false);
  const alive = useRef(true);
  const completionRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { session.open(); }, [session]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (outcome) completionRef.current?.focus(); }, [outcome]);

  async function submit(currentAnswers: FeedbackAnswers) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await session.submit(currentAnswers);
      if (alive.current) setOutcome(saved);
    } catch {
      if (alive.current) setError("We couldn’t send your feedback. Your answers are still here. Check your connection and retry sending.");
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
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

  if (feedbackNeedsSignIn(entry.source, account, entry.preview)) return <FeedbackSignInGate source={entry.source} />;
  return outcome ? <section className="feedback-card feedback-complete" aria-live="polite">
        <span className="feedback-complete-mark" aria-hidden="true">{outcome === "submitted" ? "✓" : "—"}</span>
        <h2 ref={completionRef} tabIndex={-1}>{outcome === "submitted" ? (entry.preview ? "Preview complete" : "Thanks for helping us improve.") : "No feedback sent"}</h2>
        <p>{outcome === "empty" ? "You skipped the questions. That’s okay — you can give feedback another time." : entry.preview ? "In the live form, this is where you’ll see confirmation that your feedback was saved." : "Your feedback has been saved for the PoseTek team."}</p>
        <a className="feedback-primary" href="/application.html" rel="noreferrer">Back to PoseTek <span aria-hidden="true">→</span></a>
      </section> : <FeedbackForm step={step} answers={answers} saving={saving} error={error} retry={Boolean(error)}
        onChoose={(field, value) => { session.start(); setAnswers(current => ({ ...current, [field]: value } as FeedbackAnswers)); }}
        onComment={comment => { session.start(); setAnswers(current => ({ ...current, comment })); }}
        onNext={next} onSkip={skip} onBack={() => { session.start(); setStep((step - 1) as FeedbackStep); }} />;
}
