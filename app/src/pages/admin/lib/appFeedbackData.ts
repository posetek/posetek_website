import { cloud } from "../../../lib/firebase";
import { normalizeAppFeedbackReview } from "./appFeedback";
import type { AppFeedbackCursor, AppFeedbackReview } from "./appFeedback";

/** Server enforces the canonical admin predicate; no client feedback collection access. */
export async function loadAppFeedback(cursor: AppFeedbackCursor | null = null): Promise<AppFeedbackReview> {
  const result = await cloud.httpsCallable("getAppFeedback")(cursor ? { cursor } : {});
  return normalizeAppFeedbackReview(result.data);
}
