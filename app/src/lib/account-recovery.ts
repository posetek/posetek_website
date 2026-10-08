import type { IssuedAccessLink } from "./access-link-issuer";

export interface RecoveryRequestInput { email: string; name: string; organizationName: string; contact: string }
export interface RecoveryAttempt { requestId: string; key: string; input: RecoveryRequestInput }
export interface RecoveryTarget { playerId: string; organizationId: string; playerName: string; organizationName: string; email: string; targetUID: string; recoverable: boolean }
export interface RecoveryRequest {
  requestId: string; status: string; handlingStatus: string;
  claimedName: string; claimedEmail: string; claimedOrganizationName: string; contact?: string;
  identityVerified: boolean; organizationId: string | null; playerId: string | null; playerName: string | null;
  createdAtMillis: number; updatedAtMillis: number; expiresAtMillis: number; grantId: string | null; note: string;
  grantStatus?: string; linkSharedAtMillis?: number; passwordUpdatedAtMillis?: number; signInConfirmedAtMillis?: number;
}
export interface PlayerRecoveryLink extends IssuedAccessLink { playerId: string; organizationId: string; requestId: string }
export interface RecoveryPage { requests: RecoveryRequest[]; nextCursor: Record<string, unknown> | null }
export const RECOVERY_STALE = "Your account or selected player changed. Select the player again.";

/** A retry keeps the original opaque reference; editing the claims starts a new request. No storage is used. */
export function prepareRecoveryAttempt(value: RecoveryRequestInput, previous: RecoveryAttempt | null, uuid: () => string = () => crypto.randomUUID()): RecoveryAttempt {
  const input = { email: value.email.trim().toLowerCase(), name: value.name.trim(), organizationName: value.organizationName.trim(), contact: value.contact.trim() };
  const key = JSON.stringify(input);
  return previous?.key === key ? previous : { requestId: uuid(), key, input };
}
export function recoveryError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code).split("/").pop() : "";
  if (code === "permission-denied") return "Your current account cannot help this player. Refresh to check your organization access.";
  if (code === "unauthenticated") return "Sign in again before helping with this account.";
  if (code === "aborted") return "This request changed while you were reviewing it. Refresh its status before trying again.";
  if (code === "resource-exhausted" || code === "too-many-requests") return "Too many attempts. Wait a few minutes, then try again.";
  if (code === "not-found" || code === "failed-precondition" || code === "already-exists") return "This account or request needs review. Refresh its status before trying again, or contact PoseTek.";
  if (code === "invalid-argument") return "Check the account email and request details, then try again.";
  return "The request could not be confirmed. Check your connection and retry with the same details.";
}
export function recoveryStatus(status: string): string {
  return ({ new: "New request", in_review: "Identity review", link_ready: "Link created · awaiting sharing", link_shared: "Link shared · awaiting password update", reset_completed: "Password updated · sign-in not confirmed", confirmed: "Sign-in confirmed", needs_review: "Needs PoseTek review", closed: "Closed", expired: "Recovery link expired", revoked: "Recovery link revoked", processing: "Password update being checked" } as Record<string, string>)[status] || "Needs review";
}
export function canManagePlayerRecovery(role: string | undefined): boolean { return role === "admin" || role === "manager"; }
export interface RecoverySelection { uid: string | null; organizationId: string; playerId: string; revision: number }
/** Every late response must still belong to the same account, selection and operation lifetime. */
export function recoverySelectionIsCurrent(expected: RecoverySelection, actual: RecoverySelection): boolean {
  return Boolean(expected.uid && expected.uid === actual.uid && expected.organizationId === actual.organizationId && expected.playerId === actual.playerId && expected.revision === actual.revision);
}
export async function callRecovery<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const { cloud } = await import("./firebase");
  return (await cloud.httpsCallable(name)(data)).data as T;
}
export function confirmAccountRecovery(grantId: string): Promise<{ confirmed: true; grantId: string }> { return callRecovery("confirmAccountRecovery", { grantId }); }

/** Confirmation is best effort after a real password sign-in. It never replays the password change or gates access. */
export async function confirmRecoverySignIn(value: { purpose: string; grantId?: string; targetUID: string }, signedInUid: string, current: () => boolean, confirm: (grantId: string) => Promise<unknown>, timeoutMillis = 3000): Promise<void> {
  if (value.purpose !== "account_recovery" || !value.grantId || value.targetUID !== signedInUid || !current()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([confirm(value.grantId), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMillis); })]); }
  catch { /* Access is already independently confirmed. */ }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
