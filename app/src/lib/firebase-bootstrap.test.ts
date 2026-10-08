import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const auth = { useEmulator: vi.fn(), currentUser: null };
  const firestore = { useEmulator: vi.fn() };
  const storage = { useEmulator: vi.fn() };
  const functions = { useEmulator: vi.fn() };
  const firebase = {
    apps: [] as unknown[], initializeApp: vi.fn((config: unknown) => { firebase.apps.push(config); }),
    auth: vi.fn(() => auth), firestore: vi.fn(() => firestore), storage: vi.fn(() => storage),
    app: vi.fn(() => ({ functions: vi.fn(() => functions) })),
  };
  return { firebase, auth, firestore, storage, functions, configureIssueIdentity: vi.fn() };
});

vi.mock('firebase/compat/app', () => ({ default: mock.firebase }));
vi.mock('firebase/compat/auth', () => ({}));
vi.mock('firebase/compat/firestore', () => ({}));
vi.mock('firebase/compat/storage', () => ({}));
vi.mock('firebase/compat/functions', () => ({}));
vi.mock('./user-issues', () => ({ configureIssueIdentity: mock.configureIssueIdentity,
  instrumentIssueCallable: (_name: string, callable: unknown) => callable }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mock.firebase.apps.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('Firebase client bootstrap', () => {
  it('keeps the existing production configuration and never opens an emulator in ordinary mode', async () => {
    vi.stubEnv('MODE', 'production'); vi.stubEnv('DEV', false);
    await import('./firebase');
    expect(mock.firebase.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'kickai-69dd0' }));
    for (const client of [mock.auth, mock.firestore, mock.storage, mock.functions]) expect(client.useEmulator).not.toHaveBeenCalled();
  });

  it('connects all four clients to exact loopback endpoints before exposing them', async () => {
    vi.stubEnv('MODE', 'posetek-emulator-e2e'); vi.stubEnv('DEV', true);
    vi.stubEnv('PUBLIC_FIREBASE_EMULATOR_PORT_OFFSET', '100');
    await import('./firebase');
    expect(mock.firebase.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'demo-posetek-website-e2e', apiKey: 'demo-api-key' }));
    expect(mock.auth.useEmulator).toHaveBeenCalledWith('http://127.0.0.1:19199');
    expect(mock.firestore.useEmulator).toHaveBeenCalledWith('127.0.0.1', 18189);
    expect(mock.storage.useEmulator).toHaveBeenCalledWith('127.0.0.1', 19399);
    expect(mock.functions.useEmulator).toHaveBeenCalledWith('127.0.0.1', 15101);
    expect(mock.configureIssueIdentity).toHaveBeenCalledOnce();
  });

  it('fails before Firebase initialization for production, partial, or reused test setup', async () => {
    vi.stubEnv('MODE', 'posetek-emulator-e2e'); vi.stubEnv('DEV', false);
    vi.stubEnv('PUBLIC_FIREBASE_EMULATOR_PORT_OFFSET', '0');
    await expect(import('./firebase')).rejects.toThrow(/development test mode/);
    expect(mock.firebase.initializeApp).not.toHaveBeenCalled();
    vi.resetModules(); vi.stubEnv('DEV', true); vi.stubEnv('PUBLIC_FIREBASE_EMULATOR_PORT_OFFSET', 'bad');
    await expect(import('./firebase')).rejects.toThrow(/offset/);
    expect(mock.firebase.initializeApp).not.toHaveBeenCalled();
    vi.resetModules(); vi.stubEnv('PUBLIC_FIREBASE_EMULATOR_PORT_OFFSET', '0'); mock.firebase.apps.push({});
    await expect(import('./firebase')).rejects.toThrow(/fresh demo Firebase app/);
    expect(mock.firebase.initializeApp).not.toHaveBeenCalled();
  });
});
