import { cloud } from "../../../lib/firebase";
import type { ReviseResult } from "./repToolsData";
import type { JumpRecoveryInput, JumpRecoveryPreview, JumpReviewContext } from "./jumpRecovery";

export async function loadJumpReview(playerId: string, repId: string): Promise<JumpReviewContext> {
  const result = await cloud.httpsCallable("adminGetJumpReview")({ playerId, repId });
  return result.data as JumpReviewContext;
}

export async function previewJumpRecovery(playerId: string, repId: string, jumpRecovery: JumpRecoveryInput): Promise<JumpRecoveryPreview> {
  const result = await cloud.httpsCallable("adminPreviewJumpRecovery")({ playerId, repId, drill: "jump", jumpRecovery });
  return result.data as JumpRecoveryPreview;
}

export async function saveJumpRecovery(playerId: string, repId: string, jumpRecovery: JumpRecoveryInput, note: string): Promise<ReviseResult> {
  const result = await cloud.httpsCallable("adminReviseRep")({ playerId, repId, drill: "jump", jumpRecovery, note });
  return result.data as ReviseResult;
}
