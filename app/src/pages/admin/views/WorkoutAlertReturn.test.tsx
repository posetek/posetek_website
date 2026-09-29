import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/firebase', () => ({ auth: {}, cloud: {}, db: {} }));
vi.mock('../lib/session', () => ({ useAdminSession: () => ({ kind: 'signedOut' }) }));
vi.mock('../../../lib/organization-data', () => ({ getClubContext: vi.fn() }));
import AdminPage from '../AdminPage';
import { accountDestination } from '../../landing/account-entry';
import { getSafeReturnToUrl } from '../../landing/landing-helpers';

const target = '/admin/accounts/player/athlete?workoutSource=personalWorkoutLogs&workoutLog=exact-log';
describe('workout email sign-in return', () => {
  it('preserves the player, collection and log through the signed-out admin gate', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[target]}><AdminPage /></MemoryRouter>);
    expect(html).toContain(`href="/signin?returnTo=${encodeURIComponent(target)}"`);
    expect(accountDestination('admin', null, '?returnTo=' + encodeURIComponent(target), 'https://posetek.net/signin', 'https://posetek.net'))
      .toBe('https://posetek.net' + target);
  });
  it.each(['/admin/accounts/player/', '/admin/accounts/player/a/b', '/admin/accounts/player/a%2Fb', '/admin/accounts/player/a%5Cb', '/admin/accounts/player/%00',
    '/admin/unknown', '//elsewhere.example/admin/accounts/player/a', 'https://bad:secret@posetek.net/admin/accounts/player/a'])('does not broaden sign-in returns to unsafe routes: %s', path => {
    expect(getSafeReturnToUrl('?returnTo=' + encodeURIComponent(path), 'https://posetek.net/signin', 'https://posetek.net')).toBeNull();
  });
});
