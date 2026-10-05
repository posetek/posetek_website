import { useEffect, useId, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type { ExpandedInsights, QualifiedProgress } from "./lib/expanded";
import { shortDate } from "./lib/expanded";
import { drillLabel } from "./lib/insights";
import { CHART_AXIS, CHART_THEME } from "./chartTheme";
import { AboutNumbers } from "./BreakdownChart";

export function progressDisplay(series: Pick<QualifiedProgress, "drill" | "unit">) {
  if (series.unit === "m/s") return { unit: "mph", factor: 2.23694, digits: 1 };
  if (series.unit === "m" && series.drill === "jump") return { unit: "in", factor: 39.37007874015748, digits: 1 };
  if (series.unit === "m" && series.drill === "broadJump") return { unit: "ft", factor: 3.28084, digits: 1 };
  return { unit: series.unit, factor: 1, digits: 2 };
}

function ProgressMetric({ series, denominator }: { series: QualifiedProgress; denominator: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), id = useId();
  const display = progressDisplay(series), title = drillLabel(series.drill);
  const labels = useMemo(() => series.weeks.map(week => shortDate(week.weekStart)), [series.weeks]);
  const values = useMemo(() => series.weeks.map(week => week.best === null ? null : Number((week.best * display.factor).toFixed(display.digits))), [series.weeks, display.factor, display.digits]);
  const hasResults = values.some(value => value !== null);
  useEffect(() => {
    if (!canvas.current || !hasResults) return;
    const chart = new Chart(canvas.current, {
      type: "line", data: { labels, datasets: [{ label: "Best qualified result", data: values, spanGaps: true, tension: 0, borderColor: CHART_THEME.accent, borderWidth: 2, pointRadius: 4, pointBackgroundColor: CHART_THEME.accent, pointBorderColor: CHART_THEME.surface, pointBorderWidth: 2 }] },
      options: { maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: item => `Best: ${item.formattedValue} ${display.unit}`,
          afterLabel: item => `${series.weeks[item.dataIndex].samples} qualifying results · ${series.weeks[item.dataIndex].players} of ${denominator} players`,
        } } },
        scales: { x: { ...CHART_AXIS, ticks: { ...CHART_AXIS.ticks, maxRotation: 0, maxTicksLimit: 6 }, grid: { display: false } }, y: { ...CHART_AXIS, title: { display: true, text: display.unit, color: CHART_THEME.text } } },
      },
    });
    return () => chart.destroy();
  }, [labels, values, hasResults, series.weeks, display.unit, denominator]);
  return <section className="insights-metric" aria-labelledby={id}>
    <div className="insights-section-title"><h3 id={id}>{title}</h3><span>{display.unit} · {series.lowerIsBetter ? "lower is better" : "higher is better"}</span></div>
    <p className="insights-note">{series.samples.toLocaleString()} qualifying results · {series.players.toLocaleString()} of {denominator.toLocaleString()} matching players contributed in this period.</p>
    {hasResults ? <div className="insights-chart small"><canvas ref={canvas} aria-hidden="true" /></div> : <p className="insights-note">No qualified results in this period.</p>}
    <details className="insights-data-table"><summary>View {title.toLowerCase()} chart data</summary><div className="insights-table-wrap"><table className="insights-table"><caption className="insights-sr-only">{title} qualified performance by week</caption><thead><tr><th scope="col">Week beginning</th><th scope="col">Best ({display.unit})</th><th scope="col">Qualifying results</th><th scope="col">Players contributing</th></tr></thead><tbody>{series.weeks.map((week, index) => <tr key={week.weekStart}><th scope="row">{week.weekStart}</th><td>{values[index] === null ? "No qualified result" : values[index]!.toLocaleString(undefined, { maximumFractionDigits: display.digits })}</td><td>{week.samples}</td><td>{week.players} / {denominator}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export default function PerformanceProgress({ data }: { data: ExpandedInsights }) {
  return <section className="insights-card" aria-labelledby="insights-progress-heading"><div className="insights-section-title"><h2 id="insights-progress-heading">Qualified performance by week</h2><span>{data.period.startDate}–{data.period.endDate}</span></div>
    <AboutNumbers><p>Best verified primary result across the full filtered roster each week, using {data.period.timeZone}. The line connects weeks with qualified results across empty weeks; the data table marks weeks with no qualified result. This series always uses the selected period, including partial boundary weeks. Cumulative coverage above can include earlier results. Different players may set each weekly best; this is not a measure of individual improvement.</p></AboutNumbers>
    {data.testing.progress ? data.testing.progress.length ? <div className="insights-metric-grid">{data.testing.progress.map(series => <ProgressMetric key={series.drill} series={series} denominator={data.roster.filtered} />)}</div> : <p className="insights-note">No qualified results in this period.</p> : <p className="insights-note" role="status">Qualified performance is unavailable in this response. Refresh to load the complete report.</p>}
  </section>;
}
