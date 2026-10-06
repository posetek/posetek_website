import type { FeedbackSource } from "./feedback-session";

export type FeedbackIdentityMode = "account" | "anonymous";
export interface FeedbackAccount { uid: string; label: string; }
export interface FeedbackAuthAdapter {
  ready(): Promise<FeedbackAccount | null>;
  subscribe(listener: (account: FeedbackAccount | null) => void, onError: () => void): () => void;
  isCurrent(uid: string | null): boolean;
  tokenFor(uid: string): Promise<string>;
}
export type FeedbackAuthLoader = () => Promise<FeedbackAuthAdapter>;

export function feedbackNeedsSignIn(source: FeedbackSource, account: FeedbackAccount | null, preview = false): boolean {
  return !preview && !account && (source === "workout" || source === "results");
}

export function feedbackSignInPath(source: FeedbackSource): string {
  return `/signin?returnTo=${encodeURIComponent(`/feedback?source=${source}`)}`;
}

export function feedbackAccountLabel(account: { uid: string; displayName?: string | null; email?: string | null }): string {
  return account.displayName?.trim() || account.email?.trim() || account.uid;
}

export async function feedbackAuthWithTimeout<T>(operation: Promise<T>, milliseconds = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Account verification timed out.")), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
