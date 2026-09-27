// Link secrets are captured before analytics and kept only in this module's
// memory. Keep this module free of eager Firebase imports: bootstrap uses it.
import type { AccountRole } from "../pages/landing/account-entry";

export const ACCOUNT_ACCESS_PATTERN = /^ACCESS-[A-F0-9]{64}$/i;
export const STAFF_ACCESS_STALE = "Your sign-in changed. Please try again.";
export const STAFF_RECOVERY_HELP = "Contact PoseTek for a recovery link after an identity check. Your organization admin can help you reach PoseTek.";
export type AccessLinkCapture = { present: boolean; code: string };
let captured: AccessLinkCapture = { present: false, code: "" };

export function readStaffAccessLink(href: string): { invitation: AccessLinkCapture; cleanUrl: string } {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const values = [...url.searchParams.getAll("accessCode"), ...fragment.getAll("accessCode")];
  const present = url.pathname === "/join" && values.length > 0;
  // Always scrub the recognized secret key, including malformed/other-route links.
  url.searchParams.delete("accessCode"); fragment.delete("accessCode");
  if (values.length) url.hash = fragment.toString();
  const normalized = values.map(value => value.trim().toUpperCase());
  const code = present && normalized.every(value => value === normalized[0]) && ACCOUNT_ACCESS_PATTERN.test(normalized[0]) ? normalized[0] : "";
  return { invitation: { present, code }, cleanUrl: url.href };
}
export function captureStaffAccessLink(browser: Pick<Window, "location" | "history">): void {
  const result = readStaffAccessLink(browser.location.href);
  if (result.invitation.present) captured = result.invitation;
  if (result.cleanUrl !== browser.location.href) browser.history.replaceState(browser.history.state, "", result.cleanUrl);
}
export function initialStaffAccessLink(): AccessLinkCapture { return captured; }
export function forgetStaffAccessLink(): void { captured = { present: false, code: "" }; }
export function staffAccessUrl(code: string, origin = "https://posetek.net"): string {
  if (!ACCOUNT_ACCESS_PATTERN.test(code.trim())) throw new Error("The access code is incomplete.");
  const url = new URL("/join", origin);
  url.hash = "accessCode=" + encodeURIComponent(code.trim().toUpperCase());
  return url.href;
}
export function staffAccessInstructions(value: { code: string; email: string; expiresAtMillis?: number; role?: string; organizationName?: string }): string {
  const expiry = value.expiresAtMillis ? ` This link expires ${new Date(value.expiresAtMillis).toLocaleDateString()}.` : "";
  return `Open your PoseTek access link: ${staffAccessUrl(value.code)}\nUse ${value.email} and follow the steps to activate your account.${expiry}\nNo invitation email was sent. Share this link only with the intended person.`;
}

export type AccessPurpose = "staff_activation" | "internal_admin_activation" | "account_recovery";
export interface AccountAccessLink {
  status: "ready" | "processing" | "completed";
  purpose: AccessPurpose;
  accountMode: "new" | "existing";
  email: string;
  targetUID: string;
  firstName: string;
  lastName: string;
  role: "coach" | "manager" | "admin" | null;
  organizationId?: string;
  organizationName?: string;
  teamNames?: string[];
  expiresAtMillis: number;
  requiresSignIn: boolean;
}
export interface CompletedAccountAccess {
  status: "completed";
  purpose: AccessPurpose;
  targetUID: string;
  email: string;
  role: "coach" | "manager" | "admin" | null;
  organizationId?: string;
  teamIds?: string[];
}
async function call<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const { cloud } = await import("./firebase");
  return (await cloud.httpsCallable(name)(data)).data as T;
}
export function getAccountAccessLink(code: string): Promise<AccountAccessLink> { return call("getAccountAccessLink", { code }); }
export function completeAccountAccessLink(code: string, password?: string): Promise<CompletedAccountAccess> {
  return call("completeAccountAccessLink", password === undefined ? { code } : { code, password });
}
export function accountAccessError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code).split("/").pop() : "";
  if (code === "not-found") return "This access link is invalid, expired or no longer available. Ask the person who shared it for a new link.";
  if (code === "permission-denied" || code === "unauthenticated") return "Sign in with the account named on this access link. Use another account if needed.";
  if (code === "invalid-argument") return "Check the access code and choose a password with at least 8 characters.";
  if (code === "resource-exhausted" || code === "too-many-requests") return "Too many attempts. Wait a little, then try again.";
  if (code === "failed-precondition" || code === "already-exists") return "We could not finish this access change. Try signing in with your account first. If access is still unavailable, ask PoseTek to check this link.";
  return "We could not confirm your access. Your account has been kept. Try signing in, or ask PoseTek to check this link.";
}

export type ActiveAccountAccess = { kind: "active"; role: Exclude<AccountRole, "pending">; playerId?: string; organizationId?: string; organizationName?: string };
export type AccountAccess = ActiveAccountAccess | { kind: "activation"; reason: "admin-unverified" | "unlinked" | "staff-inactive" };
export interface AccessUser { uid: string; reload(): Promise<void>; getIdTokenResult(force: boolean): Promise<{ claims: Record<string, unknown> }> }
export interface AccessDependencies {
  isCurrent(): boolean;
  context(): Promise<{ role: string; organization: { id: string; name: string } | null }>;
  coach(uid: string): Promise<{ data(): Record<string, unknown> | undefined } | null>;
  player(uid: string): Promise<{ id: string } | null>;
}
/** Fresh token and canonical membership precede legacy identity fallbacks. */
export async function resolveAccountAccess(user: AccessUser, deps: AccessDependencies): Promise<AccountAccess> {
  const current = () => { if (!deps.isCurrent()) throw new Error(STAFF_ACCESS_STALE); };
  current(); await user.reload(); current();
  const { claims } = await user.getIdTokenResult(true); current();
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (/^[a-z0-9._%+-]+@posetek\.net$/i.test(email)) {
    return claims.email_verified === true ? { kind: "active", role: "admin" } : { kind: "activation", reason: "admin-unverified" };
  }
  const club = await deps.context(); current();
  if ((club.role === "coach" || club.role === "manager") && club.organization?.id) {
    return { kind: "active", role: club.role, organizationId: club.organization.id, organizationName: club.organization.name };
  }
  const coach = await deps.coach(user.uid); current();
  if (coach) {
    const data = coach.data() || {};
    if (Object.hasOwn(data, "organizationId") || Object.hasOwn(data, "organizationRole")) return { kind: "activation", reason: "staff-inactive" };
    return { kind: "active", role: "independent" };
  }
  const player = await deps.player(user.uid); current();
  return player ? { kind: "active", role: "player", playerId: player.id } : { kind: "activation", reason: "unlinked" };
}
export async function loadAccountAccess(user: AccessUser, isCurrent: () => boolean): Promise<AccountAccess> {
  const [{ db }, { getClubContext }, { findCoach, findPlayer }] = await Promise.all([import("./firebase"), import("./organization-data"), import("./identity")]);
  return resolveAccountAccess(user, { isCurrent, context: getClubContext, coach: uid => findCoach(db, uid), player: uid => findPlayer(db, uid) });
}
export function matchesAccessLink(link: Pick<AccountAccessLink, "targetUID" | "purpose" | "role" | "organizationId">, uid: string, access: AccountAccess): access is ActiveAccountAccess {
  if (uid !== link.targetUID || access.kind !== "active") return false;
  if (link.purpose === "account_recovery") return !link.role || (access.role === link.role && (!link.organizationId || access.organizationId === link.organizationId));
  return access.role === link.role && (link.role === "admin" || Boolean(link.organizationId && access.organizationId === link.organizationId));
}
