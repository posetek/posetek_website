import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../../lib/firebase", () => ({ auth: {} }));
vi.mock("../../lib/organization-data", () => ({ clubCall: vi.fn(), getClubContext: vi.fn() }));
import { StaffInvitationList } from "./OrganizationPage";
import type { ClubContext } from "../../lib/organization-data";
const invitation: ClubContext["invitations"][number] = { id: "invite", email: "coach@example.test", firstName: "Example", lastName: "Coach", role: "coach", teamIds: ["team"], status: "pending", expiresAtMillis: Date.now() + 100_000, activationMode: "manual", activationStatus: "pending" };
const render = (entry = invitation) => renderToStaticMarkup(<StaffInvitationList invitations={[entry]} busy={false} onReplace={() => {}} onRevoke={() => {}} />);
describe("staff activation management", () => {
  it("offers replace and revoke for pending access without exposing a secret", () => {
    const html = render();
    expect(html).toContain("Awaiting activation"); expect(html).toContain("Replace link"); expect(html).toContain("Revoke link");
    expect(html).not.toContain("ACCESS-"); expect(html).not.toContain("Previous invitation process");
  });
  it("labels legacy invitations and offers an explicit replacement", () => {
    const html = render({ ...invitation, activationMode: undefined, role: "manager" });
    expect(html).toContain("Organization admin"); expect(html).toContain("Replace it to activate without email");
  });
  it("does not offer replacement or revocation of claimed or blocked links", () => {
    for (const status of ["claimed", "blocked"]) {
      const html = render({ ...invitation, status });
      expect(html).not.toContain("<button");
    }
    expect(render({ ...invitation, status: "claimed" })).toContain("Active");
  });
  it("offers replacement when the server reports expired", () => {
    const html = render({ ...invitation, status: "expired", activationStatus: "expired", expiresAtMillis: 1 });
    expect(html).toContain("Expired"); expect(html).toContain("Replace link"); expect(html).not.toContain("Revoke link");
  });
  it("defers to grant progress when the underlying invitation still appears pending", () => {
    expect(render({ ...invitation, activationStatus: "consuming" })).toContain("Completing setup");
    for (const activationStatus of ["consuming", "blocked", undefined] as const) expect(render({ ...invitation, activationStatus })).not.toContain("<button");
    expect(render({ ...invitation, status: "claimed", activationStatus: "blocked" })).toContain("Needs PoseTek review");
  });
});
