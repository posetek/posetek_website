import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ currentUser: null as { uid: string } | null, listeners: [] as ((user: { uid: string } | null) => void)[], call: vi.fn() }));
vi.mock("./firebase", () => ({ auth: {
  get currentUser() { return fixture.currentUser; },
  onAuthStateChanged(listener: (user: { uid: string } | null) => void) { fixture.listeners.push(listener); queueMicrotask(() => listener(fixture.currentUser)); return () => {}; },
}, cloud: { httpsCallable: () => fixture.call }, db: {} }));
describe("identity-bound club context", () => {
  beforeEach(() => { vi.resetModules(); fixture.currentUser = null; fixture.listeners = []; fixture.call.mockReset(); });
  it("accepts the first signed-in read after Auth restores and shares concurrent transport", async () => {
    const { getClubContext } = await import("./organization-data");
    fixture.currentUser = { uid: "admin-a" };
    fixture.call.mockResolvedValue({ data: { role: "admin", organization: { id: "club" } } });
    const results = await Promise.all([getClubContext("club"), getClubContext("club")]);
    expect(results[0]).toEqual(results[1]); expect(results[0].role).toBe("admin"); expect(fixture.call).toHaveBeenCalledTimes(1);
  });
  it("discards old account responses and starts the new account's request", async () => {
    const { getClubContext } = await import("./organization-data");
    fixture.currentUser = { uid: "a" }; let resolve!: (value: unknown) => void;
    fixture.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const old = getClubContext("club"); await Promise.resolve(); await Promise.resolve();
    fixture.currentUser = { uid: "b" }; fixture.listeners.forEach(listener => listener(fixture.currentUser));
    resolve({ data: { role: "admin" } }); await expect(old).rejects.toMatchObject({ code: "permission-denied" });
    fixture.call.mockResolvedValue({ data: { role: "admin" } }); await expect(getClubContext("club")).resolves.toMatchObject({ role: "admin" });
    expect(fixture.call).toHaveBeenCalledTimes(2);
  });
});
