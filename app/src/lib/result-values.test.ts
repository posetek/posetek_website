import { describe, expect, it } from "vitest";
import { finiteNumber, metricValue, visibleAttempts, resultUsable, attemptLabel, resultLabel } from "./result-values";
import { metricRaw, repMetricSpecs, dashboardMetrics } from "../pages/athlete-portal/lib/metrics";
import { drillByKey } from "../pages/athlete-portal/lib/drills";
import { normalizeAuthRep, repMetricCards, summaryMetrics } from "../pages/drill-share/drill-lib";
import { configs } from "../pages/drill-share/drill-config";
import { buildProfile } from "../components/athlete-stats/profile";

const broad = drillByKey("broadJump");
describe("effective result readers", () => {
  it("labels recorded results without implying independent physical verification or changing eligibility", () => {
    const rep = { totalTime: 5, resultStatus: { qualified: true, duplicate: false, reason: 'complete' } };
    expect(resultLabel(rep)).toBe('Recorded result');
    expect(resultUsable(rep)).toBe(true);
    expect(metricValue(rep, 'totalTime')).toBe(5);
    expect(resultLabel({ ...rep, resultStatus: { ...rep.resultStatus, reason: 'acceptedRevision' } })).toBe('Reviewed result');
    expect(resultLabel({ ...rep, resultStatus: { ...rep.resultStatus, qualified: false } })).toBe('Result unavailable · needs review');
  });
  it("does not manufacture zero from absent data", () => {
    for (const value of [null, undefined, "", "  ", false, true, [], {}, NaN, Infinity]) expect(finiteNumber(value)).toBeNull();
    expect(finiteNumber(0)).toBe(0); expect(finiteNumber("1.2")).toBe(1.2);
  });
  it("keeps failed broad-jump fits unavailable in cards, details, summary and stats", () => {
    const rep = { id: "failed", repType: "broadJump", broadJumpDistance: null, resultStatus: { qualified: false, reason: "evidenceNotComplete" } };
    const meta = { broadJumpDistance: 1.8, resultsValid: false };
    expect(metricRaw(rep, broad)).toBeNull();
    expect(repMetricSpecs(broad, rep, meta)[0].value).toBe("—");
    const normalized = normalizeAuthRep(rep.id, rep, configs.broadJump);
    expect(normalized.primary).toBeNull();
    expect(repMetricCards("broadJump", { "metadata.json": meta }, normalized)[0].value).toBe("—");
    expect(summaryMetrics("broadJump", [normalized], false)[0].value).toBe("—");
    expect(dashboardMetrics(broad, [rep])[0].value).toBe("—");
    expect(buildProfile([rep]).overall).toBeNull();
  });
  it("accepted results always use the canonical values even when metadata is stale", () => {
    const rep = { broadJumpDistance: 1.6, jumpHeight: null, resultStatus: { qualified: true, reason: "acceptedRevision", revisionId: "r" } };
    expect(metricValue(rep, "broadJumpDistance", { broadJumpDistance: 8 })).toBe(1.6);
    expect(metricValue(rep, "jumpHeight", { jumpHeight: .3 })).toBeNull();
    expect(repMetricSpecs(broad, rep, { broadJumpDistance: 8, jumpHeight: .3 })[0].value).toBe("5.2 ft");
  });
  it("valid distance survives invalid secondary height, and legitimate zero frames/angles survive", () => {
    const rep = { broadJumpDistance: 2, jumpHeight: -.4, peakFrame: 0, launch_angle: 0 };
    expect(metricValue(rep, "broadJumpDistance")).toBe(2);
    expect(metricValue(rep, "jumpHeight")).toBeNull();
    expect(metricValue(rep, "peakFrame")).toBe(0); expect(metricValue(rep, "launch_angle")).toBe(0);
    expect(metricValue({ jump_height_in: 20 }, "jumpHeight")).toBe(.508);
  });
  it("raw invalid or incomplete evidence cannot be resurrected by an artifact", () => {
    expect(metricValue({ resultsValid: false }, "totalTime", { totalTime: 6 })).toBeNull();
    expect(metricValue({}, "broadJumpDistance", { resultsValid: false, broadJumpDistance: 1.5 })).toBeNull();
    expect(resultUsable({ resultStatus: { qualified: true, duplicate: true } })).toBe(false);
  });
  it("suppresses proven mirrors while preserving independent attempts and missing coordinates", () => {
    const base = { repType: "jump", sessionNumber: 1, repNumber: 1 };
    const rows = [{ ...base, id: "a", storagePath: "p/jump/session1/kick1" }, { ...base, id: "mirror" },
      { ...base, id: "b", storagePath: "p/jump/session2/kick1" }, { repType: "jump", id: "unknown" },
      { ...base, id: "server-duplicate", resultStatus: { duplicate: true, qualified: false } }];
    expect(visibleAttempts(rows).map(row => row.id)).toEqual(["a", "b", "unknown"]);
    expect(attemptLabel(rows[0], rows)).not.toBe(attemptLabel(rows[2], rows));
    expect(attemptLabel(rows[3], rows)).toContain("Attempt");
  });

  it("hides failed station attempts from athletes and coaches but not from staff review", () => {
    const rows = [
      { id: "good", repType: "sprint", resultStatus: { qualified: true } },
      { id: "flagged", repType: "sprint", failedAttempt: true, resultStatus: { qualified: false } },
      { id: "raw", repType: "sprint", processingStatus: "failed", resultsValid: false },
      { id: "partial", repType: "sprint", processingStatus: "partial", resultsValid: false },
    ];
    expect(visibleAttempts(rows).map(row => row.id)).toEqual(["good", "partial"]);
    expect(visibleAttempts(rows, { includeFailedAttempts: true }).map(row => row.id)).toEqual(["good", "flagged", "raw", "partial"]);
  });
});
