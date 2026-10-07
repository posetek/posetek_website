import { describe, expect, it, vi } from "vitest";
import { loadAuthorizedReport } from "./loadReport";
import { expandedRequest } from "./expandedQuery";
import { reportPayload, scopeFor } from "./expanded";
import { previewInsights } from "./preview";
import { createInsightsRequestGuard } from "./navigation";

const request = expandedRequest("orgId=northfield&teamId=harbor&testingStatus=noRecordedTests&rosterSearch=Avery", new Date("2026-09-17T04:00:00Z"));
const scope = scopeFor(request, "admin");
const report = () => ({ ...previewInsights(request), filters: reportPayload(request, scope).filters });

describe("direct authorized admin reporting", () => {
  it("loads one complete report with the exact supported scope and filters", async () => {
    const read = vi.fn().mockResolvedValue(report());
    const result = await loadAuthorizedReport(request, scope, read, () => true, { adminOnly: true });
    expect(result?.scope.access).toBe("admin");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ scope: { kind: "team", organizationId: "northfield", teamId: "harbor" }, nameSearch: "Avery", timeZone: "America/Los_Angeles", startDate: request.startDate, endDate: request.endDate, testingMode: "cumulative", filters: { testingStatus: "noRecordedTests" }, pageSize: 25 });
  });
  it("rejects revoked admin authority even when organization reporting remains allowed", async () => {
    const result = report(); result.scope.access = "manager";
    await expect(loadAuthorizedReport(request, scope, async () => result, () => true, { adminOnly: true })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("allows the unchanged manager reporting contract outside the admin shell", async () => {
    const result = report(); result.scope.access = "manager";
    expect(await loadAuthorizedReport(request, scope, async () => result, () => true)).toEqual(result);
  });
  it("does not retain a delayed report after account or selection changes", async () => {
    let uid = "first";
    const guard = createInsightsRequestGuard(() => uid), isCurrent = guard.begin(uid);
    let complete!: (value: ReturnType<typeof report>) => void;
    const pending = loadAuthorizedReport(request, scope, () => new Promise(resolve => { complete = resolve; }), isCurrent, { adminOnly: true });
    uid = "second";
    complete(report());
    expect(await pending).toBeNull();
  });
  it("rejects a report that no longer matches the reviewed selection", async () => {
    const result = report(); result.filters = {};
    await expect(loadAuthorizedReport(request, scope, async () => result, () => true, { adminOnly: true })).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("never starts a read for an already-invalidated account", async () => {
    const read = vi.fn().mockResolvedValue(report());
    expect(await loadAuthorizedReport(request, scope, read, () => false, { adminOnly: true })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
