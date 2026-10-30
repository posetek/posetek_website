import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ initial: [] as unknown[], index: 0 }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => {
    const index = state.index++;
    return react.useState(index < state.initial.length ? state.initial[index] : initial);
  } };
});
vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(),
  useNavigate: () => vi.fn(), Link: ({ children, to, ...props }: any) => <a {...props} href={to}>{children}</a>,
}));
import AthletePortalPage from './AthletePortalPage';
import { previewData } from './lib/preview';
import type { Access } from './lib/loaders';

function render(access: Access, view: string, detail = false) {
  const sample = previewData(true);
  const review = sample.reviewedResults!.find(r => r.drill === 'jump' && r.status === 'estimate')!;
  state.index = 0;
  // Seed the real shell's loaded state; effects never run during static rendering.
  state.initial = [new URLSearchParams(), 'ready', null, access, sample.playerId,
    sample.athlete, sample.reps, [], sample.reviewedResults, view, 0, 'jump',
    detail ? { folder: `session${review.sessionNumber}`, repId: review.repId } : null];
  return renderToStaticMarkup(<AthletePortalPage />);
}
describe('authorized staff reviewed-result portal wiring', () => {
  it.each(['admin', 'coach', 'manager'] as const)('shows the current projection on %s home, drill list and detail', access => {
    for (const [view, detail] of [['home', false], ['drills', false], ['drills', true]] as const) {
      const html = render(access, view, detail);
      expect(html).toContain('ESTIMATE');
      expect(html).toContain('~24 cm');
      expect(html).not.toContain('Loading rep analysis');
      expect(html).not.toContain('Save estimate');
      if (!detail) expect(html).toContain('RETEST NEEDED');
    }
  });
  it('does not expose the review projection in shared bearer views, even if stale state contains it', () => {
    for (const view of ['home', 'drills']) {
      const html = render('shared', view);
      expect(html).not.toContain('Estimates and retests');
      expect(html).not.toContain('~24 cm');
      expect(html).not.toContain('RETEST NEEDED');
    }
  });
});
