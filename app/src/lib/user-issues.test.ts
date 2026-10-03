import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
const f = vi.hoisted(() => ({ auth: { currentUser: { uid: "athlete-a" } as { uid: string } | null }, send: vi.fn() }));
vi.mock("./firebase", () => ({ auth: f.auth, cloud: { httpsCallable: () => f.send } }));
import { configureIssueIdentity, issueInput, queueIssue, reportQueue, drainIssues, captureIssue, expectedIssueError, redactIssueText, instrumentIssueCallable } from "./user-issues";
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { onLine: false, userAgent: "test-browser" });
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { pathname: "/athlete" });
  vi.stubEnv("DEV", false);
  f.auth.currentUser = { uid: "athlete-a" }; configureIssueIdentity(() => f.auth.currentUser?.uid || null);
  f.send.mockReset().mockResolvedValue({ data: { status: "received", reference: "server-reference" } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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
async function storedInputs() {
  const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("posetek-user-issues", 1); r.onsuccess = () => resolve(r.result); });
  try { return await new Promise<any[]>(resolve => { const r = db.transaction("reports").objectStore("reports").getAll(); r.onsuccess = () => resolve(r.result); }); }
  finally { db.close(); }
}
it("generates one request reference per actual supported invocation, preserving caller data and queue correlation", async () => {
  const sent: any[] = [], input = { scope: "team" };
  const call = instrumentIssueCallable("getSocialFeed", async (data: any) => { sent.push(data); throw { code: "functions/deadline-exceeded", message: "Timed out" }; });
  await expect(call(input)).rejects.toMatchObject({ code: "functions/deadline-exceeded" });
  await expect(call(input)).rejects.toMatchObject({ code: "functions/deadline-exceeded" });
  expect(input).toEqual({ scope: "team" }); expect(sent[0].requestId).toBeTruthy(); expect(sent[1].requestId).not.toBe(sent[0].requestId);
  await vi.waitFor(async () => { const rows = await storedInputs(); expect(rows).toHaveLength(2); expect(rows.map(row => row.input.requestId).sort()).toEqual(sent.map(row => row.requestId).sort()); });
});
it("replaces a supplied diagnostic request ID while preserving business job data and the original account", async () => {
  const input = { requestId: "reused-request", jobId: "existing-job", playerId: "target-athlete", reporterUid: "forged-account" };
  const transport = vi.fn(async (_data: any) => { f.auth.currentUser = { uid: "athlete-b" }; throw { code: "functions/permission-denied" }; });
  const call = instrumentIssueCallable("getSocialFeed", transport);
  await expect(call(input)).rejects.toMatchObject({ code: "functions/permission-denied" });
  const sent = transport.mock.calls[0][0];
  expect(sent.requestId).not.toBe(input.requestId); expect(sent.requestId).not.toBe(input.jobId);
  expect(sent.jobId).toBe(input.jobId); expect(input.requestId).toBe("reused-request");
  expect(sent).not.toBe(input);
  await vi.waitFor(async () => { const rows = await storedInputs(); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ owner: "athlete-a", input: { requestId: sent.requestId, playerId: "target-athlete" } }); expect(rows[0].input).not.toHaveProperty("reporterUid"); });
});
it("retains blocking validation attempts for supported operations and excludes cancellation", async () => {
  const validation = instrumentIssueCallable("getSocialContext", async (_data: any) => { throw { code: "functions/failed-precondition", message: "Account link needs repair" }; });
  await expect(validation({})).rejects.toMatchObject({ code: "functions/failed-precondition" });
  const cancelled = instrumentIssueCallable("getSocialContext", async (_data: any) => { throw { code: "functions/cancelled" }; });
  await expect(cancelled({})).rejects.toMatchObject({ code: "functions/cancelled" });
  expect(captureIssue({ code: "functions/cancelled" }, "window.unhandledrejection", { force: true })).toBeUndefined();
  await vi.waitFor(async () => { expect(await storedInputs()).toHaveLength(1); });
});
it("does not mutate unrelated callable or positional auth contracts and keeps reporting transport unwrapped", async () => {
  const transport = vi.fn().mockResolvedValue("ok"), input = { other: true, requestId: "business-request", jobId: "business-job" };
  await instrumentIssueCallable("unrelatedCallable", transport)(input); expect(transport.mock.calls[0][0]).toBe(input);
  await instrumentIssueCallable("auth_signInWithEmailAndPassword", transport)("a@example.com", "password");
  expect(transport.mock.calls[1]).toEqual(["a@example.com", "password"]);
  expect(instrumentIssueCallable("submitUserIssue", transport)).toBe(transport);
});
it("keeps a requested preview athlete separate from the reporting account for server authorization", async () => {
  const transport = vi.fn(async (_data: any) => { throw { code: "functions/unavailable" }; });
  const call = instrumentIssueCallable("getSocialFeed", transport);
  await expect(call({ viewAsPlayerId: "another-athlete", requestId: "preview-request" })).rejects.toMatchObject({ code: "functions/unavailable" });
  const requestId = transport.mock.calls[0][0].requestId;
  expect(requestId).not.toBe("preview-request");
  await vi.waitFor(async () => { expect(await storedInputs()).toMatchObject([{ owner: "athlete-a", input: { playerId: "another-athlete", requestId } }]); });
});
it("assigns fresh diagnostic IDs to every supported endpoint even with the same supplied request and job IDs", async () => {
  const names = ["getSocialAdminDirectory", "getSocialContext", "getSocialFeed", "getSocialActivity", "saveSocialPreferences",
    "setSocialVisibility", "getSocialPeople", "socialConnection", "setSocialKudos", "getSocialComments", "saveSocialComment",
    "reportSocialActivity", "moderateSocialActivity", "getSocialMedia"];
  const input = Object.freeze({ requestId: "caller-reused-id", jobId: "business-job", playerId: "target-one" });
  const requests: string[] = [];
  for (const name of names) {
    const call = instrumentIssueCallable(name, async (sent: any) => {
      requests.push(sent.requestId); expect(sent.jobId).toBe(input.jobId); expect(sent).not.toBe(input); return { ok: true };
    });
    await expect(call(input)).resolves.toEqual({ ok: true });
  }
  expect(new Set(requests).size).toBe(14); expect(requests).not.toContain(input.requestId); expect(requests).not.toContain(input.jobId);
  expect(input).toEqual({ requestId: "caller-reused-id", jobId: "business-job", playerId: "target-one" });
  // Successful calls do not create a diagnostics database or queue an error.
  expect(await indexedDB.databases()).toEqual([]);
});
it("retains one diagnostic ID through internal transport retries of a single invocation", async () => {
  const transmitted: any[] = [], input = { requestId: "old-attempt", jobId: "business-job" };
  const call = instrumentIssueCallable("getSocialFeed", async (sent: any) => {
    // Firebase's internal retries reuse the argument passed to its callable.
    for (let attempt = 0; attempt < 3; attempt++) transmitted.push(sent);
    throw { code: "functions/unavailable" };
  });
  await expect(call(input)).rejects.toMatchObject({ code: "functions/unavailable" });
  expect(transmitted).toHaveLength(3); expect(transmitted.every(row => row === transmitted[0])).toBe(true);
  expect(new Set(transmitted.map(row => row.requestId)).size).toBe(1);
  await vi.waitFor(async () => { const rows = await storedInputs(); expect(rows).toHaveLength(1); expect(rows[0].input.requestId).toBe(transmitted[0].requestId); });
});
it("records a reused Error object for distinct invocations and suppresses its global duplicate", async () => {
  const error = Object.assign(new Error("Repeated transport failure"), { code: "functions/unavailable" });
  const sent: any[] = [];
  const call = instrumentIssueCallable("getSocialFeed", async (data: any) => { sent.push(data); throw error; });
  await expect(call({ requestId: "caller-reuse", viewAsPlayerId: "target-one" })).rejects.toBe(error);
  expect(captureIssue(error, "window.unhandledrejection", { force: true })).toBeUndefined();
  await expect(call({ requestId: "caller-reuse", viewAsPlayerId: "target-two" })).rejects.toBe(error);
  expect(captureIssue(error, "window.unhandledrejection", { force: true })).toBeUndefined();
  expect(sent[0].requestId).not.toBe(sent[1].requestId);
  expect(captureIssue(error, "getSocialFeed", { force: true, requestId: sent[1].requestId })).toBeUndefined();
  await vi.waitFor(async () => { const rows = await storedInputs(); expect(rows).toHaveLength(2); expect(rows.map(row => row.input.playerId).sort()).toEqual(["target-one", "target-two"]); expect(rows.map(row => row.input.requestId).sort()).toEqual(sent.map(row => row.requestId).sort()); });
});
it("bounds each reused Error object's request history while retaining global duplicate suppression", async () => {
  const error = new Error("Reused error");
  for (let i = 0; i < 33; i++) expect(captureIssue(error, "getSocialFeed", { force: true, requestId: `bounded-${i}` })).toBeTruthy();
  expect(captureIssue(error, "getSocialFeed", { force: true, requestId: "bounded-32" })).toBeUndefined();
  expect(captureIssue(error, "window.unhandledrejection", { force: true })).toBeUndefined();
  // The oldest request can fall out of local history. Durable backend IDs still
  // deduplicate a genuine replay, while this object cannot grow an unbounded map.
  expect(captureIssue(error, "getSocialFeed", { force: true, requestId: "bounded-0" })).toBeTruthy();
  await vi.waitFor(async () => { expect(await storedInputs()).toHaveLength(34); });
});
it("keeps the captured account, event, request and occurrence time unchanged after a lost intake acknowledgement", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const call = instrumentIssueCallable("getSocialFeed", async (_data: any) => { throw { code: "functions/unavailable" }; });
  await expect(call({ requestId: "caller-id" })).rejects.toMatchObject({ code: "functions/unavailable" });
  await vi.waitFor(async () => { expect(await storedInputs()).toHaveLength(1); });
  const original = (await storedInputs())[0];
  f.send.mockRejectedValueOnce(new Error("Lost acknowledgement"));
  vi.stubGlobal("navigator", { onLine: true }); await drainIssues();
  now.mockReturnValue(1_800_000_100_000); f.auth.currentUser = { uid: "athlete-b" };
  await drainIssues(); expect(f.send).toHaveBeenCalledTimes(1);
  f.auth.currentUser = { uid: "athlete-a" }; await drainIssues();
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.send.mock.calls[0][0]).toEqual(f.send.mock.calls[1][0]);
  expect(f.send.mock.calls[1][0]).toMatchObject({ ownerUid: original.owner, eventId: original.input.eventId,
    requestId: original.input.requestId, occurredAtMillis: original.input.occurredAtMillis });
  expect((await storedInputs())[0].status).toBe("received");
});
