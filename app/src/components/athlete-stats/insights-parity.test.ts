import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildProfile } from './profile';
import { metrics } from '../../lib/benchmarks';

const require = createRequire(import.meta.url);
const { measuredMetrics, measuredAxes } = require('../../../../functions/insights-axis-scoring.js');

describe('qualified athlete profile and coach comparison scoring', () => {
  it('uses identical axes, best observations, references and measured-only scores', () => {
    const reps = [
      { repType: 'sprint', max_velocity: 7, max_acceleration: 6.2, totalTime: 2 },
      { repType: 'sprint', max_velocity: 8, max_acceleration: 5.4, totalTime: 1.84 },
      { repType: 'shooting', velocity: 29 },
      { repType: 'jump', jumpHeight: 0.5 },
      { repType: 'broadJump', broadJumpDistance: 2.1 },
      { repType: 'changeOfDirection', totalTime: 5, phase1Time: 2, phase2Time: 1.2, phase3Time: 1.8 },
      { repType: 'dribbling', totalTime: 6.8, avgBallDistance: 0.6, phase1Time: 2.8, phase2Time: 2.5, phase3Time: 1.5 },
    ].map(rep => ({ ...rep, resultStatus: { qualified: true, duplicate: false } }));
    const server = measuredAxes(reps.map(rep => ({ drill: rep.repType, qualified: 1, profileMetrics: measuredMetrics(rep) })));
    const browser = buildProfile(reps).axes;
    expect(server).toEqual(browser.map(axis => ({ key: axis.key, label: axis.label, measuredScore: axis.score })));
    expect(metrics.ballSpeed.reference).toBe(75 * (1 / 2.23694));
    expect(metrics.verticalJumpHeight.reference).toBe(18 * (1 / 39.37007874015748));
    expect(metrics.dribbleBallControl.reference).toBe(2.1 * (1 / 3.28084));
  });

  it('preserves unmeasured axes instead of substituting zero', () => {
    const reps = [{ repType: 'sprint', max_velocity: 7, resultStatus: { qualified: true } }];
    const server = measuredAxes(reps.map(rep => ({ drill: rep.repType, qualified: 1, profileMetrics: measuredMetrics(rep) })));
    expect(server.filter((axis: { measuredScore: number | null }) => axis.measuredScore === null)).toHaveLength(4);
    expect(buildProfile(reps).axes.map(axis => axis.score)).toEqual(server.map((axis: { measuredScore: number | null }) => axis.measuredScore));
  });
});
