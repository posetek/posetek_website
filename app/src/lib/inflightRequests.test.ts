import { describe, expect, it, vi } from "vitest";
import { inFlightRequests } from "./inflightRequests";
describe("concurrent context requests", () => {
  it("shares identical requests and makes a fresh read after settlement", async () => {
    const requests = inFlightRequests<number>(), read = vi.fn().mockResolvedValue(3);
    const a = requests.run("uid:org", read), b = requests.run("uid:org", read);
    expect(a).toBe(b); await Promise.all([a, b]); expect(read).toHaveBeenCalledTimes(1);
    await requests.run("uid:org", read); expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not share another identity/scope or retain a failed result", async () => {
    const requests = inFlightRequests<number>(), read = vi.fn().mockResolvedValue(3);
    await Promise.all([requests.run("u:org1", read), requests.run("u:org2", read), requests.run("v:org1", read)]);
    expect(read).toHaveBeenCalledTimes(3);
    const fail = vi.fn().mockRejectedValue(new Error("denied"));
    await expect(requests.run("u:org1", fail)).rejects.toThrow("denied");
    await expect(requests.run("u:org1", read)).resolves.toBe(3);
  });
  it("discards late responses after identity change or explicit mutation invalidation", async () => {
    const requests = inFlightRequests<number>(); let finish!: (value: number) => void;
    const pending = requests.run("u:org", () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); requests.clear(); finish(3);
    await expect(pending).rejects.toMatchObject({ code: "permission-denied" });
    await expect(requests.run("v:org", () => Promise.resolve(4))).resolves.toBe(4);
  });
});
