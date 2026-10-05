import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => {
  const user = { uid: "account-a", displayName: "Player A", email: null, isAnonymous: false };
  const auth = { currentUser: user as typeof user | null, authStateReady: vi.fn(async () => {}) };
  return { auth, initializeAuth: vi.fn((_app: unknown, _options: unknown) => auth), getIdToken: vi.fn(async () => "bound-token"),
    onAuthStateChanged: vi.fn(() => () => {}), initializeApp: vi.fn(() => ({})), getApps: vi.fn(() => []) };
});
vi.mock("firebase/app", () => ({ getApps: mock.getApps, getApp: vi.fn(() => ({})), initializeApp: mock.initializeApp }));
vi.mock("firebase/auth", () => ({ initializeAuth: mock.initializeAuth, getAuth: () => mock.auth,
  indexedDBLocalPersistence: "indexedDB", browserLocalPersistence: "local", browserSessionPersistence: "session",
  getIdToken: mock.getIdToken, onAuthStateChanged: mock.onAuthStateChanged }));
import { createFeedbackAuthAdapter } from "./feedback-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.currentUser = { uid: "account-a", displayName: "Player A", email: null, isAnonymous: false };
  mock.auth.authStateReady.mockResolvedValue(undefined);
  mock.initializeAuth.mockImplementation(() => mock.auth);
  mock.getIdToken.mockResolvedValue("bound-token");
});

describe("isolated feedback Auth adapter", () => {
  it("matches browser persistence and omits popup/redirect resolver dependencies", async () => {
    const adapter = createFeedbackAuthAdapter();
    expect(mock.initializeAuth.mock.calls[0][1]).toEqual({ persistence: ["indexedDB", "local", "session"] });
    await expect(adapter.ready()).resolves.toEqual({ uid: "account-a", label: "Player A" });
    expect(adapter.isCurrent("account-a")).toBe(true);
    expect(adapter.isCurrent(null)).toBe(false);
  });

  it("allows an actual signed-out state without inventing an identity", async () => {
    mock.auth.currentUser = null;
    const adapter = createFeedbackAuthAdapter();
    await expect(adapter.ready()).resolves.toBeNull();
    expect(adapter.isCurrent(null)).toBe(true);
    await expect(adapter.tokenFor("account-a")).rejects.toThrow("account changed");
    expect(mock.getIdToken).not.toHaveBeenCalled();
  });

  it("propagates initialization failure instead of silently becoming anonymous", async () => {
    mock.auth.authStateReady.mockRejectedValue(new Error("Persistence unavailable"));
    await expect(createFeedbackAuthAdapter().ready()).rejects.toThrow("Persistence unavailable");
  });

  it("refreshes only the captured account and rechecks after asynchronous token retrieval", async () => {
    const adapter = createFeedbackAuthAdapter();
    await expect(adapter.tokenFor("account-a")).resolves.toBe("bound-token");
    expect(mock.getIdToken.mock.calls[0]).toEqual([mock.auth.currentUser, true]);
    await expect(adapter.tokenFor("account-b")).rejects.toThrow("account changed");
    mock.getIdToken.mockImplementation(async () => { mock.auth.currentUser = { uid: "account-b", displayName: "Player B", email: null, isAnonymous: false }; return "previous-token"; });
    await expect(adapter.tokenFor("account-a")).rejects.toThrow("account changed");
  });

  it("treats an anonymous Firebase user as signed out for both display and token policy", async () => {
    mock.auth.currentUser = { uid: "anonymous-auth-uid", displayName: "Anonymous", email: null, isAnonymous: true };
    const adapter = createFeedbackAuthAdapter();
    await expect(adapter.ready()).resolves.toBeNull();
    expect(adapter.isCurrent(null)).toBe(true);
    expect(adapter.isCurrent("anonymous-auth-uid")).toBe(false);
    await expect(adapter.tokenFor("anonymous-auth-uid")).rejects.toThrow("account changed");
    expect(mock.getIdToken).not.toHaveBeenCalled();
  });
});
