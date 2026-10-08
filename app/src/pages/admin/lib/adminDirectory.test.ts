import { beforeEach, describe, expect, it, vi } from "vitest";
const reads = vi.hoisted(() => ({ club: vi.fn(), coaches: vi.fn(), coachRoster: vi.fn(), context: vi.fn(), organizations: vi.fn(), lookup: vi.fn(), legacy: vi.fn() }));
vi.mock("./accounts", () => ({ loadClubAccountData: reads.club, loadCoaches: reads.coaches, loadCoachRoster: reads.coachRoster, loadOrganizations: reads.organizations, loadPlayerIndex: reads.lookup, loadTeams: vi.fn() }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: reads.context }));
vi.mock("./plannerScope", () => ({ legacyOrganizationPlayers: reads.legacy }));
import { directoryCoachPath, directoryPage, directoryPlayers, directorySource, loadDirectoryContext, loadDirectoryRoster, unassignedDirectoryPlayers } from "./adminDirectory";
import type { OrganizationRow, PlayerRow } from "./accounts";

const club: OrganizationRow = { id: "club", name: "Club", schemaVersion: 2, logoUrl: null, coachIds: [], code: "" };
const player = (id: string, teamId = "team", raw: Record<string, unknown> = { organizationId: "club" }): PlayerRow => ({ id, name: id, email: `${id}@example.test`, teamId, organizationId: "club", coachId: null, registered: true, signupCode: null, raw });
beforeEach(() => { Object.values(reads).forEach(mock => mock.mockReset()); });

describe("admin directory reads", () => {
  it("opens canonical organization players beyond the bounded index without fetching global coaches or lookup", async () => {
    const players = Array.from({ length: 610 }, (_, index) => player(`athlete-${index}`));
    reads.club.mockResolvedValue({ context: { role: "admin" }, hierarchy: { players, limits: [] } });
    expect((await loadDirectoryRoster(club)).players).toHaveLength(610);
    expect(reads.club).toHaveBeenCalledWith("club");
    expect(reads.coaches).not.toHaveBeenCalled(); expect(reads.lookup).not.toHaveBeenCalled();
  });
  it("opening organization choices does not eagerly fetch player or staff collections", async () => {
    reads.organizations.mockResolvedValue([club]);
    await directorySource.organizations();
    expect(reads.coaches).not.toHaveBeenCalled(); expect(reads.lookup).not.toHaveBeenCalled(); expect(reads.club).not.toHaveBeenCalled();
  });
  it("management reads canonical context without the extra full-profile roster query", async () => {
    reads.context.mockResolvedValue({ role: "admin", organization: { id: "club" } });
    await loadDirectoryContext("club");
    expect(reads.context).toHaveBeenCalledWith("club"); expect(reads.club).not.toHaveBeenCalled(); expect(reads.lookup).not.toHaveBeenCalled();
  });
  it("rejects changed roles and organizations rather than retaining another scope", async () => {
    for (const context of [{ role: "manager", organization: { id: "club" } }, { role: "admin", organization: { id: "other" } }]) {
      reads.context.mockResolvedValue(context); await expect(loadDirectoryContext("club")).rejects.toThrow("admin access");
    }
  });
  it("reuses the bounded legacy organization reader while excluding migrated canonical ownership", async () => {
    const org = { ...club, schemaVersion: 1, coachIds: ["one", "two"] };
    reads.legacy.mockResolvedValue({ players: [player("old", "", {}), player("migrated"), player("second", "", {})], limited: true });
    const result = await loadDirectoryRoster(org);
    expect(result.players.map(row => row.id)).toEqual(["old", "second"]);
    expect(reads.legacy).toHaveBeenCalledWith(org, [org]); expect(result.notices.join(" ")).toContain("2,000"); expect(reads.club).not.toHaveBeenCalled(); expect(reads.lookup).not.toHaveBeenCalled();
  });
  it("reports failed roster reads rather than showing an invented empty roster", async () => {
    reads.club.mockRejectedValue(new Error("Permission denied")); await expect(loadDirectoryRoster(club)).rejects.toThrow("Permission denied");
  });
});

describe("directory filtering and bounded rendering", () => {
  it("selects a team and performs case-insensitive name/email search without changing source membership", () => {
    const rows = [player("Alice", "one"), player("Bob", "two")];
    expect(directoryPlayers(rows, "EXAMPLE", "one").map(row => row.id)).toEqual(["Alice"]);
    expect(directoryPlayers(rows, " bob ").map(row => row.id)).toEqual(["Bob"]);
    expect(rows).toHaveLength(2);
  });
  it("paginates twenty visible profiles and safely bounds stale page numbers after transfers", () => {
    const rows = Array.from({ length: 43 }, (_, index) => player(`player-${index}`));
    expect(directoryPage(rows, 1).rows).toHaveLength(20);
    expect(directoryPage(rows, 2).rows[0].id).toBe("player-20");
    expect(directoryPage(rows, 200)).toMatchObject({ page: 3, totalPages: 3 });
    expect(directoryPage([], -3)).toEqual({ page: 1, totalPages: 1, rows: [] });
  });
  it("recognizes unknown or cross-organization team assignments without treating stale projections as membership", () => {
    const rows = [player("assigned", "team"), player("missing", "gone"), player("wrong-team", "other-team"), player("blank", "")];
    const teams = [{ id: "team", organizationId: "club", name: "Team", playerIds: [], coachUIDs: [] }, { id: "other-team", organizationId: "other", name: "Other", playerIds: [], coachUIDs: [] }];
    expect(unassignedDirectoryPlayers(rows, [club], [], teams).map(row => row.id)).toEqual(["missing", "wrong-team", "blank"]);
  });
  it("keeps Staff selection and lookup state when opening coach details", () => {
    const path = directoryCoachPath("coach", { orgId: "club", directoryTab: "staff", search: "Smith", page: 3 });
    expect(path).toContain("directoryTab=staff"); expect(path).toContain("search=Smith"); expect(path).toContain("page=3"); expect(path).toContain("returnTo=%2Fadmin%2Faccounts");
  });
});
