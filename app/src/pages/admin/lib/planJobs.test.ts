import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INTAKE, planV3JobParams } from "./planJobs";
import { emptyTrainingContext } from "./wholeBodyTraining";
import { resolveProfileAge } from '../../../lib/profile-age';

// Test the outgoing request without connecting to Firebase or creating a plan.
vi.mock("../../../lib/firebase", () => ({ db: {} }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: vi.fn() }));

describe("admin plan generation request", () => {
  it('does not prefill generation intake from undated, stale, future or impossible-DOB ages', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    for (const player of [{ age: 15 }, { age: 15, ageRecordedAt: '2025-01-01' }, { age: 15, ageRecordedAt: '2026-10-02' }, { birthDate: '2011-02-31' }]) {
      expect(planV3JobParams([], player, resolveProfileAge(player, now).age, DEFAULT_INTAKE).intake).not.toHaveProperty('age');
    }
    const player = { birthDate: '2011-10-01', age: 30, ageRecordedAt: '2027-01-01' };
    expect(planV3JobParams([], player, resolveProfileAge(player, now).age, DEFAULT_INTAKE).intake.age).toBe(15);
  });
  it("sends individual versioned training context only when explicitly supplied", () => {
    const context = { ...emptyTrainingContext(), startDate: "2026-09-21", sessionDays: [1, 3], scheduleConfirmed: true };
    expect(planV3JobParams([], {}, 15, { ...DEFAULT_INTAKE, trainingContext: context }).intake.trainingContext).toEqual(context);
    expect(planV3JobParams([], {}, 15, DEFAULT_INTAKE).intake).not.toHaveProperty("trainingContext");
  });
  it.each(["shooting", "side_kick", "deadballShot"])(
    "sends normalized %s results under the gateway's kick identifier",
    repType => {
      const reps = [
        { _statsDrill: "shooting", repType, velocity: 28.2, sessionNumber: 1 },
        { _statsDrill: "sprint", repType: "sprint", max_velocity: 6, sessionNumber: 1 },
      ];
      const params = planV3JobParams(reps, { position: "CB" }, 16, {
        ...DEFAULT_INTAKE, minutesPerSession: 90,
      });

      expect(params.planVersion).toBe(3);
      expect(params.intake).toMatchObject({ age: 16, position: "CB", minutesPerSession: 90 });
      expect(params.statsProfile.drills).toEqual(expect.arrayContaining([
        expect.objectContaining({
          drill: "kick",
          metrics: [expect.objectContaining({ metric: "ballSpeed", bestCanonical: 28.2 })],
        }),
        expect.objectContaining({
          drill: "sprint",
          metrics: [expect.objectContaining({ metric: "sprintMaxSpeed", bestCanonical: 6 })],
        }),
      ]));
      expect(params.statsProfile.drills).toHaveLength(2);
      expect(reps[0]).toMatchObject({ _statsDrill: "shooting", repType, velocity: 28.2 });
    },
  );
});
