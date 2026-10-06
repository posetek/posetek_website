import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccessLinkCard from "./AccessLinkCard";
import type { IssuedAccessLink } from "../lib/access-link-issuer";

const link: IssuedAccessLink = { grantId: "grant", activationUrl: "https://posetek.net/join#accessCode=secret", code: `ACCESS-${"AA".repeat(32)}`, expiresAtMillis: 1_800_000_000_000, email: "coach@example.test", purpose: "staff_activation", accountMode: "existing" };
const render = (value = link, disabled = false) => renderToStaticMarkup(<AccessLinkCard link={value} onCopy={() => {}} onDismiss={() => {}} disabled={disabled} />);
describe("issued private access card", () => {
  it("shows exact account, expiry and explicit no-email status with all sharing actions", () => {
    const html = render();
    for (const text of ["Activation link ready", "No email was sent", "coach@example.test", "Expires", "Copy link", "Copy code", "Copy instructions"]) expect(html).toContain(text);
    expect(html).toContain('data-clarity-mask="true"');
    expect(html).not.toContain("#accessCode=");
    expect(html).not.toContain("href=");
  });
  it("does not suggest resetting existing activation passwords", () => {
    expect(render()).toContain("existing password");
    expect(render({ ...link, accountMode: "new" })).toContain("own password");
    const recovery = render({ ...link, purpose: "account_recovery" });
    expect(recovery).toContain("Recovery link ready"); expect(recovery).toContain("new password"); expect(recovery).not.toContain("existing password");
  });
  it("disables all sharing actions when the caller invalidates access", () => {
    expect((render(link, true).match(/disabled=""/g) || []).length).toBe(4);
  });
});
