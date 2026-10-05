import type { ExpandedInsights } from "./lib/expanded";
import { FEATURE_LABELS, TESTING_LABELS, USAGE_LABELS, WORKOUT_LABELS } from "./lib/expanded";
import { ageLabel, clearPlayerFilters, divisionLabel, hasPlayerFilters } from "./lib/expandedQuery";
import type { ExpandedRequest } from "./lib/expandedQuery";

export default function PlayerFilters({ data, request, onChange }: {
  data: ExpandedInsights; request: ExpandedRequest; onChange: (patch: Partial<ExpandedRequest>) => void;
}) {
  const labels = { division: divisionLabel(request.division), ageBand: ageLabel(request.ageBand), testingStatus: TESTING_LABELS[request.testingStatus], workoutStatus: WORKOUT_LABELS[request.workoutStatus], usageStatus: USAGE_LABELS[request.usageStatus], usagePlatform: ({ web: "Website only", ios: "iOS only", both: "Both at once" } as Record<string, string>)[request.usagePlatform], usageFeature: FEATURE_LABELS[request.usageFeature] || request.usageFeature, teamAssignment: request.teamAssignment === "unassigned" ? "Unassigned players" : "Assigned players" };
  const filtered = hasPlayerFilters(request);
  return <>
    <div className="insights-toolbar"><p className="insights-note">{data.roster.filtered.toLocaleString()} of {data.roster.included.toLocaleString()} included players · current roster{data.scope.assignedTeamsOnly ? " · assigned teams only" : ""}</p>{filtered && <button className="insights-text-button" type="button" onClick={() => onChange(clearPlayerFilters())}>Clear all filters</button>}</div>
    {filtered && <div className="insights-filter-chips" aria-label="Active player filters">{(Object.keys(labels) as (keyof typeof labels)[]).filter(key => request[key]).map(key => <button type="button" key={key} onClick={() => onChange({ [key]: "" })}>{labels[key]} <span aria-hidden="true">×</span><span className="insights-sr-only"> Remove filter</span></button>)}</div>}
  </>;
}
