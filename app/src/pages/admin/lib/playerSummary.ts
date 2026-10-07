import type { PlayerRow } from "./accounts";
import { hasClubIdentity } from "./accountHierarchy";
import { parseAdminDirectoryState, validatedAdminReturn, workspaceReportSearch, legacyAdminWorkspacePath } from "./adminNavigation";
import type { InsightScope } from "../../insights/lib/expanded";

/** Canonical profile ownership wins over the organization the admin originally opened. */
export function playerSummaryRequest(player: PlayerRow, search: string): { scope: InsightScope | null; search: string } {
  const validId = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 150 && !/[\\/]/.test(value)
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  // A missing/deleted team does not remove a canonical player from their organization.
  // The single-ID lookup still resolves the player's current team authoritatively.
  const scope: InsightScope | null = hasClubIdentity(player) && validId(player.organizationId)
    ? { kind: "organization", organizationId: player.organizationId } : null;
  let state = parseAdminDirectoryState(search);
  // Older deep links carried their reporting period only in the validated return.
  let back = validatedAdminReturn(state.returnTo);
  for (let depth = 0; back && depth < 2; depth++) {
    const url = new URL(back, "https://posetek.net");
    const query = url.pathname === "/admin" ? legacyAdminWorkspacePath(url.search).split("?")[1] || "" : url.search;
    const origin = parseAdminDirectoryState(query);
    state = { ...origin, ...state,
      reportStart: state.reportStart ?? origin.reportStart, reportEnd: state.reportEnd ?? origin.reportEnd,
      reportWeeks: state.reportWeeks ?? origin.reportWeeks, reportTimezone: state.reportTimezone ?? origin.reportTimezone,
      reportTestingWindow: state.reportTestingWindow ?? origin.reportTestingWindow };
    back = validatedAdminReturn(origin.returnTo);
  }
  return { scope, search: workspaceReportSearch({
    reportStart: state.reportStart, reportEnd: state.reportEnd, reportWeeks: state.reportWeeks,
    reportTimezone: state.reportTimezone, reportTestingWindow: state.reportTestingWindow,
  }) };
}
