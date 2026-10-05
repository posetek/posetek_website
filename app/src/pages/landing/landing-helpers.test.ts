import { describe, expect, it } from "vitest";
import {
  coachHomeRoute,
  coachOrgInputError,
  coachOrgStep2Copy,
  createOrganizationPayload,
  generateCode,
  getSafeReturnToUrl,
  joinOrganizationPayload,
  playerHomeRoute,
  playerIdFromRedeemResult,
  playerSignupRoute,
  redeemPlayerSignupCodePayload,
  validateIndependentSignup,
  validateNameAndPassword,
  validateOrgSignup,
  validatePlayerCodeSignup,
} from "./landing-helpers";

const ORIGIN = "https://posetek.example";
const BASE = `${ORIGIN}/kickai.html`;

function url(returnTo: string): string {
  return "?returnTo=" + encodeURIComponent(returnTo);
}

describe("generateCode", () => {
  it("returns 6 chars from the legacy charset by default (no I, no O)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ0-9]{6}$/);
    }
  });

  it("prepends the prefix and appends `length` random chars", () => {
    const code = generateCode("ORG", 6);
    expect(code.startsWith("ORG")).toBe(true);
    expect(code).toHaveLength(9);

    const coach = generateCode("COACH", 4);
    expect(coach.startsWith("COACH")).toBe(true);
    expect(coach).toHaveLength(9);
  });
});

describe("validateNameAndPassword / validateIndependentSignup", () => {
  const ok = { firstName: "Ada", lastName: "Lovelace", password: "secret1", confirmPassword: "secret1" };

  it("passes a complete, matching form", () => {
    expect(validateNameAndPassword(ok)).toBeNull();
    expect(validateIndependentSignup(ok)).toBeNull();
  });

  it("asks for the name first when either half is blank", () => {
    expect(validateNameAndPassword({ ...ok, firstName: "" })).toBe("Please enter your name");
    expect(validateNameAndPassword({ ...ok, lastName: "" })).toBe("Please enter your name");
    // name wins over a password mismatch (legacy throw order)
    expect(validateNameAndPassword({ ...ok, firstName: "", confirmPassword: "x" })).toBe("Please enter your name");
  });

  it("reports a password mismatch with the legacy copy", () => {
    expect(validateNameAndPassword({ ...ok, confirmPassword: "secret2" })).toBe("Passwords don't match");
    expect(validateIndependentSignup({ ...ok, confirmPassword: "secret2" })).toBe("Passwords don't match");
  });
});

describe("validateOrgSignup", () => {
  const base = { firstName: "Ada", lastName: "Lovelace", password: "secret1", confirmPassword: "secret1" };

  it("requires an organization code for players", () => {
    expect(validateOrgSignup({ ...base, userType: "player", orgCode: "" })).toBe(
      "Organization code is required for players",
    );
    expect(validateOrgSignup({ ...base, userType: "player", orgCode: "ORGABC123" })).toBeNull();
  });

  it("lets a coach through without a code (the organization modal follows)", () => {
    expect(validateOrgSignup({ ...base, userType: "coach", orgCode: "" })).toBeNull();
  });

  it("rejects an unselected account type", () => {
    expect(validateOrgSignup({ ...base, userType: "", orgCode: "" })).toBe("Choose player or coach");
    expect(validateOrgSignup({ ...base, userType: "admin", orgCode: "X" })).toBe("Choose player or coach");
  });

  it("checks name and password before the role", () => {
    expect(validateOrgSignup({ ...base, lastName: "", userType: "", orgCode: "" })).toBe("Please enter your name");
    expect(validateOrgSignup({ ...base, confirmPassword: "nope", userType: "player", orgCode: "" })).toBe(
      "Passwords don't match",
    );
  });
});

describe("validatePlayerCodeSignup", () => {
  it("requires the code before comparing passwords", () => {
    expect(validatePlayerCodeSignup({ code: "", password: "a", confirmPassword: "b" })).toBe("Enter your player code");
  });

  it("reports a password mismatch", () => {
    expect(validatePlayerCodeSignup({ code: "PLR1234", password: "a", confirmPassword: "b" })).toBe(
      "Passwords don't match",
    );
  });

  it("passes a valid form", () => {
    expect(validatePlayerCodeSignup({ code: "PLR1234", password: "a", confirmPassword: "a" })).toBeNull();
  });
});

describe("coach organization modal copy", () => {
  it("uses the create/join error copy, defaulting to the code message", () => {
    expect(coachOrgInputError("create")).toBe("Organization name is required.");
    expect(coachOrgInputError("join")).toBe("Organization code is required.");
    expect(coachOrgInputError(null)).toBe("Organization code is required.");
  });

  it("swaps title, label and placeholder per action", () => {
    expect(coachOrgStep2Copy("create")).toEqual({
      title: "Organization Name",
      label: "Organization Name",
      placeholder: "e.g. Riverside FC",
    });
    expect(coachOrgStep2Copy("join")).toEqual({
      title: "Join Organization",
      label: "Organization Code",
      placeholder: "Enter the code",
    });
    expect(coachOrgStep2Copy(null)).toEqual({ title: "Organization Name", label: "Organization Name", placeholder: "" });
  });
});

describe("post-auth destinations", () => {
  it("sends coaches to the roster with the legacy userType", () => {
    expect(coachHomeRoute()).toBe("/roster?userType=coach");
  });

  it("sends a signed-in player to the feed with the encoded id first", () => {
    expect(playerHomeRoute("abc123")).toBe("/feed?player=abc123&userType=player");
    expect(playerHomeRoute("a b/c")).toBe("/feed?player=a%20b%2Fc&userType=player");
  });

  it("builds the signup destination with userType first and an optional player id", () => {
    expect(playerSignupRoute(null)).toBe("/feed?userType=player");
    expect(playerSignupRoute(undefined)).toBe("/feed?userType=player");
    expect(playerSignupRoute("")).toBe("/feed?userType=player");
    expect(playerSignupRoute("p 1")).toBe("/feed?userType=player&player=p%201");
  });
});

describe("admission callable payloads", () => {
  it("redeemPlayerSignupCode sends only the code", () => {
    expect(redeemPlayerSignupCodePayload("PLR1234")).toEqual({ code: "PLR1234" });
    expect(Object.keys(redeemPlayerSignupCodePayload("x"))).toEqual(["code"]);
  });

  it("joinOrganization sends code, role and both names", () => {
    expect(joinOrganizationPayload("ORGABC", "player", "Ada", "Lovelace")).toEqual({
      code: "ORGABC",
      role: "player",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(joinOrganizationPayload("ORGABC", "coach", "Ada", "Lovelace").role).toBe("coach");
  });

  it("createOrganization sends the name and both names", () => {
    expect(createOrganizationPayload("Riverside FC", "Ada", "Lovelace")).toEqual({
      name: "Riverside FC",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("reads playerId out of a callable result, null otherwise", () => {
    expect(playerIdFromRedeemResult({ data: { playerId: "p1" } })).toBe("p1");
    expect(playerIdFromRedeemResult({ data: {} })).toBeNull();
    expect(playerIdFromRedeemResult({ data: { playerId: "" } })).toBeNull();
    expect(playerIdFromRedeemResult({})).toBeNull();
    expect(playerIdFromRedeemResult(null)).toBeNull();
    expect(playerIdFromRedeemResult(undefined)).toBeNull();
  });
});

describe("getSafeReturnToUrl", () => {
  it("returns to feedback after sign-in with only its broad source", () => {
    for (const path of ["/feedback", "/feedback/", "/feedback.html"]) {
      expect(getSafeReturnToUrl(url(path + "?source=workout&player=private&team=private#private"), BASE, ORIGIN)).toBe(`${ORIGIN}/feedback?source=workout`);
    }
    expect(getSafeReturnToUrl(url("/feedback?source=unknown&account=private"), BASE, ORIGIN)).toBe(`${ORIGIN}/feedback`);
    expect(getSafeReturnToUrl(url("/admin/feedback"), BASE, ORIGIN)).toBe(`${ORIGIN}/admin/feedback`);
    expect(getSafeReturnToUrl(url("https://evil.example/feedback?source=results"), BASE, ORIGIN)).toBeNull();
  });
  it("returns null when there is no returnTo param", () => {
    expect(getSafeReturnToUrl("", BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl("?foo=bar", BASE, ORIGIN)).toBeNull();
  });

  it("returns null for an empty returnTo value", () => {
    expect(getSafeReturnToUrl("?returnTo=", BASE, ORIGIN)).toBeNull();
  });

  it("allows a relative allowlisted page and preserves its query string", () => {
    expect(getSafeReturnToUrl(url("profile.html?player=abc123"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/profile.html?player=abc123`,
    );
  });

  it("allows every page on the legacy allowlist", () => {
    const allowed = [
      "profile.html",
      "coachesview.html",
      "broadJumpPage.html",
      "changeOfDirectionPage.html",
      "dribblingPage.html",
      "kickingview.html",
      "sprintPage.html",
      "StaticJumpPage.html",
      "freeRecordPage.html",
    ];
    for (const file of allowed) {
      expect(getSafeReturnToUrl(url(file), BASE, ORIGIN)).toBe(`${ORIGIN}/${file}`);
    }
  });

  it("matches the allowlist case-sensitively, like legacy", () => {
    expect(getSafeReturnToUrl(url("staticjumppage.html"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("StaticJumpPage.html"), BASE, ORIGIN)).toBe(`${ORIGIN}/StaticJumpPage.html`);
  });

  it("rejects same-origin pages that are not on the allowlist", () => {
    expect(getSafeReturnToUrl(url("index.html"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("kickai.html"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects absolute URLs on a different origin even when the file name matches", () => {
    expect(getSafeReturnToUrl(url("https://evil.example/profile.html"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects protocol-relative URLs to another host", () => {
    expect(getSafeReturnToUrl(url("//evil.example/profile.html"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(getSafeReturnToUrl(url("javascript:alert(1)"), BASE, ORIGIN)).toBeNull();
  });

  it("accepts an absolute same-origin URL to an allowlisted page (legacy matched only the last path segment)", () => {
    expect(getSafeReturnToUrl(url(`${ORIGIN}/profile.html?player=X&userType=player`), BASE, ORIGIN)).toBe(
      `${ORIGIN}/profile.html?player=X&userType=player`,
    );
  });

  it("accepts the clean SPA routes that alias allowlisted pages, with query strings intact", () => {
    expect(getSafeReturnToUrl(url("/athlete?player=X&view=drills"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/athlete?player=X&view=drills`,
    );
    expect(getSafeReturnToUrl(url("/roster?userType=coach"), BASE, ORIGIN)).toBe(`${ORIGIN}/roster?userType=coach`);
    expect(getSafeReturnToUrl(url("/drills/broad-jump?share=tok"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/drills/broad-jump?share=tok`,
    );
    expect(getSafeReturnToUrl(url("/drills/change-of-direction"), BASE, ORIGIN)).toBe(
      `${ORIGIN}/drills/change-of-direction`,
    );
    expect(getSafeReturnToUrl(url("/drills/dribbling"), BASE, ORIGIN)).toBe(`${ORIGIN}/drills/dribbling`);
  });

  it("returns to a feed activity or connection after sign-in without accepting external feed URLs", () => {
    for (const target of ["/feed?activity=session-123&organizationId=club", "/feed.html?connect=player-123"]) {
      expect(getSafeReturnToUrl(url(target), BASE, ORIGIN)).toBe(ORIGIN + target);
    }
    expect(getSafeReturnToUrl(url("https://evil.example/feed?activity=session-123"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("//evil.example/feed.html?connect=player-123"), BASE, ORIGIN)).toBeNull();
  });

  it("rejects clean routes that are not ported auth destinations", () => {
    expect(getSafeReturnToUrl(url("/signin"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("/privacy"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("/drills/unknown"), BASE, ORIGIN)).toBeNull();
    expect(getSafeReturnToUrl(url("https://evil.example/athlete"), BASE, ORIGIN)).toBeNull();
  });
});
