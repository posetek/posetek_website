import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../lib/firebase", () => ({ auth: {}, default: {} }));
vi.mock("../lib/organization-data", () => ({ getClubContext: vi.fn() }));
import AccountRecoveryRequest from "./AccountRecoveryRequest";
import AccountRecoveryWorkspace from "./AccountRecoveryWorkspace";

describe("public sign-in help", () => {
  it("accepts signed-out help without passwords or access-code fields", () => {
    const html = renderToStaticMarkup(<AccountRecoveryRequest initialEmail="player@example.test" />);
    expect(html).toContain("Request sign-in help"); expect(html).toContain('type="email"');
    expect(html).toContain('data-clarity-mask="true"'); expect(html).toContain("unverified claims");
    expect(html).toContain('maxLength="300"');
    expect(html).not.toContain('type="password"'); expect(html).not.toContain("accessCode=");
    expect(html).not.toContain("Sign in to request");
  });
  it("keeps preview read-only and exposes a separate selected-player workflow", () => {
    const html = renderToStaticMarkup(<AccountRecoveryWorkspace preview />);
    expect(html).toContain("read-only preview"); expect(html).toContain("Player sign-in help");
    expect(html).toContain("Submitted details are unverified"); expect(html).toContain("password update and a confirmed sign-in");
    expect(html).not.toContain("ACCESS-"); expect(html).toContain('disabled=""');
  });
  it("hides recovery controls from coaches and players", () => {
    for (const role of ["coach", "player", "none"]) expect(renderToStaticMarkup(<AccountRecoveryWorkspace role={role} preview />)).toBe("");
  });
  it("locks managers to their organization and never exposes Auth UIDs in roster choices", () => {
    const html = renderToStaticMarkup(<AccountRecoveryWorkspace role="manager" organizationId="club" organizationName="Sample club" players={[{ id: "player-record", firstName: "Sample", lastName: "Player" }]} preview />);
    expect(html).toContain("Help players in Sample club"); expect(html).toContain("Sample Player");
    expect(html).not.toContain("Choose an organization"); expect(html).not.toContain("targetUID");
  });
});
