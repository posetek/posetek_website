// The fleet page renders every plan 07 §7 state from a parsed report, with
// static markup (Vitest runs in node; keyboard, focus and layout checks are a
// browser pass). Data comes from the DEV preview through the same parser as the
// live callables.

import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import DevicePerformance, { AttemptList, FilterBar, FleetReportView, LoadError, PageHeading, ReportSkeleton, SummaryTiles } from "./DevicePerformance";
import {
  describeLoadFailure, devicePerformanceSearch, fleetRequest, parseDevicePerformanceQuery, parseFleetReport, recoverFromFailure, recoveryLabel,
} from "../lib/devicePerformance";
import type { FleetReportV1, QueryPatch, ReportState } from "../lib/devicePerformance";
import { previewFleet } from "../lib/devicePerformancePreview";

const NOW = new Date("2026-09-29T18:00:00Z");
const SEARCH = "?orgId=club&teamId=u15";
const markup = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={[`/admin/device-performance${SEARCH}`]}>{node}</MemoryRouter>);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");

function report(search = "", scenario: Parameters<typeof previewFleet>[1] = "normal") {
  const query = parseDevicePerformanceQuery(search, NOW);
  return { query, report: parseFleetReport(previewFleet(fleetRequest(query), scenario)) };
}
const ready = (value: FleetReportV1, extra: Partial<ReportState<FleetReportV1>> = {}): ReportState<FleetReportV1> => ({ status: "ready", report: value, failure: null, stale: false, ...extra });
function view(search = "", scenario: Parameters<typeof previewFleet>[1] = "normal", extra: Partial<ReportState<FleetReportV1>> = {}) {
  const { query, report: value } = report(search, scenario);
  return markup(<FleetReportView state={ready(value, extra)} query={query} search={`${SEARCH}${search ? `&${search}` : ""}`} onChange={() => {}} onRetry={() => {}} />);
}

describe("fleet overview", () => {
  const html = view();

  it("shows the four summaries with their units and denominators", () => {
    for (const title of ["Time to result", "Cloud save time", "Upload speed", "Processing failures"]) expect(html).toContain(`<h2>${title}</h2>`);
    expect(html).toMatch(/Typical<\/dt><dd>\d+(\.\d+)? s<\/dd>/);
    expect(html).toMatch(/<strong>\d+<\/strong> <span>of [\d,]+ known outcomes<\/span>/);
    expect(html).toContain("Not counted:");
    expect(html).toContain("stopped before processing started");
    expect(html).toContain("Usable results:");
    expect(html).toMatch(/MB\/s/);
  });

  it("keeps the upload role visible and defaulted to Result files", () => {
    expect(html).toContain("Upload role");
    expect(html).toContain('<option value="resultFiles" selected="">Result files</option>');
    expect(html).toContain("Small files: most of the time is per-upload overhead");
  });

  it("says which filters reached each summary and never puts an upload filter on processing", () => {
    const filtered = view("net=cellular&drill=sprint&role=optionalVideo");
    const processing = filtered.slice(filtered.indexOf("<h2>Processing failures</h2>"));
    expect(processing).toContain("Filtered by drill");
    expect(processing.slice(0, processing.indexOf("</section>"))).not.toContain("network");
    const upload = filtered.slice(filtered.indexOf("<h2>Upload speed</h2>"));
    expect(upload.slice(0, upload.indexOf("</section>"))).toContain("Filtered by drill, network");
  });

  it("lists all six local drills plus free record, even with no reports", () => {
    for (const drill of ["Jump", "Shooting", "Sprint", "Broad jump", "Change of direction", "Dribbling", "Free record (validation and upload)"]) expect(html).toContain(`<strong>${drill}</strong>`);
    expect(html).toContain("No reports in this period");
    for (const phase of ["Preparing the clip", "Video analysis", "Saving on the phone", "Unattributed"]) expect(html).toContain(phase);
    expect(html).toContain("View as a table");
    expect(html).toContain("Arrow keys move between steps");
  });

  it("names failure steps in plain language with count and denominator, codes behind details", () => {
    expect(html).toContain("Finding the ball");
    expect(html).toContain("Saving result files");
    expect(html).toContain("Loading calibration");
    expect(html).toMatch(/<td data-label="Failed">\d+ of [\d,]+<\/td>/);
    expect(html).toContain("<summary>Details</summary><code>kick.denseBall</code>");
    expect(html).toContain("Show attempts");
  });

  it("lists devices with explicit sorts, limited-data and staleness labels, and links that keep the filters", () => {
    expect(html).toContain("Sort devices");
    expect(html).toContain("Known failures, then slow results");
    expect(html).toContain('aria-sort="descending">Failures');
    expect(html).toContain("Unknown device");
    expect(html).toContain("Not recently reporting");
    expect(html).toContain("Limited data");
    expect(html).toMatch(/href="\/admin\/device-performance\/0d5c9a1e-2b3f-4c6d-8e7f-a0b1c2d3e4f5\?orgId=club&amp;teamId=u15"/);
    expect(html).toContain("Next page");
    expect(html).not.toMatch(/health score|gauge|radar/i);
  });

  it("puts every definition on the page, not only in tooltips", () => {
    for (const term of ["Time to result", "Cloud save time", "Upload speed", "Processing failures", "Usable results", "Typical and slow"]) expect(html).toContain(`<dt>${term}</dt>`);
    expect(html).toContain("How these numbers are defined");
  });

  it("discloses partial, stale, unknown-device and date-uncertain coverage without claiming full coverage", () => {
    expect(html).toContain("Partial reporting:");
    expect(html).toContain("not recently reporting. That does not mean offline or failing");
    expect(html).toContain("grouped as Unknown device");
    expect(html).toContain("Date uncertain");
    expect(html).toContain("Investigate by server receipt date");
    expect(html).toContain("Phones that never reported cannot be counted");
    expect(html).not.toMatch(/100% collected/);
  });
});

describe("fleet states", () => {
  it("draws a loading skeleton without numbers", () => {
    const html = markup(<ReportSkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading report");
    expect(text(html)).not.toMatch(/\d/);
    const page = markup(<FleetReportView state={{ status: "loading", report: null, failure: null, stale: false }} query={parseDevicePerformanceQuery("", NOW)} search="" onChange={() => {}} onRetry={() => {}} />);
    expect(text(page)).not.toMatch(/\d/);
  });

  it("separates nothing collected from no matching data from a real zero", () => {
    const uncollected = view("", "uncollected");
    expect(uncollected).toContain("Not collected yet");
    expect(uncollected).not.toContain("<h2>Processing failures</h2>");
    expect(uncollected).not.toMatch(/<strong>0<\/strong> <span>of 0/);
    const empty = view("drill=jump", "empty");
    expect(empty).toContain("No reports match these filters");
    expect(empty).toContain("This is not a count of zero attempts");
    expect(empty).toContain("Clear filters");
    const { query, report: base } = report();
    const zero = { ...base, totals: { ...base.totals, outcomes: { ...base.totals.outcomes, failed: 0 } } };
    const real = markup(<SummaryTiles report={zero} role={query.filters.uploadRole} onRole={() => {}} />);
    expect(real).toMatch(/<strong>0<\/strong> <span>of [\d,]+ known outcomes<\/span>/);
  });

  it("shows old-build attempts as not collected, never as zero", () => {
    const html = view("", "oldBuilds");
    expect(html).toContain("Not measured: Not collected by this app version");
    expect(html).toContain("Every attempt in this view came from an app version that does not collect these measurements");
    expect(html).not.toMatch(/Typical<\/dt><dd>0 ms/);
  });

  it("offers Retry that keeps the filters when the report fails, and explains an oversized query", () => {
    const query = parseDevicePerformanceQuery("days=90&drill=sprint", NOW);
    const failed = markup(<FleetReportView state={{ status: "error", report: null, failure: describeLoadFailure({ code: "functions/internal" }), stale: false }} query={query} search="" onChange={() => {}} onRetry={() => {}} />);
    expect(failed).toContain("Could not load report");
    expect(failed).toContain(">Retry</button>");
    expect(failed).toContain("Your filters are kept.");
    const oversized = markup(<FleetReportView state={{ status: "error", report: null, failure: describeLoadFailure({ code: "functions/resource-exhausted", details: { limit: 50_000 } }), stale: false }} query={query} search="" onChange={() => {}} onRetry={() => {}} />);
    expect(oversized).toContain("Narrow the date range or choose a drill or device.");
    expect(oversized).toContain("Use the last 7 days");
  });

  it("keeps the complete totals when a page, focus or detail request fails", () => {
    const html = view("cursor=preview-page-50", "normal", { status: "error", failure: describeLoadFailure({ code: "functions/unavailable" }), stale: true });
    expect(html).toContain('role="alert"');
    expect(html).toContain("The totals shown are still the complete report for these filters");
    expect(html).toContain("<h2>Time to result</h2>");
  });

  it("refuses a newer response format rather than drawing it", () => {
    expect(() => report("", "newerFormat")).toThrow(/format version 2/);
  });
});

// A plain walk over a React element tree (no rendering), so a button's onClick can be invoked in node.
function findElement(node: unknown, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findElement(child, match); if (found) return found; }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  return match(element) ? element : findElement(element.props.children, match);
}

describe("review fixes (D-26)", () => {
  it("A: a stale cursor offers Load the first page, and that action clears both cursors instead of resending them", () => {
    const failure = describeLoadFailure({ code: "functions/failed-precondition" });
    const query = parseDevicePerformanceQuery("cursor=p2&acursor=a1&drill=jump", NOW);
    const html = markup(<FleetReportView state={{ status: "error", report: null, failure, stale: false }} query={query} search="?cursor=p2&acursor=a1&drill=jump"
      onChange={() => {}} onRetry={() => {}} retryLabel={recoveryLabel(failure, true)} />);
    expect(html).toContain("The report changed");
    expect(html).toContain(">Load the first page</button>");
    expect(html).not.toContain(">Retry</button>");

    const patches: QueryPatch[] = [];
    let refreshed = 0;
    const onRetry = () => recoverFromFailure(failure, true, { refresh: () => { refreshed += 1; }, change: patch => { patches.push(patch); } });
    const tree = LoadError({ failure, onRetry, retryLabel: recoveryLabel(failure, true) });
    const button = findElement(tree, element => element.type === "button" && element.props.children === "Load the first page");
    (button!.props.onClick as () => void)();
    expect(patches).toEqual([{ cursor: null, acursor: null }]);
    expect(refreshed).toBe(0);
    expect(devicePerformanceSearch("?cursor=p2&acursor=a1&drill=jump", patches[0])).toBe("?drill=jump");

    const partial = view("cursor=preview-page-50", "normal", { status: "error", failure, stale: true });
    expect(partial).toContain(">Retry</button>"); // FleetReportView's default label; the page passes recoveryLabel
  });

  it("B: a report whose scope leaks an upload filter is refused with a visible scope-mismatch state", () => {
    const { query } = report("net=cellular");
    const leaky = previewFleet(fleetRequest(query)) as unknown as Record<string, Record<string, string[]>>;
    leaky.effectiveFilters.processing = ["networkInterface"];
    let failure = null;
    try { parseFleetReport(leaky); } catch (error) { failure = describeLoadFailure(error); }
    const html = markup(<FleetReportView state={{ status: "error", report: null, failure, stale: false }} query={query} search="?net=cellular" onChange={() => {}} onRetry={() => {}} />);
    expect(html).toContain("<h2>Report scope mismatch</h2>");
    expect(html).toContain("network reached processing time and failures");
    expect(html).toContain("none of this report is shown");
    expect(html).toContain("Clear filters");
    expect(html).not.toContain("<h2>Processing failures</h2>");
  });

  it("C: usable results carry their own scope line, never the processing one", () => {
    const html = view("pmode=recovery&drill=sprint");
    const tile = html.slice(html.indexOf("<h2>Processing failures</h2>"));
    const processing = tile.slice(0, tile.indexOf('aria-label="Usable results"'));
    const usable = tile.slice(tile.indexOf('aria-label="Usable results"'), tile.indexOf("</section>"));
    expect(processing).toContain("Filtered by drill, processing mode");
    expect(usable).toContain("Usable results:");
    expect(usable).toContain("Filtered by drill");
    expect(usable).not.toContain("processing mode");
  });

  it("D: attempt rows show the executing install on retries when the server supplies it", () => {
    const html = view("focus=stage:kick.denseBall");
    expect(html).toContain("Processed on another install, 6db25a74 (retry)");
    const { report: value } = report("focus=stage:kick.denseBall");
    const rows = value.attempts!.map(row => ({ ...row, executorInstallId: undefined }));
    expect(markup(<AttemptList rows={rows} timeZone="America/Los_Angeles" search="" locationState={null} />)).not.toContain("Processed on another install");
  });

  it("J: renders the inner-model cumulative call time table only when the response carries it", () => {
    const html = view();
    expect(html).toContain("Inner model timing: cumulative call time");
    expect(html).toContain("Loading a model");
    expect(html).toContain("First model prediction");
    expect(html).toContain("never added to them");
    const table = html.slice(html.indexOf("Inner model timing"), html.indexOf("Inner model timing") + 6000);
    expect(table).toContain("Broad jump");
    expect(table).toContain("Limited data");
    expect(view("", "oldBuilds")).not.toContain("Inner model timing");
  });

  it("K: says weighted effective throughput and shows the app-observed caveat on the tile", () => {
    const html = view();
    const tile = html.slice(html.indexOf("<h2>Upload speed</h2>"));
    const body = tile.slice(0, tile.indexOf("</section>"));
    expect(body).toContain("Weighted effective throughput");
    expect(body).toContain("App-observed payload throughput");
    expect(body).toContain("not the network&#x27;s capacity");
  });

  it("G: an unusable custom range is reported and nothing is loaded in its place", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/device-performance?start=2026-09-01&end=2099-01-01"]}><DevicePerformance /></MemoryRouter>);
    expect(html).toContain("This date range cannot be used");
    expect(html).toContain("The range ends after today");
    expect(html).not.toContain("Loading report");
    expect(html).toContain('value="custom" selected=""');
    expect(html).toContain('value="2099-01-01"');
    const form = markup(<FilterBar query={parseDevicePerformanceQuery("start=2026-09-01&end=2026-09-10", NOW)} choices={null} onChange={() => {}} />);
    expect(form).toMatch(/max="\d{4}-\d{2}-\d{2}"/);
  });
});

describe("matching attempts", () => {
  it("lists attempts for a failure step with honest markers and drawer links", () => {
    const html = view("focus=stage:input.calibration");
    expect(html).toContain("Matching attempts");
    expect(html).toContain("Attempts that failed or last reported at “Loading calibration”");
    expect(html).toContain("Stopped at Loading calibration");
    expect(html).toContain("Last reported step: Loading calibration");
    expect(html).toContain("Date uncertain");
    expect(html).toMatch(/href="\/admin\/device-performance\?orgId=club&amp;teamId=u15&amp;focus=stage%3Ainput\.calibration&amp;attempt=9f000000-[0-9a-f-]+"/);
  });
});

describe("page chrome and filters", () => {
  it("labels the scope All devices and states that the org/team scope does not apply", () => {
    const html = markup(<PageHeading report={null} loading onRefresh={() => {}} title="Device performance" intro="intro" />);
    expect(html).toContain("<strong>All devices.</strong>");
    expect(html).toContain("does not filter this report");
    expect(html).toContain("Refresh");
  });

  it("groups processing-only and upload-only filters visibly and lists active filters with remove buttons", () => {
    const query = parseDevicePerformanceQuery("drill=sprint&net=wifi&pmode=recovery", NOW);
    const html = markup(<FilterBar query={query} choices={report().report.choices} onChange={() => {}} />);
    expect(html).toContain("Processing only");
    expect(html).toContain("changes processing time and failures");
    expect(html).toContain("Uploads only");
    expect(html).toContain("never processing or usable results");
    expect(html).toContain("More filters (2 active)");
    expect(html).toContain('aria-label="Remove filter drill: Sprint"');
    expect(html).toContain('aria-label="Remove filter network: Wi-Fi"');
    expect(html).toContain("Recorded app version");
  });

  it("renders the page shell with a skeleton before any data arrives", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/device-performance?orgId=club"]}><DevicePerformance /></MemoryRouter>);
    expect(html).toContain("<h1>Device performance</h1>");
    expect(html).toContain("All devices.");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Synthetic preview");
  });

  it("reaches preview data only through the DEV-guarded loader", () => {
    for (const file of ["DevicePerformance.tsx", "DevicePerformanceDetail.tsx", "DevicePerformanceAttemptDrawer.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/devicePerformancePreview/);
    }
  });
});
