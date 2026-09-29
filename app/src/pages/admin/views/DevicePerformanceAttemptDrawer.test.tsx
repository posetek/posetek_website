// The attempt drawer: aligned lanes within a launch, unknown gaps across
// launches, "Stopped here" only for a known failure, honest evidence states,
// no video and no Storage links. Focus trapping, Escape and focus return need a
// browser and are recorded as a pending browser pass; the trap's index logic is
// tested here.

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import DevicePerformanceAttemptDrawer, { AttemptDetailView } from "./DevicePerformanceAttemptDrawer";
import { createDevicePerformanceClient, describeLoadFailure, focusTrapTarget, parseAttemptDetail } from "../lib/devicePerformance";
import { ATTEMPT_IDS, previewAttempt } from "../lib/devicePerformancePreview";

const ZONE = "America/Los_Angeles";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../lib/__fixtures__/device-performance-v1/fixtures/${name}`, import.meta.url), "utf8"));
const render = (index: number) => renderToStaticMarkup(<AttemptDetailView detail={parseAttemptDetail(previewAttempt(ATTEMPT_IDS[index]))} timeZone={ZONE} />);

describe("attempt timeline", () => {
  it("draws a healthy attempt without failure markers", () => {
    const html = render(0);
    expect(html).toContain("App launch 1");
    expect(html).not.toContain("App launch 2");
    expect(html).toContain("Recording and preparation");
    expect(html).toContain("Run 1 · Valid");
    expect(html).toContain("Required cloud save");
    expect(html).toContain("cumulative call time, not added");
    expect(html).toContain("Time to result not attributed to any step");
    expect(html).not.toContain("Stopped here");
    expect(html).not.toContain("Last reported step");
  });

  it("separates launches with an unknown gap and marks only the known failure", () => {
    const html = render(1);
    expect(html).toContain("App launch 2");
    expect(html).toContain("Unknown gap: the app relaunched");
    expect(html.match(/Stopped here/g)).toHaveLength(1);
    expect(html).toContain("Retry of run 1");
    expect(html).toContain("The phone ran low on memory.");
    expect(html).toContain("Not measured: spans an app relaunch");
    expect(html).toContain("Expired under the retention policy");
    expect(html).toContain("Video archive: not requested");
  });

  it("shows a failure before processing started without inventing a run", () => {
    const html = render(2);
    expect(html).toContain("Processing did not start");
    expect(html).toContain("Stopped before processing started");
    expect(html).toContain("Calibration was not available.");
    expect(html).not.toContain("Processing runs");
    expect(html).toContain("Not uploaded yet");
  });

  it("uses Last reported step for an interruption, never Stopped here", () => {
    const html = render(3);
    expect(html).toContain("Last reported step");
    expect(html).not.toContain("Stopped here");
    expect(html).toContain("outcome is unknown");
    expect(html).toContain("Not collected");
  });

  it("loads no video and shows no Storage link or token", () => {
    for (const index of [0, 1, 2, 3]) {
      const html = render(index);
      expect(html).not.toMatch(/<video|<source|<iframe/);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/token=|firebasestorage|googleapis/);
    }
  });

  it("reads the canonical contract fixtures", () => {
    const attempt = fixture("attempt-summary.valid.json");
    const detail = parseAttemptDetail({
      schemaVersion: 1, generatedAt: "2026-09-29T10:00:00.000Z", attemptId: attempt.attemptId, attempt,
      runs: [{ ...fixture("run-summary.valid.json"), attemptId: attempt.attemptId }],
      uploadGroups: [fixture("upload-group-summary.valid.json"), fixture("upload-group-summary-video-unavailable.valid.json")],
      transfers: [fixture("transfer-invocation.valid.json")], transferPagination: { pageSize: 50, nextCursor: "next", totalRows: 3 },
      receivedAt: { firstReceivedAtServer: null, updatedAtServer: null }, devices: [], evidence: [],
    });
    const html = renderToStaticMarkup(<AttemptDetailView detail={detail} timeZone={ZONE} onLoadMore={() => {}} />);
    expect(html).toContain("Usable result");
    expect(html).toContain("Ordinary recording");
    expect(html).toContain("Unknown gap: the app relaunched");
    expect(html).toContain("Unavailable (clip no longer on the phone)");
    expect(html).toContain("0.66 MB/s");
    expect(html).toContain("1 of 3 transfers shown");
    expect(html).toContain("Load more transfers");
    expect(html).toContain("Not measured: still uploading");
  });
});

describe("transfer paging after the list changed (D-26 A)", () => {
  it("offers a reload from the first page instead of resending a stale transfer cursor", () => {
    const detail = parseAttemptDetail({ ...previewAttempt(ATTEMPT_IDS[0]), transferPagination: { pageSize: 3, nextCursor: "stale-cursor", totalRows: 9 } });
    const stale = describeLoadFailure({ code: "functions/failed-precondition" }, "attempt");
    const html = renderToStaticMarkup(<AttemptDetailView detail={detail} timeZone={ZONE} more={stale} onLoadMore={() => {}} onRestart={() => {}} />);
    expect(html).toContain("The transfer list changed while you were paging");
    expect(html).toContain("Reload transfers from the first page");
    expect(html).not.toContain("Load more transfers");
    const other = renderToStaticMarkup(<AttemptDetailView detail={detail} timeZone={ZONE} more={describeLoadFailure({ code: "functions/unavailable" }, "attempt")} onLoadMore={() => {}} onRestart={() => {}} />);
    expect(other).toContain("Load more transfers");
    expect(other).toContain("The transfers above are kept.");
  });

  it("names the other install that processed a retry", () => {
    expect(render(1)).toContain("a different install (6db25a74)");
  });
});

describe("attempt drawer shell", () => {
  it("is a labelled modal dialog with a focusable close button and a loading state without numbers", () => {
    const source = createDevicePerformanceClient(() => new Promise(() => undefined));
    const html = renderToStaticMarkup(<MemoryRouter><DevicePerformanceAttemptDrawer attemptId={ATTEMPT_IDS[0]} source={source} timeZone={ZONE} onClose={() => {}} /></MemoryRouter>);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-label="Close attempt timeline"');
    expect(html).toContain("data-autofocus");
    expect(html).toContain("Loading this attempt");
  });

  it("wraps Tab and Shift+Tab at the edges of the dialog", () => {
    expect(focusTrapTarget(2, 3, false)).toBe(0);
    expect(focusTrapTarget(0, 3, true)).toBe(2);
    expect(focusTrapTarget(-1, 3, false)).toBe(0);
    expect(focusTrapTarget(-1, 3, true)).toBe(2);
    expect(focusTrapTarget(0, 0, false)).toBe(-1);
  });
});
