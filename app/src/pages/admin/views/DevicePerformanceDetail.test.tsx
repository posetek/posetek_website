// The device report: sections, trend, attribution and the invalid-id state,
// rendered from preview data through the live parser.

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import DevicePerformanceDetail, { DeviceReportView } from "./DevicePerformanceDetail";
import { describeLoadFailure, detailRequest, parseDeviceReport, parseDevicePerformanceQuery, recoveryLabel } from "../lib/devicePerformance";
import type { DeviceReportV1, ReportState } from "../lib/devicePerformance";
import { previewDevice } from "../lib/devicePerformancePreview";

const NOW = new Date("2026-09-29T18:00:00Z");
const STATION_2 = "0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5";
const STALE = "3a8f2d41-5e6c-4f90-b1a2-d3e4f5a6b7c8";
const route = (path: string, node: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

function detail(installId: string, search = "") {
  const query = parseDevicePerformanceQuery(search, NOW);
  const report = parseDeviceReport(previewDevice(detailRequest(installId, query)));
  const state: ReportState<DeviceReportV1> = { status: "ready", report, failure: null, stale: false };
  const html = route(`/admin/device-performance/${installId}?orgId=club${search ? `&${search}` : ""}`,
    <DeviceReportView state={state} query={query} search={`?orgId=club${search ? `&${search}` : ""}`} onChange={() => {}} onRetry={() => {}} />);
  return { report, html };
}

describe("device report", () => {
  it("repeats the four summaries and the step breakdown for one phone, with a same-device trend and version markers", () => {
    const { html } = detail(STATION_2);
    for (const title of ["Time to result", "Cloud save time", "Upload speed", "Processing failures"]) expect(html).toContain(`<h2>${title}</h2>`);
    expect(html).toContain("Where time goes");
    expect(html).toContain("Trend on this phone");
    expect(html).toContain("New version 1.4.1 (215)");
    expect(html).toContain("Failures by step on this phone");
    expect(html).toContain("Last status");
  });

  it("offers Processing, Uploads and Failures rows with the current section marked", () => {
    const processing = detail(STATION_2).html;
    expect(processing).toContain('aria-current="page"');
    expect(processing).toMatch(/aria-current="page"[^>]*>.*?Processing<\/a>/);
    expect(processing).toMatch(/href="\/admin\/device-performance\/0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5\?orgId=club&amp;attempt=9f000000-/);

    const uploads = detail(STATION_2, "section=uploads").html;
    expect(uploads).toContain("Uploads from this phone");
    expect(uploads).toContain("required");
    expect(uploads).toContain("optional");
    expect(uploads).toContain("Waiting");

    const failures = detail(STATION_2, "section=failures").html;
    expect(failures).toContain("Stopped at Loading calibration");
    expect(failures).toContain("Calibration was not available.");
    expect(failures).toContain("Last reported step: Finding the ball");
    expect(failures).toContain("not a confirmed failure");
    expect(failures).toContain("View attempt");
  });

  it("shows a stale phone as not recently reporting with its backlog, not as offline", () => {
    const { html } = detail(STALE);
    expect(html).toContain("result uploads waiting");
    expect(html).toContain("dropped because report storage was full");
    expect(html).not.toMatch(/offline(?! or failing)/i);
  });

  it("keeps totals when a section request fails", () => {
    const query = parseDevicePerformanceQuery("section=uploads", NOW);
    const report = parseDeviceReport(previewDevice(detailRequest(STATION_2, parseDevicePerformanceQuery("", NOW))));
    const html = route(`/admin/device-performance/${STATION_2}?section=uploads`, <DeviceReportView
      state={{ status: "error", report, failure: describeLoadFailure({ code: "functions/unavailable" }), stale: true }}
      query={query} search="?section=uploads" onChange={() => {}} onRetry={() => {}} />);
    expect(html).toContain("The totals shown are still the complete report");
    expect(html).toContain("<h2>Time to result</h2>");
    expect(html).toContain("Uploads rows are not loaded.");
  });

  it("explains a missing device, and an id that is not an install id", () => {
    expect(describeLoadFailure({ code: "functions/not-found" }, "device").message).toContain("No device with this install id");
    const html = route("/admin/device-performance/not-an-install?orgId=club", <Routes><Route path="/admin/device-performance/:installId" element={<DevicePerformanceDetail />} /></Routes>);
    expect(html).toContain("No such device");
    expect(html).toContain('href="/admin/device-performance?orgId=club"');
  });

  it("reports an unusable custom range instead of loading another period (D-26 G)", () => {
    const html = route(`/admin/device-performance/${STATION_2}?start=2026-09-20&end=2026-09-01`, <Routes><Route path="/admin/device-performance/:installId" element={<DevicePerformanceDetail />} /></Routes>);
    expect(html).toContain("This date range cannot be used");
    expect(html).toContain("The start date is after the end date.");
    expect(html).not.toContain("Loading report");
  });

  it("shows the inner-model table and a stale-cursor recovery label on the device report", () => {
    expect(detail(STATION_2).html).toContain("Inner model timing: cumulative call time");
    const query = parseDevicePerformanceQuery("cursor=p2", NOW);
    const failure = describeLoadFailure({ code: "functions/failed-precondition" }, "device");
    const html = route(`/admin/device-performance/${STATION_2}?cursor=p2`, <DeviceReportView state={{ status: "error", report: null, failure, stale: false }}
      query={query} search="?cursor=p2" onChange={() => {}} onRetry={() => {}} retryLabel={recoveryLabel(failure, true)} />);
    expect(html).toContain(">Load the first page</button>");
  });

  it("shows pending as omitted under Processed or uploaded here, with pre-admission failures still counted (D-31 F8)", () => {
    const { html } = detail(STATION_2, "view=executor");
    expect(html).toContain("pending not shown under Processed or uploaded here");
    expect(html).toMatch(/\d+ stopped before processing started/);
  });

  it("says under Processed or uploaded here that run and upload counts are executor-based and attempt counts stay origin-based (D-27 5)", () => {
    const html = route(`/admin/device-performance/${STATION_2}?view=executor`, <Routes><Route path="/admin/device-performance/:installId" element={<DevicePerformanceDetail />} /></Routes>);
    expect(html).toContain('aria-pressed="true">Processed or uploaded here');
    expect(html).toContain("Run and upload counts are the runs and transfers this phone executed");
    expect(html).toContain("Attempt counts still mean attempts recorded on this phone");
  });

  it("renders the page shell with the short install id and both attribution choices before data arrives", () => {
    const html = route(`/admin/device-performance/${STATION_2}`, <Routes><Route path="/admin/device-performance/:installId" element={<DevicePerformanceDetail />} /></Routes>);
    expect(html).toContain("Device 0d5c9a1e");
    expect(html).toContain('aria-pressed="true">Captured here');
    expect(html).toContain("Processed or uploaded here");
    expect(html).toContain("All devices.");
    expect(html).toContain('aria-busy="true"');
  });
});
