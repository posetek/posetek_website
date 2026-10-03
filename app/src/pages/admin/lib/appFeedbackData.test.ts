import { beforeEach, describe, expect, it, vi } from "vitest";

const { call, callable } = vi.hoisted(() => ({ call: vi.fn(), callable: vi.fn() }));
vi.mock("../../../lib/firebase", () => ({ cloud: { httpsCallable: callable } }));
import { loadAppFeedback } from "./appFeedbackData";

const data = { responses: [], nextCursor: null, metrics: { opened: 90, started: 60, submitted: 40 }, retentionDays: 90 };

describe("app feedback private admin reads", () => {
  beforeEach(() => { call.mockReset(); callable.mockReset(); callable.mockReturnValue(call); });

  it("reads the protected callable and forwards the exact cursor for the next page", async () => {
    call.mockResolvedValue({ data });
    expect((await loadAppFeedback()).metrics.opened).toBe(90);
    expect(callable).toHaveBeenCalledWith("getAppFeedback");
    expect(call).toHaveBeenLastCalledWith({});
    const cursor = { at: 1791046800123, id: "last-record" };
    await loadAppFeedback(cursor);
    expect(call).toHaveBeenLastCalledWith({ cursor });
  });

  it("preserves an authorization/network error for the page's retry state", async () => {
    const error = { code: "functions/permission-denied" };
    call.mockRejectedValue(error);
    await expect(loadAppFeedback()).rejects.toBe(error);
  });

  it("rejects a partial metrics payload rather than presenting a page-based completion rate", async () => {
    call.mockResolvedValue({ data: { ...data, metrics: { submitted: 40 } } });
    await expect(loadAppFeedback()).rejects.toThrow();
  });
});
