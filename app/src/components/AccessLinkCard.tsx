import { accessPurposeLabel } from "../lib/access-link-issuer";
import type { IssuedAccessLink } from "../lib/access-link-issuer";
import "./access-link-card.scss";

export default function AccessLinkCard({ link, organizationName, onCopy, onDismiss, disabled = false }: {
  link: IssuedAccessLink;
  organizationName?: string;
  onCopy(kind: "link" | "code" | "instructions"): void;
  onDismiss(): void;
  disabled?: boolean;
}) {
  const recovery = link.purpose === "account_recovery";
  return <section className="access-link-card" aria-labelledby="issued-access-heading">
    <p className="eyebrow">{accessPurposeLabel(link.purpose)}</p>
    <h2 id="issued-access-heading">{recovery ? "Recovery link ready" : "Activation link ready"}</h2>
    <p>Share it directly. <strong>No email was sent.</strong></p>
    <dl><div><dt>Account</dt><dd>{link.email}</dd></div>{organizationName && <div><dt>Organization</dt><dd>{organizationName}</dd></div>}<div><dt>Expires</dt><dd>{new Date(link.expiresAtMillis).toLocaleString()}</dd></div></dl>
    <p>{recovery ? "The recipient chooses a new password for this account." : link.accountMode === "new" ? "The recipient chooses their own password to activate access." : "The recipient signs in with their existing password to activate access."}</p>
    <code className="access-link-code" data-clarity-mask="true" aria-label="Private access code">{link.code}</code>
    <div className="access-link-actions"><button type="button" className="primary-cta" disabled={disabled} onClick={() => onCopy("link")}>Copy link</button><button type="button" className="quiet-button" disabled={disabled} onClick={() => onCopy("code")}>Copy code</button><button type="button" className="quiet-button" disabled={disabled} onClick={() => onCopy("instructions")}>Copy instructions</button></div>
    <p className="access-link-note">Copy it before leaving this page. If it is lost, replace the pending link. Each link works once.</p>
    <button type="button" className="quiet-button" disabled={disabled} onClick={onDismiss}>Done</button>
  </section>;
}
