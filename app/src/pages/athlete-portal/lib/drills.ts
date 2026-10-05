// Port of the DRILLS table from athlete-portal.js — values byte-equal to legacy.

export interface Drill {
  key: string;
  label: string;
  short?: string;
  icon: string;
  storage: string;
  types: string[];
  title: string;
  metric: string | null;
  fallback?: string;
  unit: string;
  higher: boolean;
  artifacts: string[];
}

export const DRILLS: Drill[] = [
  { key: "shooting", label: "Shooting", icon: "sports_soccer", storage: "deadballShot", types: ["side_kick", "deadballShot", "shooting"], title: "Ball Speed Over Time", metric: "velocity", unit: "mph", higher: true, artifacts: ["pose.json", "metadata.json", "ball_detections.json"] },
  { key: "sprint", label: "Sprint", icon: "sprint", storage: "sprint", types: ["sprint"], title: "Top Speed Over Time", metric: "max_velocity", fallback: "maxVelocity", unit: "mph", higher: true, artifacts: ["pose.json", "metadata.json", "tracking.json"] },
  { key: "jump", label: "Jump", icon: "jump_to_element", storage: "jump", types: ["jump"], title: "Jump Height Over Time", metric: "jumpHeight", unit: "in", higher: true, artifacts: ["pose.json", "metadata.json", "com_height.json", "torso_midpoints.json", "key_frames.json"] },
  { key: "broadJump", label: "Broad Jump", icon: "straighten", storage: "broadJump", types: ["broadJump"], title: "Broad Jump Distance Over Time", metric: "broadJumpDistance", unit: "ft", higher: true, artifacts: ["pose.json", "metadata.json", "foot_piecewise_fit.json", "key_frames.json", "foot_centers.json", "com_midpoints.json", "com_height.json"] },
  { key: "dribbling", label: "Dribbling", icon: "sports_soccer", storage: "dribbling", types: ["dribbling"], title: "Dribble Time Over Time", metric: "totalTime", unit: "s", higher: false, artifacts: ["pose.json", "metadata.json", "tracking.json"] },
  { key: "changeOfDirection", label: "Change of Direction", short: "Agility", icon: "switch_access_shortcut", storage: "changeOfDirection", types: ["changeOfDirection"], title: "Shuttle Time Over Time", metric: "totalTime", unit: "s", higher: false, artifacts: ["pose.json", "metadata.json", "tracking.json"] },
  { key: "freeRecord", label: "Free Record", icon: "videocam", storage: "freeRecord", types: ["freeRecord"], title: "Recorded Sessions", metric: null, unit: "", higher: true, artifacts: ["pose.json", "metadata.json", "ball_detections.json"] },
];

export const drillByKey = (key: string | null | undefined): Drill =>
  DRILLS.find(item => item.key === key) || DRILLS[0];
