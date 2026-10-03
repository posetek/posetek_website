// Best-effort diagnostics are independent of the operation being reported.
// Pending entries keep their original auth identity across reloads/account switches.
export type IssueInput = { eventId: string; sessionId: string; kind: "error" | "report"; platform: "web";
  operation: string; code: string; occurredAtMillis: number; build: string; device: string; route: string;
  message?: string; description?: string; screenshot?: string; playerId?: string; requestId?: string };
type Queued = { id: string; owner: string | null; input: IssueInput; status: "queued" | "received" | "disabled" | "rejected"; reference?: string };
const STORE = "reports";
let session = "", draining = false;
let currentOwner: () => string | null = () => null;
export function configureIssueIdentity(getOwner: () => string | null) { currentOwner = getOwner; }
const listeners = new Set<() => void>();
export const onIssueQueueChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function changed() { listeners.forEach(fn => fn()); }
export function redactIssueText(value: string) {
  return value.replace(/(?:Bearer\s+\S+|\b(?:re_|whsec_)[A-Za-z0-9_+/=-]{12,})/gi, "[credential]")
    .replace(/([?&](?:token|key|code|password|secret|signature|access_token)=)[^\s&]*/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]").slice(0, 4000);
}
export function expectedIssueError(error: unknown) {
  const code = String((error as { code?: string })?.code || "").replace(/^(functions|auth)\//, "");
  return ["invalid-argument", "failed-precondition", "cancelled", "invalid-credential", "wrong-password", "user-not-found", "email-already-in-use", "weak-password", "invalid-email", "popup-closed-by-user"].includes(code);
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("posetek-user-issues", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function records(): Promise<Queued[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const r = db.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}
async function write(row: Queued) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(row); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
  changed();
}
export async function reportQueue() {
  const owner = currentOwner();
  const rows = await records();
  return owner === currentOwner() ? rows.filter(row => row.owner === owner && row.input.kind === "report") : [];
}
export async function drainIssues() {
  if (draining || !navigator.onLine) return;
  draining = true;
  try {
    const { auth, cloud } = await import("./firebase");
    for (const row of await records()) {
      if (row.status !== "queued" || row.owner !== (auth.currentUser?.uid || null)) continue;
      try {
        const response = (await cloud.httpsCallable("submitUserIssue")({ ...row.input, ownerUid: row.owner })).data as { status: "received" | "disabled"; reference?: string };
        if (!["received", "disabled"].includes(response.status)) break;
        await write({ ...row, status: response.status, reference: response.reference, input: { ...row.input, screenshot: undefined, description: undefined, message: undefined } });
      } catch (error) {
        if (String((error as { code?: string })?.code) === "functions/invalid-argument") { await write({ ...row, status: "rejected" }); continue; }
        break;
      }
    }
  } catch { /* Storage or transport failure must never recurse into reporting. */ }
  finally { draining = false; }
}
export function issueInput(operation: string, code: string): IssueInput {
  if (!session) session = crypto.randomUUID();
  return { eventId: crypto.randomUUID(), sessionId: session, kind: "error", platform: "web", operation, code,
    occurredAtMillis: Date.now(), build: import.meta.env.PUBLIC_RELEASE_SHA || import.meta.env.VITE_RELEASE_SHA || "unknown", device: navigator.userAgent.slice(0, 180), route: location.pathname };
}
export async function queueIssue(input: IssueInput, owner: string | null = currentOwner()) {
  const all = await records();
  if (all.filter(row => row.status === "queued").length >= 50) throw new Error("The report queue is full. Please retry when connected, or email support.");
  // Prune only old acknowledgements, never pending reports.
  if (all.length > 100) {
    const db = await database(); const tx = db.transaction(STORE, "readwrite");
    all.filter(row => row.status !== "queued").slice(0, all.length - 100).forEach(row => tx.objectStore(STORE).delete(row.id));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }
  await write({ id: input.eventId, owner, input, status: "queued" });
  void drainIssues(); return input.eventId;
}
const recent = new Map<string, number>();
// A wrapper and the global rejection handler can observe the same object. Keep
// those copies together without hiding a later, distinct callable attempt.
// Weak keys do not retain errors; each surviving object's request history is bounded.
const capturedErrors = new WeakMap<object, Set<string>>();
const ERROR_REQUEST_HISTORY_LIMIT = 32;
// These endpoints explicitly accept an opaque request reference. Do not inject
// extra fields into unrelated callables or positional authentication arguments.
const CORRELATED_CALLABLES = new Set(["getSocialAdminDirectory", "getSocialContext", "getSocialFeed", "getSocialActivity",
  "saveSocialPreferences", "setSocialVisibility", "getSocialPeople", "socialConnection", "setSocialKudos",
  "getSocialComments", "saveSocialComment", "reportSocialActivity", "moderateSocialActivity", "getSocialMedia"]);
const REQUEST_ID = /^[A-Za-z0-9_-]{1,160}$/;
export function captureIssue(error: unknown, operation: string, context: { playerId?: string; requestId?: string; force?: boolean; ownerUid?: string | null } = {}) {
  if (typeof window === "undefined" || import.meta.env.DEV || !context.force && expectedIssueError(error)) return;
  try {
    const value = error as { code?: string; name?: string; message?: string };
    if (String(value?.code || "").replace(/^(functions|auth)\//, "") === "cancelled") return;
    const code = String(value?.code || value?.name || "unexpected_error").slice(0, 100);
    const owner = context.ownerUid === undefined ? currentOwner() : context.ownerUid;
    const key = `${owner}:${operation}:${code}:${context.requestId || ""}`;
    if (error && typeof error === "object") {
      const history = capturedErrors.get(error);
      const requestKey = context.requestId ? JSON.stringify([owner, operation, context.requestId]) : null;
      // An unscoped global observer must not duplicate a known wrapper capture.
      // A new scoped attempt remains distinct even if its transport reuses Error.
      if (history && (!requestKey || history.has(requestKey))) return;
      const requests = history || new Set<string>();
      if (requestKey) {
        requests.add(requestKey);
        if (requests.size > ERROR_REQUEST_HISTORY_LIMIT) requests.delete(requests.values().next().value!);
      }
      capturedErrors.set(error, requests);
    } else {
      if (Date.now() - (recent.get(key) || 0) < 30000) return;
      recent.set(key, Date.now()); if (recent.size > 100) recent.delete(recent.keys().next().value!);
    }
    const input = issueInput(operation, code);
    void queueIssue({ ...input, message: redactIssueText(String(value?.message || "Unexpected application failure")), playerId: context.playerId, requestId: context.requestId }, owner).catch(() => {});
    return input.eventId;
  } catch { /* Reporting is never load-bearing. */ }
}
export function instrumentIssueCallable<T extends (...args: any[]) => Promise<any>>(name: string, call: T): T {
  if (/UserIssue|UserIssues|WorkoutActivity|WorkoutNotificationStatus/.test(name)) return call;
  return (async (...args: Parameters<T>) => {
    const ownerUid = currentOwner();
    const correlated = CORRELATED_CALLABLES.has(name);
    const input = args[0];
    const supplied = input?.requestId || input?.jobId;
    const requestId = correlated ? crypto.randomUUID()
      : typeof supplied === "string" && REQUEST_ID.test(supplied) ? supplied : undefined;
    if (correlated && (input === undefined || input === null || typeof input === "object" && !Array.isArray(input))) {
      // These callables have no caller-supplied request-ID retry contract. Every
      // explicit invocation is a new attempt, even when the UI reuses its input.
      // Firebase's transport retries still receive this same copied argument.
      args[0] = { ...(input || {}), requestId };
    }
    try { return await call(...args); }
    catch (error) {
      const cancelled = String((error as { code?: string })?.code || "").replace(/^functions\//, "") === "cancelled";
      if (!cancelled) captureIssue(error, name, { ownerUid, requestId,
        // The intake server separately verifies access to this requested target;
        // it is never used as the authenticated actor.
        playerId: input?.playerId || input?.playerDocumentID || (correlated ? input?.viewAsPlayerId : undefined), force: correlated });
      throw error;
    }
  }) as T;
}
