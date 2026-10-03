export const FEEDBACK_ENDPOINT = "https://us-central1-kickai-69dd0.cloudfunctions.net/receiveAppFeedback";
export const FEEDBACK_COMMENT_LIMIT = 1000;

export type FeedbackSource = "workout" | "results" | "qr" | "message" | "direct";
export type FeedbackFeature = "results" | "workouts" | "aiCoach" | "videosTechnique" | "other" | "notUsed";
export type FeedbackEase = "veryHard" | "hard" | "inBetween" | "easy" | "veryEasy" | "notSure";
export type FeedbackObstruction = "none" | "find" | "understand" | "broken" | "other";
export type FeedbackStep = 0 | 1 | 2 | 3;
export interface FeedbackAnswers {
  feature: FeedbackFeature | null;
  ease: FeedbackEase | null;
  obstruction: FeedbackObstruction | null;
  comment: string;
}
export interface FeedbackPayload {
  formVersion: 1;
  event: "opened" | "started" | "submitted";
  sessionId: string;
  entrySource: FeedbackSource;
  answers?: FeedbackAnswers;
  durationSeconds?: number;
}

export function readFeedbackEntry(search: string): { source: FeedbackSource; preview: boolean } {
  const params = new URLSearchParams(search);
  const candidate = params.get("source");
  const source: FeedbackSource = candidate === "workout" || candidate === "results" || candidate === "qr" || candidate === "message"
    ? candidate : "direct";
  return { source, preview: params.get("preview") === "1" };
}

export function emptyFeedbackAnswers(): FeedbackAnswers {
  return { feature: null, ease: null, obstruction: null, comment: "" };
}

/** The unused-feature exit never carries ratings from a previous visit to a step. */
export function prepareFeedbackAnswers(answers: FeedbackAnswers): FeedbackAnswers {
  return {
    feature: answers.feature,
    ease: answers.feature === "notUsed" ? null : answers.ease,
    obstruction: answers.feature === "notUsed" ? null : answers.obstruction,
    comment: answers.feature === "notUsed" ? "" : answers.comment.trim().slice(0, FEEDBACK_COMMENT_LIMIT),
  };
}

export function hasFeedbackAnswers(answers: FeedbackAnswers): boolean {
  const clean = prepareFeedbackAnswers(answers);
  return clean.feature !== null || clean.ease !== null || clean.obstruction !== null || clean.comment.length > 0;
}

export function nextFeedbackStep(step: FeedbackStep, answers: FeedbackAnswers): FeedbackStep | "submit" {
  return (step === 0 && answers.feature === "notUsed") || step === 3 ? "submit" : (step + 1) as FeedbackStep;
}

function newSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface FeedbackSessionOptions {
  source: FeedbackSource;
  preview?: boolean;
  endpoint?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  makeId?: () => string;
}

/** One random identity per page opening; never persisted or joined to an account. */
export function createFeedbackSession(options: FeedbackSessionOptions) {
  const now = options.now ?? Date.now;
  const openedAt = now();
  const sessionId = (options.makeId ?? newSessionId)();
  const endpoint = options.endpoint ?? FEEDBACK_ENDPOINT;
  const fetcher = options.fetcher ?? fetch;
  let opened = false;
  let started = false;
  let pendingSubmission: { answers: FeedbackAnswers; durationSeconds: number } | null = null;

  async function post(event: FeedbackPayload["event"], answers?: FeedbackAnswers): Promise<void> {
    if (options.preview) return;
    const payload: FeedbackPayload = { formVersion: 1, event, sessionId, entrySource: options.source };
    if (event === "submitted" && answers) {
      payload.answers = answers;
      payload.durationSeconds = pendingSubmission?.durationSeconds;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Feedback could not be saved.");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    open() {
      if (opened) return;
      opened = true;
      void post("opened").catch(() => {});
    },
    start() {
      if (started) return;
      started = true;
      void post("started").catch(() => {});
    },
    async submit(answers: FeedbackAnswers): Promise<"submitted" | "empty"> {
      if (!pendingSubmission && !hasFeedbackAnswers(answers)) return "empty";
      // A response may be lost after the server accepts it. Preserve the exact
      // submitted snapshot on retry as well as the same session identity.
      pendingSubmission ??= {
        answers: prepareFeedbackAnswers(answers),
        durationSeconds: Math.min(86400, Math.max(0, Math.round((now() - openedAt) / 1000))),
      };
      await post("submitted", pendingSubmission.answers);
      return "submitted";
    },
  };
}
