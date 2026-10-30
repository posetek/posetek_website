// ?preview=1 demo data — port of athlete-portal.js loadPreview() and the
// preview branches of athlete-mobile-pages.js. Pure (no Firebase).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseReviewedResults, type ReviewedResult } from "../../../lib/reviewed-results";
import { reviewedResultFixtures } from "../../../lib/reviewed-results-fixtures";
import { visibleAttempts } from "../../../lib/result-values";
import { DRILLS } from "./drills";
import type { BodyPoint, StandingRow } from "./mobile";

export function previewData(reviewed = false): { access: "preview"; playerId: string; athlete: any; reps: Record<string, any[]>; reviewedResults?: ReviewedResult[] } {
  const athlete = { firstName: "Jordan", lastName: "Rivera", height: 178, weight: 72 };
  const now = Date.now();
  const make = (type: string, values: number[], extra: (value: number, index: number) => Record<string, any>) =>
    values.map((value, index) => ({
      id: `${type}-${index + 1}`,
      repType: type,
      sessionNumber: index < 2 ? 3 : 2,
      repNumber: index % 2 + 1,
      createdAtMillis: now - index * 86400000,
      ...extra(value, index),
    }));
  const reps: Record<string, any[]> = Object.fromEntries(DRILLS.map(d => [d.key, []]));
  reps.shooting = make("deadballShot", [28.2, 26.7, 25.9], value => ({ velocity: value, launch_angle: 18.4, strike_foot: "right" }));
  reps.sprint = make("sprint", [8.7, 8.3, 8.1], value => ({ max_velocity: value, max_acceleration: 3.1, totalTime: 3.92 }));
  reps.jump = make("jump", [.54, .51, .49], value => ({ jumpHeight: value }));
  reps.broadJump = make("broadJump", [2.12, 2.03, 1.96], value => ({ broadJumpDistance: value, jumpHeight: .31, takeoffFrame: 22, landingFrame: 78 }));
  reps.dribbling = make("dribbling", [5.08, 5.25, 5.39], value => ({ totalTime: value, totalDistance: 9.8, phase1Time: 1.92, phase2Time: 1.08, phase3Time: 2.08, avgBallDistance: .46 }));
  reps.changeOfDirection = make("changeOfDirection", [4.42, 4.55, 4.68], value => ({ totalTime: value, totalDistance: 9.8, phase1Time: 1.7, phase2Time: .91, phase3Time: 1.81, startFrame: 10, apexFrame: 60, endFrame: 112 }));
  reps.freeRecord = make("freeRecord", [1, 2], (_, index) => ({ sessionNumber: 2 - index, repNumber: 1, sessionFolder: `session${2 - index}`, repFolder: "kick1" }));
  if (import.meta.env.DEV && reviewed) {
    const rows = reviewedResultFixtures();
    const visible = visibleAttempts(rows);
    const reviewedReps = Object.fromEntries(DRILLS.map(d => [d.key, visible.filter(r => d.types.includes(String(r.repType)))]));
    // A good left attempt coexists with the separately displayed right estimate.
    reviewedReps.dribbling.push({ id: 'review-preview-qualified-left', repType: 'dribbling', sessionNumber: 1, repNumber: 1, createdAtMillis: Date.UTC(2026, 0, 10), totalTime: 8, dribble_foot: 'left', resultStatus: { qualified: true, duplicate: false, reason: 'complete', revisionId: null } } as any);
    return { access: "preview", playerId: "review-preview-player", athlete: { firstName: "Jordan", lastName: "Example", age: 11 }, reps: reviewedReps, reviewedResults: parseReviewedResults(rows) };
  }
  return { access: "preview", playerId: "preview-player", athlete, reps };
}

// Body Profile preview scan (renderBodyProfile's demo points and libraries).
export function previewBodyPoints(): BodyPoint[] {
  const demo: BodyPoint[] = Array.from({ length: 33 }, (_, id) => ({ id, x: .5, y: .5, z: null, visibility: 1 }));
  Object.assign(demo[11], { x: .38, y: .25 }); Object.assign(demo[12], { x: .62, y: .25 });
  Object.assign(demo[13], { x: .28, y: .42 }); Object.assign(demo[14], { x: .72, y: .42 });
  Object.assign(demo[15], { x: .22, y: .6 }); Object.assign(demo[16], { x: .78, y: .6 });
  Object.assign(demo[23], { x: .43, y: .52 }); Object.assign(demo[24], { x: .57, y: .52 });
  Object.assign(demo[25], { x: .4, y: .72 }); Object.assign(demo[26], { x: .6, y: .72 });
  Object.assign(demo[27], { x: .38, y: .92 }); Object.assign(demo[28], { x: .62, y: .92 });
  Object.assign(demo[29], { x: .36, y: .94 }); Object.assign(demo[30], { x: .64, y: .94 });
  Object.assign(demo[31], { x: .4, y: .96 }); Object.assign(demo[32], { x: .6, y: .96 });
  return demo;
}

export const PREVIEW_LIMB_LENGTHS: Record<string, number> = {
  trunk_length: .58, humerus_length: .33, forearm_length: .27, femur_length: .47, tibia_length: .43,
};

export const PREVIEW_LIMB_WEIGHTS: Record<string, number> = {
  trunk: 31.2, upper_arm_left: 2.1, upper_arm_right: 2.1, forearm_left: 1.2, forearm_right: 1.2,
  thigh_left: 7.4, thigh_right: 7.4, shank_left: 3.4, shank_right: 3.4,
};

// Leaderboards preview boards (renderLeaderboards' preview branch).
export function previewBoards(playerId: string, athleteName: string): Record<string, StandingRow[]> {
  const team = [
    { id: "one", name: "Maya Chen", value: 4.08 },
    { id: playerId, name: athleteName, value: 4.42 },
    { id: "three", name: "Alex Morgan", value: 4.63 },
    { id: "four", name: "Sam Lee", value: 4.81 },
  ];
  return {
    changeOfDirection: team,
    sprint: team.map((p, i) => ({ ...p, value: 20.1 - i })),
    jump: team.map((p, i) => ({ ...p, value: 24.8 - i * 1.4 })),
    shooting: team.map((p, i) => ({ ...p, value: 67.2 - i * 2.2 })),
    dribbling: team.map((p, i) => ({ ...p, value: 5.01 + i * .2 })),
  };
}
