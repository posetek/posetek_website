import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { compile } from "sass";
import { fileURLToPath } from "node:url";
import AdminHeader from "./AdminHeader";

describe("admin navigation", () => {
  it("combines the directory while retaining Device performance, User issues and the account menu", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready email="admin@example.test" onSignOut={() => {}} /></MemoryRouter>);
    for (const path of ["accounts", "programs", "analysis", "drills", "ai-incidents", "device-performance", "user-issues", "feedback"]) expect(html).toContain(`href="/admin/${path}"`);
    expect(html).not.toContain('href="/admin"');
    expect((html.match(/class="admin-section-link/g) ?? []).length).toBe(8);
    expect(html).toContain("People &amp; organizations");
    expect(html).toContain("Device performance");
    expect(html.indexOf("AI incidents")).toBeLessThan(html.indexOf("Device performance"));
    expect(html).toContain('href="/feed"');
    expect(html).toContain("Community feed");
    expect(html).toContain('href="/admin/access"');
    expect(html).toContain("Account access");
    expect(html).toContain("Technique review");
    expect(html).toMatch(/href="\/insights\?from=organization&amp;view=overview"[^>]*>Overview<\/a>/);
    expect(html).toContain("Coaching hub");
    expect(html).toContain("System &amp; User Insights");
    expect(html).toContain(">Overview<");
  });

  it("marks Device performance active on its fleet and device routes", () => {
    for (const route of ["/admin/device-performance", "/admin/device-performance/0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5"]) {
      const html = renderToStaticMarkup(<MemoryRouter initialEntries={[route]}><AdminHeader ready onSignOut={() => {}} /></MemoryRouter>);
      expect(html, route).toMatch(/class="admin-section-link active"[^>]*href="\/admin\/device-performance"/);
    }
  });

  it("does not expose ready-only navigation or account actions while signed out", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready={false} onSignOut={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('href="/admin/analysis"');
    expect(html).not.toContain('aria-label="Admin sections"');
    expect(html).not.toContain('aria-label="Admin account menu"');
    expect(html).not.toContain("Sign out");
  });

  it("carries organization and team only into tools that support their scope", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts?orgId=club&teamId=team"]}><AdminHeader ready onSignOut={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('href="/admin?orgId=club&amp;teamId=team"');
    expect(html).toContain('href="/admin/accounts?orgId=club&amp;teamId=team"');
    expect(html).toContain('href="/admin/analysis"');
    expect(html).toContain('href="/admin/device-performance"');
  });

  it("keeps the admin scope when leaving Device performance, whose own filters stay behind", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/device-performance?orgId=club&teamId=team&drill=sprint&cursor=p2"]}><AdminHeader ready onSignOut={() => {}} /></MemoryRouter>);
    expect(html).toContain('href="/admin/accounts?orgId=club&amp;teamId=team"');
    expect(html).not.toContain("drill=sprint");
    expect(html).not.toContain('aria-label="Admin organization scope"');
  });

  it("omits header scope selectors while retaining the accessible account menu", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready preview email="admin@posetek.test" onSignOut={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('aria-label="Current scope: All organizations"');
    expect(html).not.toContain('aria-label="Admin organization scope"');
    expect(html).not.toContain('aria-label="Admin team scope"');
    expect(html).toContain('aria-label="Admin account menu"');
  });
});

// A static check of the compiled cascade, not a browser measurement: between
// 761 and 1250px the ten tabs must wrap rather than overflow a horizontal
// scroller whose scrollbar is hidden (admin-dashboard.scss sets
// scrollbar-width: none). The 1024px browser check is recorded as pending.
describe("admin navigation layout rules", () => {
  const css = (file: string) => compile(fileURLToPath(new URL(`../${file}`, import.meta.url)), { style: "compressed" }).css;
  const block = (source: string, query: string) => {
    const start = source.indexOf(`@media(${query})`);
    if (start < 0) return "";
    let depth = 0;
    for (let index = source.indexOf("{", start); index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
    }
    return "";
  };

  it("wraps the ten tabs between 761 and 1250px instead of hiding one behind the scroller", () => {
    const dashboard = css("admin-dashboard.scss");
    const tablet = block(dashboard, "min-width: 761px)and (max-width: 1250px") || block(dashboard, "min-width:761px)and (max-width:1250px");
    expect(tablet).toMatch(/\.pt-admin \.admin-nav\{[^}]*flex-wrap:wrap/);
    expect(tablet).toMatch(/\.pt-admin \.admin-nav\{[^}]*overflow-x:visible/);
    expect(tablet).toMatch(/\.pt-admin \.admin-nav-link\{[^}]*flex:0 0 auto/);
    const narrowTablet = block(dashboard, "min-width: 761px)and (max-width: 1100px") || block(dashboard, "min-width:761px)and (max-width:1100px");
    expect(narrowTablet).toMatch(/\.admin-nav-link \.material-symbols-outlined\{display:none/);
    // The dashboard stylesheet is imported after admin-surfaces.scss (AdminPage.tsx), so these rules win the tie.
  });

  it("no longer hard-codes seven columns for the phone tab bar", () => {
    const surfaces = css("admin-surfaces.scss");
    expect(surfaces).not.toMatch(/repeat\(7,/);
    expect(surfaces).toMatch(/repeat\(10,/);
  });
});
