import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
const f = vi.hoisted(() => ({ auth: { currentUser: { uid: "athlete-a" } as { uid: string } | null }, send: vi.fn() }));
vi.mock("./firebase", () => ({ auth: f.auth, cloud: { httpsCallable: () => f.send } }));
import { configureIssueIdentity, issueInput, queueIssue, reportQueue, drainIssues, captureIssue, expectedIssueError, redactIssueText } from "./user-issues";
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: false, userAgent: "test-browser" });
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { pathname: "/athlete" });
  vi.stubEnv("DEV", false);
  f.auth.currentUser = { uid: "athlete-a" }; configureIssueIdentity(() => f.auth.currentUser?.uid || null);
  f.send.mockReset().mockResolvedValue({ data: { status: "received", reference: "server-reference" } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("keeps an offline report with its original account through a switch and retry", async () => {
  await queueIssue({ ...issueInput("user_report", "reported"), kind: "report", description: "Workout would not save" });
  expect((await reportQueue())[0].status).toBe("queued");
  f.auth.currentUser = { uid: "athlete-b" };
  vi.stubGlobal("navigator", { onLine: true, userAgent: "test" });
  await drainIssues(); expect(f.send).not.toHaveBeenCalled(); expect(await reportQueue()).toEqual([]);
  f.auth.currentUser = { uid: "athlete-a" }; await drainIssues();
  expect(f.send.mock.calls[0][0].ownerUid).toBe("athlete-a");
  expect((await reportQueue())[0]).toMatchObject({ status: "received", reference: "server-reference" });
  expect((await reportQueue())[0].input.description).toBeUndefined();
  await drainIssues(); expect(f.send).toHaveBeenCalledTimes(1);
});
it("captures ownership synchronously before IndexedDB completes", async () => {
  const pending = queueIssue({ ...issueInput("user_report", "reported"), kind: "report", description: "Original account's report" });
  f.auth.currentUser = { uid: "athlete-b" }; await pending;
  expect(await reportQueue()).toEqual([]);
  f.auth.currentUser = { uid: "athlete-a" }; expect((await reportQueue()).length).toBe(1);
});
it("a malformed queued report cannot block another valid report", async () => {
  await queueIssue({ ...issueInput("user_report", "reported"), eventId: "a", kind: "report", description: "bad" });
  await queueIssue({ ...issueInput("user_report", "reported"), eventId: "b", kind: "report", description: "Valid report description" });
  f.send.mockRejectedValueOnce({ code: "functions/invalid-argument" });
  vi.stubGlobal("navigator", { onLine: true }); await drainIssues();
  expect((await reportQueue()).map(row => row.status)).toEqual(["rejected", "received"]);
});
it("ignores expected login errors, redacts credentials, and only suppresses the same error object", async () => {
  expect(expectedIssueError({ code: "auth/wrong-password" })).toBe(true);
  expect(redactIssueText("Bearer private-value and a@example.com")).not.toContain("private-value");
  const error = new Error("test error");
  expect(captureIssue(error, "test")).toBeTruthy();
  expect(captureIssue(error, "test")).toBeUndefined();
  expect(captureIssue(new Error("test error"), "test")).toBeTruthy();
  // Let the asynchronous writes finish before replacing the test database.
  await vi.waitFor(async () => { const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("posetek-user-issues", 1); r.onsuccess = () => resolve(r.result); }); const count = await new Promise<number>(resolve => { const r = db.transaction("reports").objectStore("reports").count(); r.onsuccess = () => resolve(r.result); }); db.close(); expect(count).toBe(2); });
});
