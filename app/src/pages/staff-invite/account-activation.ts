import { matchesAccessLink, STAFF_ACCESS_STALE } from "../../lib/account-access";
import type { AccountAccess, AccountAccessLink, ActiveAccountAccess, CompletedAccountAccess } from "../../lib/account-access";
import { confirmRecoverySignIn } from "../../lib/account-recovery";

export interface ActivationUser { uid: string }
export interface ActivationDependencies<U extends ActivationUser> {
  isCurrent(): boolean;
  currentUser(): U | null;
  complete(code: string, password?: string): Promise<CompletedAccountAccess>;
  signIn(email: string, password: string): Promise<U>;
  access(user: U): Promise<AccountAccess>;
  confirmRecovery?(grantId: string): Promise<unknown>;
  delay?(milliseconds: number): Promise<void>;
}
export const ACCESS_NOT_CONFIRMED = "Your account is saved, but its access could not be confirmed. Sign in with your password, or ask PoseTek to check this link.";
function assertCurrent<U extends ActivationUser>(deps: ActivationDependencies<U>) {
  if (!deps.isCurrent()) throw new Error(STAFF_ACCESS_STALE);
}
async function readBoundAccess<U extends ActivationUser>(link: AccountAccessLink, user: U | null, deps: ActivationDependencies<U>): Promise<ActiveAccountAccess> {
  assertCurrent(deps);
  if (!user || user.uid !== link.targetUID || deps.currentUser()?.uid !== user.uid) throw new Error("Use the account named on this access link.");
  const access = await deps.access(user);
  assertCurrent(deps);
  if (deps.currentUser()?.uid !== user.uid || !matchesAccessLink(link, user.uid, access)) throw new Error(ACCESS_NOT_CONFIRMED);
  return access;
}
function assertCompletion(link: AccountAccessLink, result: CompletedAccountAccess) {
  if (result.status !== "completed" || result.targetUID !== link.targetUID || result.purpose !== link.purpose || result.role !== link.role || result.organizationId !== link.organizationId) throw new Error(ACCESS_NOT_CONFIRMED);
}
async function acknowledgeBoundMetadata<U extends ActivationUser>(link: AccountAccessLink, code: string, deps: ActivationDependencies<U>): Promise<void> {
  assertCurrent(deps);
  if (deps.currentUser()?.uid !== link.targetUID) throw new Error("Use the account named on this access link.");
  const result = await deps.complete(code);
  assertCurrent(deps); assertCompletion(link, result);
}
async function waitForRecoverySignIn<U extends ActivationUser>(link: AccountAccessLink, deps: ActivationDependencies<U>): Promise<void> {
  if (link.purpose !== "account_recovery") return;
  assertCurrent(deps);
  // Firebase auth_time has whole-second precision. A later-second password
  // sign-in must follow all server completion/session-revocation stages.
  await (deps.delay ? deps.delay(1100) : new Promise<void>(resolve => setTimeout(resolve, 1100)));
  assertCurrent(deps);
}
export async function signInForAccessLink<U extends ActivationUser>(link: AccountAccessLink, code: string, password: string, deps: ActivationDependencies<U>): Promise<ActiveAccountAccess> {
  assertCurrent(deps);
  let acknowledged = false;
  if (link.status === "processing") {
    // A new identity can still be disabled after its password was durably
    // saved. Only the server may resume known safe stages before sign-in.
    try { const result = await deps.complete(code); assertCurrent(deps); assertCompletion(link, result); acknowledged = true; }
    catch { assertCurrent(deps); /* Try ordinary sign-in, then a bound acknowledgement. */ }
  }
  const waited = link.purpose === "account_recovery" && (acknowledged || link.status === "completed");
  if (waited) await waitForRecoverySignIn(link, deps);
  let user = await deps.signIn(link.email, password);
  assertCurrent(deps);
  if (user.uid !== link.targetUID || deps.currentUser()?.uid !== user.uid) throw new Error("Use the account named on this access link.");
  let access: ActiveAccountAccess;
  if (link.purpose === "account_recovery" && !waited) {
    // An interrupted operation can require the first sign-in to acknowledge
    // its safe stages. Session revocation can invalidate that first login;
    // confirm metadata before obtaining a later token and reading access.
    await acknowledgeBoundMetadata(link, code, deps);
    await waitForRecoverySignIn(link, deps);
    user = await deps.signIn(link.email, password); assertCurrent(deps);
    access = await readBoundAccess(link, user, deps);
  } else access = acknowledged ? await readBoundAccess(link, user, deps) : await confirmCurrentAccess(link, code, deps);
  if (deps.confirmRecovery) await confirmRecoverySignIn(link, user.uid, () => deps.isCurrent() && deps.currentUser()?.uid === user.uid, deps.confirmRecovery);
  assertCurrent(deps);
  return access;
}
export async function confirmCurrentAccess<U extends ActivationUser>(link: AccountAccessLink, code: string, deps: ActivationDependencies<U>): Promise<ActiveAccountAccess> {
  assertCurrent(deps);
  if (deps.currentUser()?.uid !== link.targetUID) throw new Error("Use the account named on this access link.");
  // This resumes only a server-confirmed applied operation. Mere existing
  // membership cannot prove that a recovery password was saved.
  await acknowledgeBoundMetadata(link, code, deps);
  return readBoundAccess(link, deps.currentUser(), deps);
}
/** Ambiguous password writes are reconciled by ordinary sign-in, never by a
 * second password write or deleting the account. */
export async function activateManagedAccount<U extends ActivationUser>(link: AccountAccessLink, code: string, password: string | undefined, deps: ActivationDependencies<U>): Promise<{ access: ActiveAccountAccess; recovered: boolean }> {
  assertCurrent(deps);
  if (link.status !== "ready") throw new Error("Sign in to check this account. Ask PoseTek if access is still unavailable.");
  const setsPassword = link.accountMode === "new" || link.purpose === "account_recovery";
  if (setsPassword ? !password || password.length < 8 || password.length > 128 : password !== undefined) throw new Error(setsPassword ? "Choose a password between 8 and 128 characters." : "Sign in with your existing password to activate this account.");
  if (!setsPassword && deps.currentUser()?.uid !== link.targetUID) throw new Error("Sign in with the account named on this access link.");
  let recovered = false;
  try {
    const result = await deps.complete(code, password);
    assertCurrent(deps);
    assertCompletion(link, result);
  } catch (failure) {
    assertCurrent(deps);
    recovered = true;
    if (!setsPassword) {
      try { return { access: await confirmCurrentAccess(link, code, deps), recovered }; }
      catch { assertCurrent(deps); throw failure; }
    }
  }
  let access: ActiveAccountAccess;
  if (setsPassword) {
    if (!recovered) await waitForRecoverySignIn(link, deps);
    let user = await deps.signIn(link.email, password!);
    assertCurrent(deps);
    if (user.uid !== link.targetUID || deps.currentUser()?.uid !== user.uid) throw new Error("Use the account named on this access link.");
    if (recovered && link.purpose === "account_recovery") {
      await acknowledgeBoundMetadata(link, code, deps);
      await waitForRecoverySignIn(link, deps);
      user = await deps.signIn(link.email, password!); assertCurrent(deps);
      access = await readBoundAccess(link, user, deps);
    } else access = recovered ? await confirmCurrentAccess(link, code, deps) : await readBoundAccess(link, user, deps);
    if (deps.confirmRecovery) await confirmRecoverySignIn(link, user.uid, () => deps.isCurrent() && deps.currentUser()?.uid === user.uid, deps.confirmRecovery);
    assertCurrent(deps);
  } else access = await readBoundAccess(link, deps.currentUser(), deps);
  return { access, recovered };
}
