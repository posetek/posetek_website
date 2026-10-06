// Port of the config/catalog data at the top of athlete-drill-view.js, plus the
// legacy-page → clean-route mapping used to keep pageUrl() semantics identical.

export type DrillKey =
  | "shooting"
  | "sprint"
  | "jump"
  | "broadJump"
  | "changeOfDirection"
  | "dribbling";

export type PageDrillKey = "broadJump" | "changeOfDirection" | "dribbling";

export interface DrillConfig {
  key: DrillKey;
  acceptedRepTypes: string[];
  primaryFields: string[];
  statsOnly?: boolean;
  primaryField?: string;
  title?: string;
  page?: string;
}

export interface PageDrillConfig extends DrillConfig {
  key: PageDrillKey;
  title: string;
  eyebrow: string;
  chartTitle: string;
  drillIcon: string;
  page: string;
  siblingPage?: string;
  primaryField: string;
  primaryLabel: string;
  bestLabel: string;
  averageLabel: string;
  chartLabel: string;
  lowerIsBetter: boolean;
  emptyText: string;
  artifacts: string[];
}

const broadJump: PageDrillConfig = {
  key: "broadJump",
  acceptedRepTypes: ["broadJump"],
  primaryFields: ["broadJumpDistance"],
  title: "Broad Jump",
  eyebrow: "Power · Horizontal jump",
  chartTitle: "Broad Jump Distance Over Time",
  drillIcon: "arrow_right_alt",
  page: "broadJumpPage.html",
  siblingPage: "changeOfDirectionPage.html",
  primaryField: "broadJumpDistance",
  primaryLabel: "Distance",
  bestLabel: "Best distance",
  averageLabel: "Average distance",
  chartLabel: "Distance (ft)",
  lowerIsBetter: false,
  emptyText: "No broad-jump results have been recorded for this athlete yet.",
  artifacts: [
    "pose.json",
    "metadata.json",
    "foot_piecewise_fit.json",
    "key_frames.json",
    "foot_centers.json",
    "com_midpoints.json",
    "com_height.json",
  ],
};

const changeOfDirection: PageDrillConfig = {
  key: "changeOfDirection",
  acceptedRepTypes: ["changeOfDirection"],
  primaryFields: ["totalTime"],
  title: "Change of Direction",
  eyebrow: "Agility · Shuttle test",
  chartTitle: "Shuttle Time Over Time",
  drillIcon: "switch_access_shortcut",
  page: "changeOfDirectionPage.html",
  siblingPage: "broadJumpPage.html",
  primaryField: "totalTime",
  primaryLabel: "Shuttle time",
  bestLabel: "Best time",
  averageLabel: "Average time",
  chartLabel: "Time (s)",
  lowerIsBetter: true,
  emptyText: "No change-of-direction results have been recorded for this athlete yet.",
  artifacts: ["pose.json", "metadata.json", "tracking.json"],
};

const dribbling: PageDrillConfig = {
  key: "dribbling",
  acceptedRepTypes: ["dribbling"],
  primaryFields: ["totalTime"],
  title: "Dribbling",
  eyebrow: "Ball control · Timed course",
  chartTitle: "Dribble Time Over Time",
  drillIcon: "sports_soccer",
  page: "dribblingPage.html",
  primaryField: "totalTime",
  primaryLabel: "Dribble time",
  bestLabel: "Best time",
  averageLabel: "Average time",
  chartLabel: "Time (s)",
  lowerIsBetter: true,
  emptyText: "No dribbling results have been recorded for this athlete yet.",
  artifacts: ["pose.json", "metadata.json", "tracking.json"],
};

// Key order matters: Object.values(configs) drives loadStatsReps / startShared /
// preview data exactly like the legacy `configs` literal did.
export const configs: Record<DrillKey, DrillConfig> = {
  shooting: {
    key: "shooting",
    acceptedRepTypes: ["side_kick", "deadballShot"],
    primaryFields: ["velocity"],
    statsOnly: true,
  },
  sprint: {
    key: "sprint",
    acceptedRepTypes: ["sprint"],
    primaryFields: ["max_velocity", "maxVelocity"],
    statsOnly: true,
  },
  jump: {
    key: "jump",
    acceptedRepTypes: ["jump"],
    primaryFields: ["jumpHeight"],
    statsOnly: true,
  },
  broadJump,
  changeOfDirection,
  dribbling,
};

export const pageConfigs: Record<PageDrillKey, PageDrillConfig> = {
  broadJump,
  changeOfDirection,
  dribbling,
};

export interface DrillCatalogEntry {
  key: DrillKey;
  label: string;
  page: string;
  extra: Record<string, string>;
}

export const drillCatalog: DrillCatalogEntry[] = [
  { key: "shooting", label: "Shooting", page: "kickingview.html", extra: { tab: "kick" } },
  { key: "sprint", label: "Sprint", page: "kickingview.html", extra: { tab: "sprint" } },
  { key: "jump", label: "Jump", page: "kickingview.html", extra: { tab: "jump" } },
  { key: "broadJump", label: "Broad Jump", page: "broadJumpPage.html", extra: { view: "results" } },
  { key: "dribbling", label: "Dribbling", page: "dribblingPage.html", extra: { view: "results" } },
  { key: "changeOfDirection", label: "Change of Direction", page: "changeOfDirectionPage.html", extra: { view: "results" } },
];

export interface BenchmarkDefinition {
  key: string;
  fields: string[];
}

export const drillBenchmarks: Record<PageDrillKey, BenchmarkDefinition[]> = {
  broadJump: [{ key: "broadJumpDistance", fields: ["broadJumpDistance"] }],
  changeOfDirection: [
    { key: "codTotalTime", fields: ["totalTime"] },
    { key: "codOutboundTime", fields: ["phase1Time"] },
    { key: "codTurnTime", fields: ["phase2Time"] },
    { key: "codReturnTime", fields: ["phase3Time"] },
  ],
  dribbling: [
    { key: "dribbleTotalTime", fields: ["totalTime"] },
    { key: "dribbleBallControl", fields: ["avgBallDistance"] },
    { key: "dribbleOutboundTime", fields: ["phase1Time"] },
    { key: "dribbleTurnTime", fields: ["phase2Time"] },
    { key: "dribbleReturnTime", fields: ["phase3Time"] },
  ],
};

// Legacy pages that have a React route. Anything else (kickingview.html) stays a
// plain root-relative .html link served by scripts/copy-legacy.mjs.
export const pageRoutes: Record<string, string> = {
  "broadJumpPage.html": "/drills/broad-jump",
  "changeOfDirectionPage.html": "/drills/change-of-direction",
  "dribblingPage.html": "/drills/dribbling",
  "profile.html": "/athlete",
};

export function isPortedPage(page: string): boolean {
  return Object.hasOwn(pageRoutes, page);
}

export function routeFor(page: string): string {
  return pageRoutes[page] ?? `/${page}`;
}

export interface PageUrlState {
  preview: boolean;
  shareToken: string | null;
  playerId: string | null;
  viewerRole: string | undefined;
}

// Port of pageUrl(): identical param names, values, and insertion order — only the
// path is mapped from the legacy .html file to its clean route.
export function buildPageUrl(
  page: string,
  extra: Record<string, string | null | undefined>,
  state: PageUrlState,
): string {
  const query = new URLSearchParams();
  if (state.preview) {
    query.set("preview", "1");
  } else if (state.shareToken) {
    query.set("share", state.shareToken);
  } else {
    if (state.playerId) query.set("player", state.playerId);
    query.set("userType", state.viewerRole || "player");
  }
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") query.set(key, value);
  });
  return `${routeFor(page)}?${query.toString()}`;
}
