/* eslint-disable @typescript-eslint/no-explicit-any */
import { auth, db } from "../../../lib/firebase";
import { getClubContext } from "../../../lib/organization-data";
import { ownsPlayer } from "../../../lib/identity";
import { readAccessibleLegacyRoster } from "../../../lib/legacy-roster";
import { loadCoachContext } from "../../coach-dashboard/lib/data";
import { loadCoaches, loadOrganizations, playerRow } from "./accounts";
import { legacyCoachGroups } from "./accountHierarchy";
import type { OrganizationRow, PlayerRow, TeamRow } from "./accounts";

export type PlannerRole = "admin" | "staff" | "athlete";
export interface PlannerScope { organizations: OrganizationRow[]; teams: TeamRow[]; players: PlayerRow[]; organizationId: string; limited: boolean }
const orgRow = (o: any): OrganizationRow => ({ ...o, code: "", coachIds: [], logoUrl: null });
const uniquePlayers = (rows: PlayerRow[]) => [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.name.localeCompare(b.name));
const referenceId = (value: any) => typeof value === "string" ? value : value?.id;
const PLANNER_ROSTER_LIMIT = 2000;

export async function legacyOrganizationPlayers(org: OrganizationRow, organizations: OrganizationRow[]) {
  const players = db.collection("players");
  const queryRows = (field: string, value: any) => players.where(field, "==", value).limit(PLANNER_ROSTER_LIMIT + 1).get();
  const directQueries = [queryRows("organizationId", org.id), queryRows("organization", db.collection("organizations").doc(org.id)), queryRows("organization", org.id)];
  if (org.code) directQueries.push(queryRows("organizationCode", org.code));
  const [snapshots, coaches] = await Promise.all([Promise.all(directQueries), loadCoaches()]);
  const linked = legacyCoachGroups(organizations, coaches).groups.get(org.id) || [];
  let limited = snapshots.some(snapshot => snapshot.docs.length > PLANNER_ROSTER_LIMIT);
  const rows = snapshots.flatMap(snapshot => snapshot.docs.map(doc => playerRow(doc.id, doc.data())));
  for (const coach of linked) {
    if (rows.length > PLANNER_ROSTER_LIMIT) { limited = true; break; }
    const memberIds = coach.members.slice(0, PLANNER_ROSTER_LIMIT + 1);
    limited ||= coach.members.length > PLANNER_ROSTER_LIMIT;
    const [members, pointers] = await Promise.all([
      readAccessibleLegacyRoster(memberIds, id => players.doc(id).get()),
      Promise.all([...new Set([coach.userUID, coach.id])].map(uid => queryRows("coachUID", uid))
        .concat([queryRows("coach", db.collection("coaches").doc(coach.id))])),
    ]);
    limited ||= pointers.some(snapshot => snapshot.docs.length > PLANNER_ROSTER_LIMIT);
    rows.push(...[...members, ...pointers.flatMap(snapshot => snapshot.docs)].filter(doc => doc.exists).map(doc => playerRow(doc.id, doc.data())));
  }
  const unique = uniquePlayers(rows.filter(row => {
      if (Object.hasOwn(row.raw, "organizationId")) return row.raw.organizationId === org.id;
      const assigned = referenceId(row.raw.organization);
      return !assigned || assigned === org.id;
    }));
  return { players: unique.slice(0, PLANNER_ROSTER_LIMIT), limited: limited || unique.length > PLANNER_ROSTER_LIMIT };
}

/** Canonical context controls scope. Individual reads enrich only authorized IDs. */
export async function loadPlannerScope(role: PlannerRole, requestedOrg = "", fixedPlayerId = ""): Promise<PlannerScope> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Sign in with a registered account to open the personalized planner.");
  const finish = (scope: PlannerScope) => {
    if (auth.currentUser?.uid !== user.uid) throw new Error("Your sign-in changed. Reopen the personalized planner.");
    return scope;
  };
  if (role === "athlete") {
    if (!fixedPlayerId) throw new Error("No athlete is selected.");
    const doc = await db.collection("players").doc(fixedPlayerId).get();
    if (!doc.exists) throw new Error("This athlete is unavailable.");
    const raw = doc.data()!;
    // The gateway/rules repeat the binding check; shared links never grant planning access.
    if (!ownsPlayer(doc, user.uid)) throw new Error("Open the planner from your own athlete account.");
    return finish({ organizations: [], teams: [], players: [playerRow(doc.id, raw)], organizationId: "", limited: false });
  }
  // A legacy organization is not a club and cannot be passed to getClubContext.
  // Resolve the actor first, then select a canonical club or explicit legacy fallback.
  const context = await getClubContext();
  if (role === "admin" && context.role !== "admin") throw new Error("Administrator access is required.");
  if (role === "staff" && !["manager", "coach"].includes(context.role)) {
    // Independent legacy coaches retain their current permitted roster only.
    if (context.role !== "none") throw new Error("Open the planner from your authorized account.");
    const legacy = await loadCoachContext(user);
    const coach = legacy.coachDoc?.data?.() || {};
    const candidates = [...legacy.players];
    let limited = candidates.length > PLANNER_ROSTER_LIMIT;
    // The gateway's legacy staff rule also recognizes a matching organization code.
    // A coachUID/ref alone is not added here: it is not sufficient in authorize_v3.
    if (coach.userUID === user.uid && typeof coach.organizationCode === "string" && coach.organizationCode) {
      const snapshot = await db.collection("players").where("organizationCode", "==", coach.organizationCode).limit(PLANNER_ROSTER_LIMIT + 1).get();
      limited ||= snapshot.docs.length > PLANNER_ROSTER_LIMIT;
      candidates.push(...snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }
    const rows = uniquePlayers(candidates.filter(p => !Object.hasOwn(p, "organizationId")).map(p => playerRow(p.id, p)));
    return finish({ organizations: [], teams: [], players: rows.slice(0, PLANNER_ROSTER_LIMIT), organizationId: "", limited: limited || rows.length > PLANNER_ROSTER_LIMIT });
  }
  if (role === "admin" && !requestedOrg && fixedPlayerId) {
    const doc = await db.collection("players").doc(fixedPlayerId).get();
    if (!doc.exists) throw new Error("The selected athlete is unavailable.");
    const row = playerRow(doc.id, doc.data());
    if (!Object.hasOwn(row.raw, "organizationId") || !row.organizationId) return finish({ organizations: await loadOrganizations(), teams: [], players: [row], organizationId: "", limited: false });
    requestedOrg = row.organizationId;
  }
  const organizations = role === "admin" ? await loadOrganizations() : context.organizations.map(orgRow);
  const target = requestedOrg || context.organization?.id || organizations.find(o => o.schemaVersion === 2)?.id || organizations[0]?.id || "";
  if (target && !organizations.some(org => org.id === target)) throw new Error("This organization is not available to your account.");
  if (role === "admin" && target && organizations.find(o => o.id === target)?.schemaVersion !== 2) {
    const org = organizations.find(o => o.id === target)!;
    return finish({ organizations, teams: [], ...await legacyOrganizationPlayers(org, organizations), organizationId: target });
  }
  const club = target && context.organization?.id !== target ? await getClubContext(target) : context;
  if (role === "admin" ? club.role !== "admin" : !["coach", "manager"].includes(club.role)) throw new Error("Your organization access changed. Reopen the planner.");
  const teams = club.teams.filter(team => team.organizationId === target);
  const docs = await readAccessibleLegacyRoster(club.players.map(player => player.id), id => db.collection("players").doc(id).get());
  const rows = docs.filter(doc => doc.exists && doc.data()?.organizationId === target
    && (club.role !== "coach" || teams.some(team => team.id === doc.data()?.teamId))).map(doc => playerRow(doc.id, doc.data()));
  return finish({ organizations, teams, players: uniquePlayers(rows), organizationId: target,
    limited: club.players.length >= 2000 || club.teams.length >= 100 || organizations.length >= 100 });
}
