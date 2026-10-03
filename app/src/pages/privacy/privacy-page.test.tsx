import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./PrivacyPage";
import { POLICY_CONTACT_EMAIL, POLICY_SECTIONS, sectionNumber } from "./privacy-sections";

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

  it("routes every privacy request to the published contact address", () => {
    expect(POLICY_CONTACT_EMAIL).toBe("nolanj@posetek.net");
    const mailtos = [...html.matchAll(/href="mailto:([^"]+)"/g)].map(match => match[1]);
    expect(mailtos.length).toBeGreaterThanOrEqual(6);
    expect(new Set(mailtos)).toEqual(new Set([POLICY_CONTACT_EMAIL]));
  });
});
