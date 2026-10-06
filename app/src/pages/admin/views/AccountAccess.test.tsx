import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../lib/firebase", () => ({ auth: {}, default: {} }));
vi.mock("../../../lib/organization-data", () => ({ clubCall: vi.fn() }));
import AccountAccess, { AccountAccessRows } from "./AccountAccess";
import type { AccountAccessLink } from "../../../lib/access-link-issuer";
const link: AccountAccessLink = { grantId: "g", email: "example@posetek.net", purpose: "internal_admin_activation", accountMode: "new", status: "pending", expiresAtMillis: Date.now() + 100_000, createdAtMillis: Date.now(), targetUID: "uid" };
describe("PoseTek account access", () => {
  it("keeps preview read-only and distinguishes internal administrators from organization staff", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AccountAccess preview /></MemoryRouter>);
    expect(html).toContain("Read-only preview"); expect(html).toContain("Manage organization staff");
    expect(html).toContain("@posetek.net"); expect(html).toContain("across organizations");
    expect(html).toContain("I have confirmed this person and their PoseTek company address");
    expect(html).toContain('<fieldset disabled=""'); expect(html).not.toContain("Send email");
  });
  it("only permits revoking pending links and has clear processing states", () => {
    const rows = (status: AccountAccessLink["status"]) => renderToStaticMarkup(<AccountAccessRows links={[{ ...link, status }]} disabled={false} onRevoke={() => {}} />);
    expect(rows("pending")).toContain("Revoke link");
    for (const status of ["completed", "consuming", "blocked", "revoked"] as const) expect(rows(status)).not.toContain("<button");
    expect(rows("consuming")).toContain("Completing setup"); expect(rows("blocked")).toContain("Needs PoseTek review");
  });
  it("does not reveal UID or secret data in the summary rows", () => {
    const html = renderToStaticMarkup(<AccountAccessRows links={[{ ...link, targetUID: "private-identity-uid" }]} disabled onRevoke={() => {}} />);
    expect(html).not.toContain("private-identity-uid"); expect(html).not.toContain("accessCode"); expect(html).toContain('disabled=""');
  });
});
