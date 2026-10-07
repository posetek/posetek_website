import { describe, expect, it } from 'vitest';
import { websiteEmulatorConfig } from './firebase-emulator-config';

const input = { mode: 'posetek-emulator-e2e', dev: true, portOffset: '0' };

describe('test-only Firebase emulator configuration', () => {
  it('uses a demo project and distinct loopback endpoints for every browser Firebase client', () => {
    const result = websiteEmulatorConfig(input);
    expect(result.firebase.projectId).toBe('demo-posetek-website-e2e');
    expect(result.firebase.apiKey).toBe('demo-api-key');
    expect(result.firebase.authDomain).toBe('demo-posetek-website-e2e.firebaseapp.com');
    expect(result.firebase.storageBucket).toBe('demo-posetek-website-e2e.appspot.com');
    expect(Object.keys(result.services).sort()).toEqual(['auth', 'firestore', 'functions', 'storage']);
    expect(Object.values(result.services).every(service => service.host === '127.0.0.1')).toBe(true);
    expect(new Set(Object.values(result.services).map(service => service.port)).size).toBe(4);
    expect(Object.values(result.services).every(service => service.port > 0 && service.port <= 65535)).toBe(true);
    expect(websiteEmulatorConfig({ ...input, portOffset: '100' }).services.auth.port).toBe(result.services.auth.port + 100);
  });

  it('cannot select emulators in a production build or ordinary development mode', () => {
    for (const change of [{ dev: false }, { mode: 'production' }, { mode: 'development' }, { mode: '' }]) {
      expect(() => websiteEmulatorConfig({ ...input, ...change })).toThrow(/dedicated development test mode/);
    }
  });

  it('rejects ambiguous and out-of-range port offsets before returning any endpoint', () => {
    for (const portOffset of ['', '-1', '01', '1.5', '100foo', '46237', '999999999999999999999999']) {
      expect(() => websiteEmulatorConfig({ ...input, portOffset })).toThrow(/offset/);
    }
    const highest = websiteEmulatorConfig({ ...input, portOffset: '46236' });
    expect(highest.services.storage.port).toBe(65535);
  });
});
