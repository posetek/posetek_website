// Test-only configuration; firebase.ts selects it only in the explicit dev mode.
export type EmulatorService = 'auth' | 'firestore' | 'functions' | 'storage';

const projectId = 'demo-posetek-website-e2e';
const host = '127.0.0.1';
const basePorts: Record<EmulatorService, number> = {
  auth: 19099,
  firestore: 18089,
  functions: 15001,
  storage: 19299,
};

export function websiteEmulatorConfig(input: { mode: string; dev: boolean; portOffset: string }) {
  if (input.mode !== 'posetek-emulator-e2e' || input.dev !== true) {
    throw new Error('Firebase emulator configuration requires the dedicated development test mode');
  }
  if (!/^(0|[1-9][0-9]*)$/.test(input.portOffset)) {
    throw new Error('Firebase emulator port offset must be a non-negative integer');
  }
  const offset = Number(input.portOffset);
  if (!Number.isSafeInteger(offset) || offset > 46236) {
    throw new Error('Firebase emulator port offset exceeds the TCP port range');
  }
  const services = Object.fromEntries(
    (Object.keys(basePorts) as EmulatorService[]).map(service => [service, { host, port: basePorts[service] + offset }]),
  ) as Record<EmulatorService, { host: string; port: number }>;
  return {
    firebase: {
      apiKey: 'demo-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: `${projectId}.appspot.com`,
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:posetekemulatortest',
    },
    services,
  };
}
