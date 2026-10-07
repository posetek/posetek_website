import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminBreadcrumbs, { isPlayerDetailRoute, PlayerHierarchyBreadcrumbs } from "./AdminBreadcrumbs";
import { fleetPath } from "../lib/devicePerformance";

const INSTALL = "0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5";

describe("admin account breadcrumbs", () => {
  it("maps a deep rep route back through the scoped player results hierarchy", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/player-1/results/change-of-direction/rep-9?orgId=club&teamId=u15"]}><AdminBreadcrumbs /></MemoryRouter>);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/admin/accounts?orgId=club&amp;teamId=u15"');
    expect(html).toContain('href="/admin/accounts/player/player-1/results/change-of-direction?orgId=club&amp;teamId=u15"');
    expect(html).toContain("change of direction");
    expect(html).toContain('aria-current="page">Rep');
  });

  it("stays absent outside player detail and device report routes", () => {
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/drills"]}><AdminBreadcrumbs /></MemoryRouter>)).toBe("");
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/device-performance?drill=jump"]}><AdminBreadcrumbs /></MemoryRouter>)).toBe("");
  });
  it("names the unified workspace even for a compatible legacy report return", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/player-1?returnTo=" + encodeURIComponent("/admin?view=workouts&start=2026-09-01")]}><AdminBreadcrumbs /></MemoryRouter>);
    expect(html).toContain("Organizations"); expect(html).not.toContain(">Overview<");
    expect(html).toContain('href="/admin?view=workouts&amp;start=2026-09-01"');
  });
});

describe("device performance breadcrumbs", () => {
  it("reads Device performance → device label, back to the same filters on the first page", () => {
    const search = "?orgId=club&drill=jump&sort=lastSeen&view=executor&section=uploads&cursor=d2&attempt=3f2a9c1e-7b4d-4e8a-9c21-5d6e7f8a9b0c";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[{ pathname: `/admin/device-performance/${INSTALL}`, search, state: { deviceLabel: "Station 2 phone" } }]}><AdminBreadcrumbs /></MemoryRouter>,
    );
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/admin/device-performance?orgId=club&amp;drill=jump&amp;sort=lastSeen"');
    expect(html).toContain('aria-current="page">Station 2 phone');
    expect(html).not.toContain("cursor=");
  });

  it("falls back to the short install id before the label is known", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/device-performance/${INSTALL}`]}><AdminBreadcrumbs /></MemoryRouter>);
    expect(html).toContain('href="/admin/device-performance"');
    expect(html).toContain('aria-current="page">Device 0d5c9a1e');
  });

  it("escapes a stored label and agrees with the report library's fleet link", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[{ pathname: `/admin/device-performance/${INSTALL}`, search: "?q=station&acursor=a1", state: { deviceLabel: "<img src=x onerror=alert(1)>" } }]}><AdminBreadcrumbs /></MemoryRouter>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain(`href="${fleetPath("?q=station&acursor=a1")}"`);
  });
});


describe("current player hierarchy breadcrumbs", () => {
  it("owns all PlayerDetail routes but leaves rep and workout editor headers separate", () => {
    for (const suffix of ["", "/", "/results", "/results/", "/results/sprint", "/results/sprint/"]) expect(isPlayerDetailRoute(`/admin/accounts/player/p${suffix}`), suffix).toBe(true);
    for (const path of ["/admin/accounts/player/p/results/sprint/rep", "/admin/accounts/player/p/plan/plan/workout/w", "/admin/accounts"]) expect(isPlayerDetailRoute(path), path).toBe(false);
  });
  it("retains deep results crumbs with current parents and the validated return after transfer", () => {
    const back = "/admin/accounts?orgId=old&teamId=old&reportView=testing";
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/accounts/player/p/results/change-of-direction?orgId=old&teamId=old&returnTo=${encodeURIComponent(back)}`]}>
      <PlayerHierarchyBreadcrumbs player={{ name: "Alex", organizationId: "current", teamId: "u17" }} />
    </MemoryRouter>);
    expect(html).toContain(">Alex</a>"); expect(html).toContain(">Results</a>"); expect(html).toContain('aria-current="page">change of direction');
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g), match => new URL(match[1].replaceAll("&amp;", "&"), "https://posetek.net"));
    for (const url of hrefs.filter(url => url.pathname.startsWith("/admin/accounts/player/"))) {
      expect(url.searchParams.get("orgId")).toBe("current"); expect(url.searchParams.get("teamId")).toBe("u17"); expect(url.searchParams.get("returnTo")).toBe(back);
    }
  });
  it("uses actual ownership for parent links after a transfer without loading another context", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/p?orgId=old&teamId=old&reportView=testing&reportTimezone=UTC&search=Ana&page=2"]}>
      <PlayerHierarchyBreadcrumbs player={{ name: "Alex", organizationId: "current", teamId: "u17" }} />
    </MemoryRouter>);
    expect(html).toContain("Organizations"); expect(html).toContain("Organization"); expect(html).toContain(">Team<");
    expect(html).toContain("orgId=current"); expect(html).toContain("teamId=u17"); expect(html).not.toContain("orgId=old"); expect(html).not.toContain("teamId=old");
    expect(html).toContain("reportTimezone=UTC"); expect(html).not.toContain("search=Ana"); expect(html).toContain('aria-current="page">Alex');
  });
  it("keeps unassigned and independent people reachable without inventing a team", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/p"]}>
      <PlayerHierarchyBreadcrumbs player={{ name: "Alex", organizationId: "club", teamId: null }} />
    </MemoryRouter>);
    expect(html).toContain(">Unassigned<"); expect(html).toContain("directoryLookup=unassigned"); expect(html).not.toContain("teamId=");
  });
});
