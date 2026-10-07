import { Link, useLocation } from "react-router-dom";
import { accountContext, accountQuery } from "../lib/accountHierarchy";
import { adminDirectoryPath, adminPlayerPath, adminPlayerReturn, parseAdminDirectoryState, selectDirectoryScope } from "../lib/adminNavigation";
import type { PlayerRow } from "../lib/accounts";
import { ADMIN_RETURN_STATE } from "../lib/useAdminNavigation";

interface Crumb { label: string; path: string | null }

/** These routes share PlayerDetail and its current-profile breadcrumb. Rep tools own their header. */
export function isPlayerDetailRoute(pathname: string): boolean {
  return /^\/admin\/accounts\/player\/[^/]+(?:\/results(?:\/[^/]+)?)?\/?$/.test(pathname);
}

/** Current profile ownership supplies parent links without another private context read. */
export function PlayerHierarchyBreadcrumbs({ player }: { player: Pick<PlayerRow, "name" | "organizationId" | "teamId"> }) {
  const location = useLocation(), state = parseAdminDirectoryState(location.search);
  const crumbs: Crumb[] = [{ label: "Organizations", path: adminDirectoryPath(selectDirectoryScope(state, { orgId: undefined, directoryLevel: "organizations" })) }];
  if (player.organizationId) {
    crumbs.push({ label: "Organization", path: adminDirectoryPath(selectDirectoryScope(state, { orgId: player.organizationId, directoryLevel: "teams" })) });
    crumbs.push({ label: player.teamId ? "Team" : "Unassigned", path: adminDirectoryPath(selectDirectoryScope(state, {
      orgId: player.organizationId, teamId: player.teamId || undefined, directoryLevel: "people",
      directoryLookup: player.teamId ? undefined : "unassigned",
    })) });
  }
  const detail = location.pathname.match(/^\/admin\/accounts\/player\/([^/]+)(\/results(?:\/([^/]+))?)?\/?$/);
  const current = selectDirectoryScope(state, { orgId: player.organizationId || undefined, teamId: player.teamId || undefined,
    directoryLevel: "people", directoryLookup: player.organizationId && !player.teamId ? "unassigned" : undefined });
  const playerLink = detail ? adminPlayerPath(decodeURIComponent(detail[1]), "results", current) : null;
  const resultsLink = playerLink?.replace(/(\?|$)/, "/results$1") || null;
  crumbs.push({ label: player.name, path: detail?.[2] ? playerLink : null });
  if (detail?.[2]) crumbs.push({ label: "Results", path: detail[3] ? resultsLink : null });
  if (detail?.[3]) crumbs.push({ label: decodeURIComponent(detail[3]).replaceAll("-", " "), path: null });
  return <Crumbs crumbs={crumbs} />;
}

// Device report → fleet keeps period, filters, sort and search but not page
// cursors, the open attempt or device-only views. Same rule as fleetPath() in
// lib/devicePerformance.ts (kept inline so this always-loaded header does not
// pull in the report library); AdminBreadcrumbs.test.tsx checks they agree.
const DEVICE_ONLY_PARAMS = ["cursor", "acursor", "attempt", "view", "section"];
function deviceFleetPath(search: string): string {
  const query = new URLSearchParams(search);
  for (const name of DEVICE_ONLY_PARAMS) query.delete(name);
  const text = query.toString();
  return `/admin/device-performance${text ? `?${text}` : ""}`;
}

function deviceCrumbs(installId: string, search: string, state: unknown): Crumb[] {
  const stored = (state as { deviceLabel?: unknown } | null)?.deviceLabel;
  const label = typeof stored === "string" && stored.trim() ? stored.trim().slice(0, 80) : `Device ${installId.slice(0, 8)}`;
  return [{ label: "Device performance", path: deviceFleetPath(search) }, { label, path: null }];
}

export default function AdminBreadcrumbs() {
  const location = useLocation();
  const device = location.pathname.match(/^\/admin\/device-performance\/([^/]+)\/?$/);
  if (device) return <Crumbs crumbs={deviceCrumbs(decodeURIComponent(device[1]), location.search, location.state)} />;
  const match = location.pathname.match(/^\/admin\/accounts\/player\/([^/]+)(?:\/results(?:\/([^/]+)(?:\/([^/]+))?)?)?/);
  if (!match) return null;
  const [, playerId, drillKey, repId] = match;
  const query = location.search || accountQuery(accountContext(location.search));
  const playerPath = `/admin/accounts/player/${playerId}`;
  const resultsPath = `${playerPath}/results`;
  const state = parseAdminDirectoryState(location.search);
  const crumbs: Crumb[] = [
    { label: "Organizations", path: adminDirectoryPath(selectDirectoryScope(state, { orgId: undefined, directoryLevel: "organizations" })) },
    ...(state.orgId ? [{ label: "Organization", path: adminDirectoryPath(selectDirectoryScope(state, { orgId: state.orgId, directoryLevel: "teams" })) }] : []),
    { label: state.teamId ? "Team" : state.orgId ? "All teams" : "People", path: adminPlayerReturn(location.search) },
    { label: "Player", path: `${playerPath}${query}` },
    ...(location.pathname.includes("/results") ? [{ label: "Results", path: `${resultsPath}${query}` }] : []),
    ...(drillKey ? [{ label: decodeURIComponent(drillKey).replaceAll("-", " "), path: `${resultsPath}/${drillKey}${query}` }] : []),
    ...(repId ? [{ label: "Rep", path: null }] : []),
  ];
  return <Crumbs crumbs={crumbs} />;
}

function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return <nav className="admin-breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((crumb, index) => <li key={`${crumb.label}:${index}`}>{crumb.path && index < crumbs.length - 1 ? <Link to={crumb.path} state={ADMIN_RETURN_STATE}>{crumb.label}</Link> : <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>}</li>)}</ol></nav>;
}
