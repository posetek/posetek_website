import { describe, expect, it } from "vitest";
import { adminAccountResetPath, adminDirectoryPath, adminPlayerPath, adminPlayerReturn, adminPlannerPath, adminPlayerLinkFromReport, adminToolKey, adminToolPath, legacyOrganizationsPath, legacyAdminWorkspacePath, parseAdminDirectoryState, supportsAdminScope, validatedAdminReturn, workspaceReportSearch, workspaceReportRequest, withWorkspaceReport } from "./adminNavigation";
import { accountDestination } from "../../landing/account-entry";

describe("admin directory navigation", () => {
  it("round trips scope, lookup, tab, search and page", () => {
    const state = { orgId: "club", teamId: "u15", directoryTab: "staff" as const, search: "Ana & Jo", page: 3, directoryLookup: "unassigned" as const };
    expect(parseAdminDirectoryState(adminDirectoryPath(state).split("?")[1])).toEqual(state);
    expect(legacyOrganizationsPath("?orgId=club&teamId=u15")).toBe("/admin/accounts?orgId=club&teamId=u15&directoryTab=teams");
  });
  it("opens each panel in one link and retains its directory through planner returns", () => {
    const state = parseAdminDirectoryState("?orgId=club&teamId=u15&search=ana&page=2");
    const player = adminPlayerPath("player-1", "workouts", state);
    expect(new URL(player, "https://posetek.net").searchParams.get("playerTab")).toBe("workouts");
    expect(adminPlayerReturn(player.split("?")[1])).toBe(adminDirectoryPath(state));
    const planner = new URL(adminPlannerPath("player-1", player.split("?")[1]), "https://posetek.net");
    expect(planner.searchParams.get("players")).toBe("player-1");
    expect(planner.searchParams.get("orgId")).toBe("club");
    const back = validatedAdminReturn(planner.searchParams.get("returnTo"))!;
    expect(new URL(back, "https://posetek.net").searchParams.get("playerTab")).toBe("workouts");
    expect(adminPlayerReturn(back.split("?")[1])).toBe(adminDirectoryPath(state));
  });
  it("retains reporting filters without interpreting their page as directory pagination", () => {
    const report = "?orgId=club&view=testing&start=2026-09-01&testingStatus=noRecordedTests&rosterSearch=ana&page=2&cursor=opaque";
    const link = adminPlayerLinkFromReport("ana", "profile", report, { teamId: "u15" });
    const query = new URL(link, "https://posetek.net").searchParams;
    expect(query.get("returnTo")).toBe("/admin" + report);
    expect(query.get("teamId")).toBe("u15");
    expect(query.has("page")).toBe(false);
  });
  it.each(["https://evil.test/admin", "//evil.test/admin", "/administrator", "/admin/../signin", "/admin/accounts/%2fother", "/admin\\accounts", "/admin?x=1\n", "/admin/accounts/player/%00", "/admin/accounts/player/%1f", "/admin/accounts/player/%7f", "/admin/accounts/player/\u007f", "/admin/accounts/player/../../programs"])('rejects unsafe return %s', path => expect(validatedAdminReturn(path)).toBeUndefined());
  it.each(["/admin/accounts/player/ana/results", "/admin/accounts/player/ana/results/sprint", "/admin/accounts/player/ana/results/sprint/rep-1?orgId=club"])('preserves known result and rep return %s', path => expect(validatedAdminReturn(path)).toBe(path));
  it("validates optional scope and bounds query input", () => {
    expect(parseAdminDirectoryState("?orgId=a/b&teamId=ok&page=-9&directoryTab=evil")).toMatchObject({ teamId: "ok", directoryTab: "players", page: 0 });
    expect(parseAdminDirectoryState("?page=999999").page).toBe(1000);
  });
});

describe("tool-specific queries", () => {
  it("keeps phone filters separate from reporting and directory state", () => {
    expect(adminToolPath("/admin/device-performance", "/admin", "?orgId=club&teamId=t&start=2026-09-01&view=testing", "?phoneStart=2026-10-01&phoneRun=run&orgId=other")).toBe("/admin/device-performance?phoneStart=2026-10-01&phoneRun=run");
    expect(supportsAdminScope("/admin/device-performance/team-sessions/event")).toBe(false);
    expect(supportsAdminScope("/admin/analysis")).toBe(false);
    expect(supportsAdminScope("/admin/ai-incidents")).toBe(false);
  });
  it("retains workspace reporting state through its compatible home destination", () => {
    const url = new URL(adminToolPath("/admin", "/admin/accounts", "?orgId=club&reportView=usage&reportStart=2026-09-01", "?orgId=other"), "https://posetek.net");
    expect(url.pathname).toBe("/admin/accounts");
    expect(url.searchParams.get("reportView")).toBe("usage");
    expect(url.searchParams.get("reportStart")).toBe("2026-09-01");
    expect(url.searchParams.get("orgId")).toBe("club");
  });
  it("does not resurrect organization or team after an explicit global selection", () => {
    expect(adminToolPath("/admin/accounts", "/admin/accounts", "", "?orgId=old&teamId=old&search=Ana&page=2")).toBe("/admin/accounts");
    const directory = new URL(adminToolPath("/admin/accounts", "/admin", "", "?orgId=old&teamId=old&search=Ana&page=2"), "https://posetek.net");
    expect(directory.searchParams.has("orgId")).toBe(false);
    expect(directory.searchParams.has("teamId")).toBe(false);
    expect(directory.searchParams.has("page")).toBe(false);
    expect(directory.searchParams.has("search")).toBe(false);
  });
  it("retains actor scope through unsupported tools without treating phone filters as reporting filters", () => {
    const report = new URL(adminToolPath("/admin/accounts", "/admin/device-performance", "?phoneStart=2026-10-01", "?reportView=usage&orgId=old&reportPage=2&reportCursor=old", { orgId: "club", teamId: "u15" }), "https://posetek.net");
    expect(report.searchParams.get("orgId")).toBe("club");
    expect(report.searchParams.get("teamId")).toBe("u15");
    expect(report.searchParams.get("reportView")).toBe("usage");
    expect(report.searchParams.has("phoneStart")).toBe(false);
    expect(report.searchParams.has("reportCursor")).toBe(false);
    expect(adminToolPath("/admin/ai-incidents", "/admin", "?orgId=club&teamId=u15", "?q=failure&incident=job-1&orgId=old")).toBe("/admin/ai-incidents?q=failure&incident=job-1");
  });
  it("keeps reporting return pagination out of the directory", () => {
    const player = new URL(adminPlayerLinkFromReport("ana", "results", "?page=2&cursor=opaque&rosterSearch=Ana", { orgId: "club" }), "https://posetek.net");
    const directory = new URL(adminToolPath("/admin/accounts", player.pathname, player.search, "?orgId=club&search=Jo&page=1"), "https://posetek.net");
    expect(directory.searchParams.has("search")).toBe(false);
    expect(directory.searchParams.has("page")).toBe(false);
    expect(directory.searchParams.get("reportSearch")).toBe("Ana");
    expect(directory.searchParams.get("reportPage")).toBe("2");
    expect(directory.searchParams.has("cursor")).toBe(false);
    expect(directory.searchParams.has("rosterSearch")).toBe(false);
  });
  it("workspace header preserves a global reporting origin instead of narrowing to the opened player", () => {
    const report = "?view=testing&rosterSearch=Ana&page=2&cursor=opaque&start=2026-09-01";
    const player = new URL(adminPlayerLinkFromReport("ana", "profile", report, { orgId: "club", teamId: "u15" }), "https://posetek.net");
    const destination = new URL(adminToolPath("/admin", player.pathname, player.search, "?orgId=other&view=usage"), "https://posetek.net");
    expect(destination.pathname).toBe("/admin/accounts");
    expect(Object.fromEntries(new URLSearchParams(workspaceReportSearch(destination.search)))).toEqual(Object.fromEntries(new URLSearchParams(report)));
    const planner = new URL(adminPlannerPath("ana", player.search), "https://posetek.net");
    expect(new URL(adminToolPath("/admin", planner.pathname, planner.search), "https://posetek.net").search).toBe(destination.search);
  });
  it("keeps phone, team-session and advanced query meanings independent", () => {
    expect(adminToolKey("/admin/device-performance/team-sessions/event-1")).toBe("team-sessions");
    expect(adminToolKey("/admin/device-performance/advanced/install-1")).toBe("device-facts");
    expect(adminToolPath("/admin/device-performance", "/admin/device-performance/team-sessions/event-1", "?preview=1", "?phoneStart=2026-10-01&phoneAlgorithm=all")).toBe("/admin/device-performance?phoneStart=2026-10-01&phoneAlgorithm=all&preview=1");
  });
  it("clears record destinations on an account change while retaining the tool entry", () => {
    expect(adminAccountResetPath("/admin/accounts/player/ana/results/sprint")).toBe("/admin/accounts");
    expect(adminAccountResetPath("/admin/device-performance/team-sessions/private-event")).toBe("/admin/device-performance");
    expect(adminAccountResetPath("/admin/programs")).toBe("/admin/programs");
  });
});

describe("unified workspace reporting state", () => {
  it.each(["/admin/accounts?orgId=club&search=Ana&page=2&reportView=workouts&reportPage=3&reportCursor=opaque&reportStart=2026-09-01&reportMode=attention", "/admin?orgId=club&view=testing&rosterSearch=Ana&page=2&cursor=opaque&testingWindow=period"])("preserves signed-in admin return state for %s", target => {
    const search = "?returnTo=" + encodeURIComponent(target), base = "https://posetek.net/signin", origin = "https://posetek.net";
    expect(accountDestination("admin", null, search, base, origin)).toBe(origin + target);
    expect(accountDestination("player", "athlete", search, base, origin)).not.toContain("/admin");
  });
  it("keeps directory and reporting search/pages distinct through all detail returns", () => {
    const state = parseAdminDirectoryState("?orgId=club&search=email&page=3&reportView=workouts&reportSearch=Ana&reportPage=2&reportCursor=opaque&reportWorkoutStatus=endedEarly&reportMode=attention&reportStart=2026-09-01&reportEnd=2026-09-30&reportTestingWindow=period");
    expect(parseAdminDirectoryState(adminDirectoryPath(state).split("?")[1])).toEqual(state);
    const report = new URLSearchParams(workspaceReportSearch(state));
    expect(report.get("rosterSearch")).toBe("Ana"); expect(report.get("page")).toBe("2");
    expect(report.has("search")).toBe(false); expect(report.get("cursor")).toBe("opaque");
    const player = new URL(adminPlayerPath("athlete", "workouts", state), "https://posetek.net");
    const planner = new URL(adminPlannerPath("athlete", player.search), "https://posetek.net");
    const back = new URL(planner.searchParams.get("returnTo")!, "https://posetek.net");
    expect(adminPlayerReturn(back.search)).toBe(adminDirectoryPath(state));
    expect(new URL(adminToolPath("/admin/accounts", player.pathname, player.search), "https://posetek.net").search).toBe(new URL(adminDirectoryPath(state), "https://posetek.net").search);
  });
  it("translates legacy reporting links without interpreting old page or name search as directory state", () => {
    const url = new URL(legacyAdminWorkspacePath("?orgId=club&view=testing&page=2&cursor=opaque&rosterSearch=Ana&start=2026-09-01&end=2026-09-30&timezone=UTC&testingWindow=period&testingStatus=noRecordedTests&phoneStart=2026-01-01"), "https://posetek.net");
    expect(url.pathname).toBe("/admin/accounts"); expect(url.searchParams.get("reportView")).toBe("testing");
    expect(url.searchParams.get("reportMode")).toBe("attention"); expect(url.searchParams.get("reportSearch")).toBe("Ana");
    expect(url.searchParams.has("page")).toBe(false); expect(url.searchParams.has("phoneStart")).toBe(false);
    expect(url.searchParams.get("reportPage")).toBe("2"); expect(url.searchParams.get("reportCursor")).toBe("opaque");
  });
  it("changes a reporting period without dropping ordinary directory search and page", () => {
    const state = parseAdminDirectoryState("?search=Ana&page=3&reportView=testing&reportCursor=old&reportPage=2");
    const next = withWorkspaceReport(state, { startDate: "2026-09-01", endDate: "2026-09-30", cursor: "", page: 0 });
    expect(next.search).toBe("Ana"); expect(next.page).toBe(3); expect(next.reportCursor).toBeUndefined();
    expect(workspaceReportRequest(next, new Date("2026-10-07T00:00:00Z"))).toMatchObject({ view: "testing", startDate: "2026-09-01", endDate: "2026-09-30" });
  });
  it("validates namespaced view/filter inputs and bounds reporting pagination independently", () => {
    const state = parseAdminDirectoryState("?page=2&reportPage=99999&reportView=community&reportUsageStatus=invalid&reportCursor=" + "a".repeat(3000));
    expect(state.page).toBe(2); expect(state.reportPage).toBe(1000); expect(state.reportView).toBe("overview");
    expect(state.reportUsageStatus).toBe(""); expect(state.reportCursor).toHaveLength(2000);
    expect(legacyOrganizationsPath("?orgId=club&reportView=usage&reportStart=2026-09-01")).toContain("directoryTab=teams&reportView=usage&reportStart=2026-09-01");
  });
});
