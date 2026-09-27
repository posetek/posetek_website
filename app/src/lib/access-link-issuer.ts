export type AccessPurpose = "staff_activation" | "internal_admin_activation" | "account_recovery";
export interface IssuedAccessLink {
  grantId: string;
  invitationId?: string;
  activationUrl: string;
  code: string;
  expiresAtMillis: number;
  email: string;
  accountMode: "new" | "existing";
  purpose: AccessPurpose;
}
export interface AccountAccessLink {
  grantId: string;
  email: string;
  purpose: AccessPurpose;
  accountMode: "new" | "existing";
  status: "pending" | "consuming" | "completed" | "revoked" | "expired" | "blocked";
  expiresAtMillis: number;
  createdAtMillis: number;
  targetUID: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

export function accessPurposeLabel(purpose: AccessPurpose): string {
  return purpose === "account_recovery" ? "Password recovery" : purpose === "staff_activation" ? "Staff activation" : "PoseTek admin activation";
}
export function accessStatusLabel(status: string, purpose: AccessPurpose = "staff_activation", expiresAtMillis?: number, now = Date.now()): string {
  if (status === "pending" && expiresAtMillis !== undefined && expiresAtMillis <= now) return "Expired";
  if (status === "pending") return purpose === "account_recovery" ? "Awaiting recovery" : "Awaiting activation";
  if (status === "claimed" || status === "completed") return purpose === "account_recovery" ? "Recovered" : "Active";
  return ({ consuming: "Completing setup", revoked: "Revoked", expired: "Expired", blocked: "Needs PoseTek review", inactive: "Inactive", active: "Active" } as Record<string, string>)[status] || "Needs review";
}
export function accessLinkText(link: IssuedAccessLink, kind: "link" | "code" | "instructions"): string {
  // Never copy a server-provided destination without checking the secret shape.
  // The recipient link is always the canonical first-party fragment route.
  if (!/^ACCESS-[A-F0-9]{64}$/i.test(link.code)) throw new Error("This access link is incomplete. Refresh the access list and replace it before sharing.");
  const url = `https://posetek.net/join#accessCode=${encodeURIComponent(link.code)}`;
  if (kind === "code") return link.code;
  if (kind === "link") return url;
  const nextStep = link.purpose === "account_recovery" ? "Choose a new password for your existing account."
    : link.accountMode === "new" ? "Choose your own password to activate your access." : "Sign in with your existing password to activate your access.";
  return `Your PoseTek ${link.purpose === "account_recovery" ? "recovery" : "activation"} link is ready.\nAccount: ${link.email}\n${url}\n${nextStep}\nExpires ${new Date(link.expiresAtMillis).toLocaleString()}. Use this link once and keep it private. No email was sent.`;
}

/** Publish a one-time secret before a fallible list read. The caller owns memory and identity lifetime. */
export async function refreshAfterIssued<T>(issued: T, port: {
  isCurrent(): boolean;
  retain(value: T): void;
  refresh(): Promise<unknown>;
}): Promise<"saved" | "saved-refresh-failed" | "stale"> {
  if (!port.isCurrent()) return "stale";
  port.retain(issued);
  try { await port.refresh(); }
  catch { return port.isCurrent() ? "saved-refresh-failed" : "stale"; }
  return port.isCurrent() ? "saved" : "stale";
}
