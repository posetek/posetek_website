import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./PrivacyPage";
import { POLICY_CONTACT_EMAIL, POLICY_LAST_UPDATED, POLICY_SECTIONS, sectionNumber } from "./privacy-sections";

const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/privacy"]}><PrivacyPage /></MemoryRouter>);

describe("privacy policy page", () => {
  it("publishes no unresolved draft placeholders or drafting notes", () => {
    expect(html).not.toContain("[[");
    expect(html).not.toContain("]]");
    expect(html).not.toMatch(/OPTIONAL|CONFIRM|PLACEHOLDER|IMPLEMENTATION NOTES/);
  });

  it("renders every section once, in order, under a stable anchor", () => {
    expect(POLICY_SECTIONS).toHaveLength(14);
    expect(new Set(POLICY_SECTIONS.map(section => section.id)).size).toBe(POLICY_SECTIONS.length);
    const rendered = [...html.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]);
    expect(rendered).toEqual(POLICY_SECTIONS.map(section => section.id));
  });

  it("links every table-of-contents entry and in-text reference to a section on the page", () => {
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
    expect(anchors.slice(0, POLICY_SECTIONS.length)).toEqual(POLICY_SECTIONS.map(section => section.id));
    for (const anchor of anchors) expect(html).toContain(`<section id="${anchor}"`);
  });

  it("numbers the children's privacy cross-reference from the section list", () => {
    expect(sectionNumber("how-we-share-information")).toBe(6);
    expect(html).toContain('<a href="#how-we-share-information">Section 6</a>');
  });

  it("keeps the first-party usage measurement disclosure the Insights release relies on", () => {
    expect(html).toContain("estimated active time and feature categories");
    expect(html).toContain("do not contain page addresses, typed text, or screen recordings");
    expect(html).toContain("Detailed active-use records are retained for 90 days and daily usage summaries for 24 months");
  });

  it("discloses prospective account attribution, anonymous shared visits and unchanged historical anonymity", () => {
    expect(POLICY_LAST_UPDATED).toBe("October 5, 2026");
    const section = html.match(/<section id="app-feedback"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(section).toContain("before you answer");
    expect(section).toContain("requires a signed-in account");
    expect(section).toContain("anonymous feedback when signed out");
    expect(section).toContain("account ID, account name and email address when available");
    expect(section).toContain("PoseTek administrators can see this account information with the response");
    expect(section).toContain("not a verified real-world person");
    expect(section).toContain("earlier anonymous form remain anonymous");
    expect(section).toContain("not linked retrospectively");
    expect(section).toContain("New anonymous responses contain no account author information");
    expect(section).toContain("diagnostic records do not store the submitting account");
    expect(section).toContain("expire after 90 days");
  });

  it("preserves the under-13 consent protections and limits on making children's information public", () => {
    expect(html).toContain("without verifiable consent from a parent or legal guardian");
    expect(html).toContain("do not make children&#x27;s information publicly available");
    expect(html).toContain("withdraw consent previously given");
    expect(html).toContain("no public profiles");
    expect(html).toContain("before the changes take effect");
  });

  it("routes every privacy request to the published contact address", () => {
    expect(POLICY_CONTACT_EMAIL).toBe("nolanj@posetek.net");
    const mailtos = [...html.matchAll(/href="mailto:([^"]+)"/g)].map(match => match[1]);
    expect(mailtos.length).toBeGreaterThanOrEqual(6);
    expect(new Set(mailtos)).toEqual(new Set([POLICY_CONTACT_EMAIL]));
  });
});
