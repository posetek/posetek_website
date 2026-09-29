import { afterEach, describe, expect, it, vi } from "vitest";
import { completeReport } from "./completeReport";
const cold = { code: "functions/failed-precondition", details: { reason: "insights-rebuild-required" } };
afterEach(() => vi.useRealTimers());
describe("complete Insights loading", () => {
  it("retries only the explicit cold-projection signal and returns a complete result", async () => {
    vi.useFakeTimers(); const load = vi.fn().mockRejectedValueOnce(cold).mockResolvedValue({ complete: true }), status = vi.fn();
    const result = completeReport(load, () => true, status); await vi.runAllTimersAsync();
    expect(await result).toEqual({ complete: true }); expect(load).toHaveBeenCalledTimes(2); expect(status).toHaveBeenCalledOnce();
  });
  it("does not retry changed cursors or access errors", async () => {
    for (const error of [{ code: "functions/failed-precondition" }, { code: "functions/permission-denied", details: cold.details }]) {
      const load = vi.fn().mockRejectedValue(error); await expect(completeReport(load, () => true)).rejects.toBe(error); expect(load).toHaveBeenCalledOnce();
    }
  });
  it("limits cold rebuilding to five attempts", async () => {
    vi.useFakeTimers(); const load = vi.fn().mockRejectedValue(cold);
    const check = expect(completeReport(load, () => true)).rejects.toBe(cold); await vi.runAllTimersAsync(); await check;
    expect(load).toHaveBeenCalledTimes(5);
  });
  it("stops after a scope change and discards a late response", async () => {
    vi.useFakeTimers(); let current = true; const load = vi.fn().mockRejectedValueOnce(cold).mockResolvedValue("private");
    const result = completeReport(load, () => current, () => { current = false; }); await vi.runAllTimersAsync();
    expect(await result).toBeNull(); expect(load).toHaveBeenCalledOnce();
    expect(await completeReport(async () => { current = false; return "private"; }, () => current)).toBeNull();
  });
});
