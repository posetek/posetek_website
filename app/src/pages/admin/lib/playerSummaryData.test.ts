import { describe, expect, it, vi } from "vitest";
const firestore = vi.hoisted(() => {
  const get = vi.fn(async () => ({ exists: true, data: () => ({ schemaVersion: 2 }) }));
  const doc = vi.fn(() => ({ get }));
  const collection = vi.fn(() => ({ doc }));
  return { get, doc, collection };
});
vi.mock("../../../lib/firebase", () => ({ db: { collection: firestore.collection } }));
import { loadPlayerSummaryOrganization } from "./playerSummaryData";
describe("bounded player summary organization validation", () => {
  it("uses one existing Firestore document get without listing an organization or roster", async () => {
    expect(await loadPlayerSummaryOrganization("current-org")).toEqual({ kind: "canonical", organizationId: "current-org" });
    expect(firestore.collection).toHaveBeenCalledExactlyOnceWith("organizations");
    expect(firestore.doc).toHaveBeenCalledExactlyOnceWith("current-org");
    expect(firestore.get).toHaveBeenCalledTimes(1);
  });
  it("reads exactly one requested organization document before enabling reporting", async () => {
    const read = vi.fn(async () => ({ exists: true, data: () => ({ schemaVersion: 2 }) }));
    expect(await loadPlayerSummaryOrganization("current-org", read)).toEqual({ kind: "canonical", organizationId: "current-org" });
    expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith("current-org");
  });
  it.each([1, undefined, "2"])("rejects an unsupported organization schema %s", async schemaVersion => {
    const read = vi.fn(async () => ({ exists: true, data: () => ({ schemaVersion }) }));
    expect(await loadPlayerSummaryOrganization("legacy-org", read)).toEqual({ kind: "legacy" });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("keeps deleted and absent organizations distinct without a fallback roster read", async () => {
    const read = vi.fn(async () => ({ exists: false, data: () => undefined }));
    expect(await loadPlayerSummaryOrganization("deleted", read)).toEqual({ kind: "unavailable" });
    expect(await loadPlayerSummaryOrganization(null, read)).toEqual({ kind: "unavailable" });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("propagates permission errors so retained data is cleared and retry remains explicit", async () => {
    const read = vi.fn(async () => { throw new Error("permission-denied"); });
    await expect(loadPlayerSummaryOrganization("current-org", read)).rejects.toThrow("permission-denied");
    expect(read).toHaveBeenCalledTimes(1);
  });
});
