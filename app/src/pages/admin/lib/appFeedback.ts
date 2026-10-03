/** App-experience feedback stays separate from performance and account records. */
export const APP_FEEDBACK_PAGE_SIZE = 50;
export const APP_FEEDBACK_RETENTION_DAYS = 90;

export const FEATURE_LABELS = {
  results: "Results", workouts: "Workouts", aiCoach: "AI Coach",
  videosTechnique: "Videos or technique", other: "Something else", notUsed: "Haven’t used it yet",
} as const;
export const EASE_LABELS = {
  veryHard: "Very hard", hard: "Hard", inBetween: "In between", easy: "Easy", veryEasy: "Very easy", notSure: "Not sure",
} as const;
export const OBSTRUCTION_LABELS = {
  none: "No", find: "Couldn’t find something", understand: "Didn’t understand something",
  broken: "Something didn’t work", other: "Other",
} as const;
export const SOURCE_LABELS = {
  workout: "After a workout", results: "From results", qr: "QR link", message: "Shared message link", direct: "Direct link",
} as const;

export type AppFeedbackEntrySource = keyof typeof SOURCE_LABELS;
export type AppFeedbackResponse = {
  id: string;
  formVersion: number;
  entrySource: AppFeedbackEntrySource | null;
  answers: {
    feature: keyof typeof FEATURE_LABELS | null;
    ease: keyof typeof EASE_LABELS | null;
    obstruction: keyof typeof OBSTRUCTION_LABELS | null;
    comment: string;
  };
  createdAtMillis: number | null;
  durationSeconds?: number;
};
export type AppFeedbackCursor = { at: number; id: string };
export type AppFeedbackPage = { responses: AppFeedbackResponse[]; nextCursor: AppFeedbackCursor | null };
export type AppFeedbackCounts = { opened: number; started: number; submitted: number };
export type AppFeedbackReview = AppFeedbackPage & { metrics: AppFeedbackCounts; retentionDays: number };
export type AppFeedbackLoad<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: T };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function knownKey<T extends Record<string, string>>(labels: T, value: unknown): keyof T | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value) ? value as keyof T : null;
}

/** Accept timestamps only when a real timestamp was supplied; never invent one. */
function timestampMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const timestamp = record(value);
  if (typeof timestamp.toMillis === "function") {
    try { return timestampMillis(timestamp.toMillis()); } catch { return null; }
  }
  if (typeof timestamp.seconds === "number" && Number.isFinite(timestamp.seconds)) {
    return timestampMillis(timestamp.seconds * 1000 + (typeof timestamp.nanoseconds === "number" ? timestamp.nanoseconds / 1_000_000 : 0));
  }
  return null;
}

export function normalizeAppFeedbackResponse(id: string, value: unknown): AppFeedbackResponse {
  const row = record(value), answers = record(row.answers);
  const duration = typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds) && row.durationSeconds >= 0
    ? row.durationSeconds : undefined;
  return {
    id,
    formVersion: typeof row.formVersion === "number" ? row.formVersion : 1,
    entrySource: knownKey(SOURCE_LABELS, row.entrySource),
    answers: {
      feature: knownKey(FEATURE_LABELS, answers.feature), ease: knownKey(EASE_LABELS, answers.ease),
      obstruction: knownKey(OBSTRUCTION_LABELS, answers.obstruction), comment: typeof answers.comment === "string" ? answers.comment : "",
    },
    createdAtMillis: timestampMillis(row.createdAtMillis ?? row.createdAt),
    ...(duration === undefined ? {} : { durationSeconds: duration }),
  };
}

export function feedbackAnswerLabel<T extends Record<string, string>>(labels: T, value: keyof T | null): string {
  return value === null ? "Skipped" : labels[value];
}

export function feedbackRate(submitted: number, denominator: number): string {
  if (!Number.isFinite(submitted) || !Number.isFinite(denominator) || denominator <= 0 || submitted < 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(submitted / denominator);
}

export function feedbackDate(value: number | null): string {
  if (value === null || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(value);
}

export function feedbackShareUrl(source: "qr" | "message"): string {
  return `https://posetek.net/feedback?source=${source}`;
}

export function feedbackReadError(error: unknown): string {
  const code = String(record(error).code ?? "");
  if (/permission-denied|unauthenticated/.test(code)) return "Your admin access could not be verified. Sign in again, then retry.";
  return "App feedback could not be loaded. Please retry.";
}

/** Validate the admin read contract before displaying rates or pagination. */
export function normalizeAppFeedbackReview(value: unknown): AppFeedbackReview {
  const data = record(value), metrics = record(data.metrics);
  if (!Array.isArray(data.responses) || data.responses.length > APP_FEEDBACK_PAGE_SIZE || data.retentionDays !== APP_FEEDBACK_RETENTION_DAYS
    || ![metrics.opened, metrics.started, metrics.submitted].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
    throw new Error("Unexpected app feedback response.");
  }
  const cursor = record(data.nextCursor);
  if (data.nextCursor !== null && !(typeof cursor.at === "number" && Number.isFinite(cursor.at) && cursor.at > 0 && typeof cursor.id === "string" && cursor.id)) {
    throw new Error("Unexpected app feedback cursor.");
  }
  const responses = data.responses.map(value => {
    const row = record(value);
    if (typeof row.id !== "string" || !row.id || row.formVersion !== 1) throw new Error("Unexpected app feedback record.");
    return normalizeAppFeedbackResponse(row.id, row);
  });
  return {
    responses,
    nextCursor: data.nextCursor === null ? null : { at: cursor.at as number, id: cursor.id as string },
    metrics: { opened: metrics.opened as number, started: metrics.started as number, submitted: metrics.submitted as number },
    retentionDays: APP_FEEDBACK_RETENTION_DAYS,
  };
}
