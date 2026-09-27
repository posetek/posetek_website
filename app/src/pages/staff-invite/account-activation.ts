import { matchesAccessLink, STAFF_ACCESS_STALE } from "../../lib/account-access";
import type { AccountAccess, AccountAccessLink, ActiveAccountAccess, CompletedAccountAccess } from "../../lib/account-access";

export interface ActivationUser { uid: string }
export interface ActivationDependencies<U extends ActivationUser> {
  isCurrent(): boolean;
  currentUser(): U | null;
  complete(code: string, password?: string): Promise<CompletedAccountAccess>;
  signIn(email: string, password: string): Promise<U>;
  access(user: U): Promise<AccountAccess>;
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
export async function signInForAccessLink<U extends ActivationUser>(link: AccountAccessLink, code: string, password: string, deps: ActivationDependencies<U>): Promise<ActiveAccountAccess> {
  assertCurrent(deps);
  let acknowledged = false;
  if (link.status === "processing") {
    // A new identity can still be disabled after its password was durably
    // saved. Only the server may resume known safe stages before sign-in.
    try { const result = await deps.complete(code); assertCurrent(deps); assertCompletion(link, result); acknowledged = true; }
    catch { assertCurrent(deps); /* Try ordinary sign-in, then a bound acknowledgement. */ }
  }
  const user = await deps.signIn(link.email, password);
  assertCurrent(deps);
  if (user.uid !== link.targetUID || deps.currentUser()?.uid !== user.uid) throw new Error("Use the account named on this access link.");
  return acknowledged ? readBoundAccess(link, user, deps) : confirmCurrentAccess(link, code, deps);
}
export async function confirmCurrentAccess<U extends ActivationUser>(link: AccountAccessLink, code: string, deps: ActivationDependencies<U>): Promise<ActiveAccountAccess> {
  assertCurrent(deps);
  if (deps.currentUser()?.uid !== link.targetUID) throw new Error("Use the account named on this access link.");
  // This resumes only a server-confirmed applied operation. Mere existing
  // membership cannot prove that a recovery password was saved.
  const result = await deps.complete(code);
  assertCurrent(deps); assertCompletion(link, result);
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
    const user = await deps.signIn(link.email, password!);
    assertCurrent(deps);
    if (user.uid !== link.targetUID || deps.currentUser()?.uid !== user.uid) throw new Error("Use the account named on this access link.");
    access = recovered ? await confirmCurrentAccess(link, code, deps) : await readBoundAccess(link, user, deps);
  } else access = await readBoundAccess(link, deps.currentUser(), deps);
  return { access, recovered };
}
