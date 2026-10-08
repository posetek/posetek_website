import { afterEach, describe, expect, it, vi } from "vitest";
import { expandedRequest } from "../../insights/lib/expandedQuery";
import { previewInsights } from "../../insights/lib/preview";
import type { ExpandedInsights, InsightScope } from "../../insights/lib/expanded";
import { assertWorkspaceMetrics, createWorkspaceMetricsTransport, workspaceMetricsPayload, workspacePayloadKey } from "./workspaceMetricsData";

const now = new Date("2026-10-06T20:00:00Z");
const scope: InsightScope = { kind: "organization", organizationId: "northfield" };
const search = "orgId=northfield&start=2026-09-01&end=2026-10-01&timezone=America/Los_Angeles&testingWindow=cumulative";
const payload = (ids?: string[]) => workspaceMetricsPayload(search, scope, ids, now);
function report(input = payload()): ExpandedInsights {
  const data = previewInsights(expandedRequest(search, now));
  data.scope = { ...input.scope, label: "Fixture scope", access: "admin", assignedTeamsOnly: false };
  data.filters = input.filters;
  data.nameSearch = input.nameSearch || "";
  if (input.rosterPlayerIds) data.rosterMetrics = input.rosterPlayerIds.map(playerId => ({ playerId, status: "included", player: { ...data.players[0], id: playerId, organizationId: "northfield", teamId: "harbor" } }));
  return data;
}
afterEach(() => vi.useRealTimers());
describe("shared workspace reporting", () => {
  it("requests20 rows and only visible IDs, with no private labels or client identity", () => {
    const actual = payload(["z", "a"]);
    expect(actual).toMatchObject({ pageSize: 20, scope, rosterPlayerIds: ["a", "z"], startDate: "2026-09-01", endDate: "2026-10-01" });
    expect(actual).not.toHaveProperty("uid");
  });
  it("has no lookup for summary-only or empty roster", () => {
    expect(payload()).not.toHaveProperty("rosterPlayerIds");
    expect(payload([])).not.toHaveProperty("rosterPlayerIds");
  });
  it.each([["a", "a"], Array.from({ length: 21 }, (_, i) => `p${i}`), ["bad/id"], [""]].map(ids => ({ ids })))("rejects invalid or unbounded visible lookup $ids", ({ ids }) => {
    expect(() => payload(ids)).toThrow(/visible players changed/);
  });
  it("reuses the same selection across display views and ignores directory query fields", () => {
    expect(workspacePayloadKey(payload())).toBe(workspacePayloadKey(workspaceMetricsPayload(search + "&view=testing&search=email@example.test&page=3", scope, undefined, now)));
  });
  it("validates organization rows without requiring the organization to be a team scope", () => {
    const input = payload(["a"]);
    expect(() => assertWorkspaceMetrics(report(input), input)).not.toThrow();
  });
  it("rejects a stale player organization or team without retaining metrics", () => {
    const input = payload(["a"]), data = report(input);
    if (data.rosterMetrics?.[0].status === "included") data.rosterMetrics[0].player.organizationId = "other";
    expect(() => assertWorkspaceMetrics(data, input)).toThrow(/organization or team changed/);
    const teamInput = { ...input, scope: { kind: "team", organizationId: "northfield", teamId: "another" } as InsightScope };
    expect(() => assertWorkspaceMetrics(report(teamInput), teamInput)).toThrow(/organization or team changed/);
  });
  it("accepts explicit reporting exclusion but rejects history attached to it", () => {
    const input = payload(["a"]), data = report(input);
    data.rosterMetrics = [{ playerId: "a", status: "excluded" }];
    expect(() => assertWorkspaceMetrics(data, input)).not.toThrow();
    (data.rosterMetrics[0] as unknown as Record<string, unknown>).player = data.players[0];
    expect(() => assertWorkspaceMetrics(data, input)).toThrow(/Excluded reporting evidence/);
  });
  it("rejects absent, duplicate or unexpected lookup rows", () => {
    const input = payload(["a", "b"]), data = report(input);
    delete data.rosterMetrics;
    expect(() => assertWorkspaceMetrics(data, input)).toThrow(/not returned metrics/);
    data.rosterMetrics = [{ playerId: "a", status: "excluded" }, { playerId: "a", status: "excluded" }];
    expect(() => assertWorkspaceMetrics(data, input)).toThrow(/not returned metrics/);
    data.rosterMetrics[1].playerId = "unexpected";
    expect(() => assertWorkspaceMetrics(data, input)).toThrow(/no longer match/);
  });
  it("shares concurrent identical reads without caching settled private data", async () => {
    const input = payload(["a"]);
    let settle!: (data: ExpandedInsights) => void;
    const read = vi.fn(() => new Promise<ExpandedInsights>(resolve => { settle = resolve; }));
    const transport = createWorkspaceMetricsTransport(read);
    const first = transport.load("admin", input, () => true), second = transport.load("admin", input, () => true);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    settle(report(input));
    expect(await first).toEqual(await second);
    read.mockResolvedValueOnce(report(input));
    await transport.load("admin", input, () => true);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("drops late account and scope results", async () => {
    const input = payload(["a"]);
    let settle!: (data: ExpandedInsights) => void, current = true;
    const transport = createWorkspaceMetricsTransport(() => new Promise(resolve => { settle = resolve; }));
    const pending = transport.load("first", input, () => current);
    await Promise.resolve();
    current = false;
    transport.observeIdentity("second");
    settle(report(input));
    expect(await pending).toBeNull();
  });
  it("does not start a request for an inactive selection", async () => {
    const read = vi.fn(), transport = createWorkspaceMetricsTransport(read);
    expect(await transport.load("admin", payload(), () => false)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("bounds cold-projection rebuild retries and retains no partial totals", async () => {
    vi.useFakeTimers();
    const expected = report();
    const read = vi.fn().mockRejectedValueOnce({ code: "failed-precondition", details: { reason: "insights-rebuild-required" } }).mockResolvedValue(expected);
    const onRebuild = vi.fn();
    const pending = createWorkspaceMetricsTransport(read).load("admin", payload(), () => true, onRebuild);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(expected);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });
  it("rejects downgraded admin access even if manager reports remain available", async () => {
    const data = report(); data.scope.access = "manager";
    await expect(createWorkspaceMetricsTransport(async () => data).load("admin", payload(), () => true)).rejects.toMatchObject({ code: "permission-denied" });
  });
});
