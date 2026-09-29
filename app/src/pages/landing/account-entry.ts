import { coachHomeRoute, getSafeReturnToUrl, playerHomeRoute } from "./landing-helpers";

export type AccountRole = "admin" | "manager" | "coach" | "independent" | "player" | "pending";

/** Routing is a convenience. Destination pages and server membership checks still enforce access. */
export function accountDestination(role: AccountRole, playerId: string | null, search: string, base: string, origin: string): string {
  const home = role === "admin" ? "/admin" : role === "manager" || role === "coach" ? "/organization"
    : role === "independent" ? coachHomeRoute() : role === "player" && playerId ? playerHomeRoute(playerId) : "/join";
  const target = getSafeReturnToUrl(search, base, origin);
  if (!target) return home;
  const path = new URL(target).pathname;
  const staff = role === "admin" || role === "manager" || role === "coach" || role === "independent";
  if (path === "/admin" || path.startsWith("/admin/")) return role === "admin" ? target : home;
  if (role === "pending") return path === "/join" ? target : home;
  if (path === "/insights" && role === "independent") return home;
  if (["/insights", "/organization", "/roster"].includes(path) || path.endsWith("/coachesview.html")) {
    return staff ? target : home;
  }
  return target;
}

export function authErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code).split("/").pop() || "" : "";
}

export function accountError(error: unknown, fallback = "We could not complete this request. Please try again."): string {
  switch (authErrorCode(error)) {
    case "email-already-in-use": return "This email already has an account. Sign in with it or reset your password.";
    case "invalid-credential": case "wrong-password": case "user-not-found": return "We could not sign you in. Check your email and password, or reset your password.";
    case "invalid-email": return "Enter a valid email address.";
    case "weak-password": return "Choose a password with at least 6 characters.";
    case "too-many-requests": case "resource-exhausted": return "Too many attempts. Wait a little, then try again.";
    case "network-request-failed": case "unavailable": case "deadline-exceeded": return "The connection was interrupted. Check your connection and try again.";
    case "user-disabled": return "This account is disabled. Contact PoseTek for help.";
    default: return fallback;
  }
}
