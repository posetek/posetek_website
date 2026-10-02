import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const failures = new Set<string>();
  const writes = vi.fn((path: string, patch: any) => { documents.set(path, { ...documents.get(path), ...patch }); });
  const serverTimestamp = vi.fn(() => new Date());
  function ref(path: string): any {
    return { id: path.split("/").at(-1), path, get: async () => {
      if (failures.has(path)) throw new Error("Read failed");
      return { id: path.split("/").at(-1), exists: documents.has(path), data: () => documents.get(path), ref: ref(path) };
    }, update: async (patch: any) => writes(path, patch) };
  }
  const comparable = (value: any) => value?.path || value;
  function collection(path: string, filters: any[] = [], limit = Infinity): any {
    return { doc: (id: string) => ref(`${path}/${id}`), where: (...filter: any[]) => collection(path, [...filters, filter], limit), limit: (value: number) => collection(path, filters, value), get: async () => {
      if (failures.has(path)) throw new Error("Read failed");
      const keys = [...documents.keys()].filter(key => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/")
        && filters.every(([field, operator, value]) => operator === "array-contains" ? documents.get(key)?.[field]?.includes(value) : comparable(documents.get(key)?.[field]) === comparable(value))).slice(0, limit);
      const docs = await Promise.all(keys.map(key => ref(key).get()));
      return { docs, size: docs.length, empty: !docs.length };
    } };
  }
  return { documents, failures, writes, serverTimestamp, db: { collection }, context: vi.fn() };
});
vi.mock("../../../lib/firebase", () => ({ default: { firestore: { FieldValue: { serverTimestamp: fake.serverTimestamp } } }, auth: {}, db: fake.db }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: fake.context }));
import { loadClubAccountData, loadCoachAccount, loadCoachOfPlayer, loadCoachRoster, loadCoaches, loadTeamPlayers, playerRow, resolvePlayerAge, savePlayerProfile } from "./accounts";

const team = { id: "team", organizationId: "club", name: "Team", coachUIDs: [], playerIds: ["wrong"] };
function seedContext() {
  const context = { role: "admin", organization: { id: "club", name: "Club", schemaVersion: 2 }, organizations: [], teams: [team], staff: [{ userUID: "assigned", firstName: "Assigned", lastName: "Coach", email: "coach@example.test", role: "coach", status: "active", teamIds: ["team"] }], players: [], invitations: [] };
  fake.context.mockResolvedValue(context);
  fake.documents.set("organizations/club", { schemaVersion: 2 });
  return context;
}
beforeEach(() => { fake.documents.clear(); fake.failures.clear(); fake.context.mockReset(); fake.writes.mockClear(); fake.serverTimestamp.mockClear(); });

describe('admin age read alignment', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it('keeps a stale, undated or future age visible as an observation without passing it to the editor', () => {
    for (const ageRecordedAt of [undefined, new Date('2025-01-01'), new Date('2026-10-02')]) {
      const raw = { age: 15, ageRecordedAt }, resolved = resolvePlayerAge(raw, now);
      expect(resolved).toMatchObject({ age: null, recordedAge: 15, source: 'playerDocAge', stale: true });
      expect(raw).toEqual({ age: 15, ageRecordedAt });
    }
  });
  it('uses strict DOB or a current observation and retains legacy DOB fallback', () => {
    expect(resolvePlayerAge({ birthDate: '2011-02-31' }, now).age).toBeNull();
    expect(resolvePlayerAge({ birthDate: '2011-02-31', dateOfBirth: '2010-10-01' }, now)).toMatchObject({ age: 16, source: 'legacyDateOfBirth', stale: false });
    expect(resolvePlayerAge({ age: 15, ageRecordedAt: now }, now)).toMatchObject({ age: 15, stale: false });
  });
  it('explicitly reconfirms the same stored age with server timestamps, while unrelated saves do not refresh it', async () => {
    const oldDate = new Date('2025-01-01'); fake.documents.set('players/player', { age: 15, ageRecordedAt: oldDate, position: 'GK' });
    await savePlayerProfile('player', { position: 'CM' });
    expect(fake.documents.get('players/player').ageRecordedAt).toBe(oldDate);
    expect(fake.writes.mock.calls[0][1]).not.toHaveProperty('age');
    expect(fake.writes.mock.calls[0][1]).not.toHaveProperty('ageRecordedAt');
    fake.serverTimestamp.mockClear(); await savePlayerProfile('player', { age: 15 });
    expect(fake.serverTimestamp).toHaveBeenCalledTimes(2);
    expect(Object.keys(fake.writes.mock.calls[1][1]).sort()).toEqual(['age', 'ageRecordedAt', 'updatedAt']);
    expect(resolvePlayerAge(fake.documents.get('players/player'))).toMatchObject({ age: 15, stale: false, observationStatus: 'current' });
    expect(fake.documents.get('players/player')).not.toHaveProperty('birthDate');
  });
});

describe("admin roster reads", () => {
  it("does not retain invitation secrets in the roster or raw planner inputs", () => {
    const source = { firstName: "Example", signupCode: "SAMPLE-123", code: "LEGACY-123", organizationId: "club", teamId: "team", maxDrillDifficulty: 3 };
    const row = playerRow("player", source);
    expect(row.signupCode).toBeNull(); expect(row.raw).not.toHaveProperty("signupCode"); expect(row.raw).not.toHaveProperty("code");
    expect(row.raw.maxDrillDifficulty).toBe(3); expect(row.organizationId).toBe("club");
    expect(source.signupCode).toBe("SAMPLE-123");
  });
  it("loads canonical players beyond the global 500-player index, ignoring stale projected IDs", async () => {
    for (let i = 0; i < 501; i++) fake.documents.set(`players/p${i}`, { organizationId: "club", teamId: "team", firstName: `Athlete ${i}` });
    fake.documents.set("players/wrong", { organizationId: "other", teamId: "team" });
    const rows = await loadTeamPlayers(team, []);
    expect(rows).toHaveLength(501);
    expect(rows.some(row => row.id === "wrong")).toBe(false);
  });
  it("reports failed reads rather than treating failures as an empty roster", async () => {
    fake.failures.add("players");
    await expect(loadTeamPlayers(team)).rejects.toThrow("Read failed");
  });
  it("retains legacy reference-only players but excludes migrated players from stale legacy coach mirrors", async () => {
    fake.documents.set("coaches/legacy", { userUID: "legacy", members: ["migrated"] });
    fake.documents.set("players/migrated", { organizationId: "club", teamId: "team", coachUID: "legacy" });
    fake.documents.set("players/old", { coach: { path: "coaches/legacy", id: "legacy" }, firstName: "Old" });
    const [coach] = await loadCoaches();
    expect((await loadCoachRoster(coach)).map(row => row.id)).toEqual(["old"]);
  });
  it("reads canonical organizationId and keeps difficulty-source resolution unchanged", async () => {
    fake.documents.set("coaches/original", { userUID: "original", organizationId: "club", organization: { id: "old" }, maxDrillDifficulty: 3 });
    const player = playerRow("p", { organizationId: "club", teamId: "new-team", coachUID: "original" });
    const coach = await loadCoachOfPlayer(player);
    expect(coach?.id).toBe("original");
    expect(coach?.maxDrillDifficulty).toBe(3);
    expect(coach?.organizationId).toBe("club");
  });
  it("does not restore a legacy organization when the canonical field is malformed", () => {
    expect(playerRow("p", { organizationId: null, organization: { id: "legacy" } }).organizationId).toBeNull();
  });
  it("can display assigned canonical staff without a coach mirror, without offering a rating write", async () => {
    seedContext();
    fake.documents.set("players/p", { organizationId: "club", teamId: "team", firstName: "Player" });
    const account = await loadCoachAccount("assigned", "club");
    expect(account.roster.map(row => row.id)).toEqual(["p"]);
    expect(account.ratingEditable).toBe(false);
    expect(account.coach.name).toBe("Assigned Coach");
  });
  it("reports an absent membership instead of falling back to legacy roster permissions", async () => {
    seedContext();
    fake.documents.set("coaches/former", { userUID: "former", organizationId: "club", members: ["p"] });
    await expect(loadCoachAccount("former", "club")).rejects.toThrow("no staff membership");
  });
  it("does not display a roster for malformed active manager membership", async () => {
    const context = seedContext();
    fake.context.mockResolvedValue({ ...context, staff: [{ ...context.staff[0], role: "manager", teamIds: null }] });
    fake.documents.set("players/p", { organizationId: "club", teamId: "team" });
    const account = await loadCoachAccount("assigned", "club");
    expect(account.coach.organizationStatus).toBe("invalid");
    expect(account.roster).toEqual([]);
    expect(account.teams).toEqual([]);
    expect(account.ratingEditable).toBe(false);
  });
  it("reports organization roster truncation and requires admin context", async () => {
    const context = seedContext();
    for (let i = 0; i < 2001; i++) fake.documents.set(`players/p${i}`, { organizationId: "club", teamId: "team" });
    expect((await loadClubAccountData("club")).hierarchy.limits.join(" ")).toContain("2,000");
    fake.context.mockResolvedValue({ ...context, role: "coach" });
    await expect(loadClubAccountData("club")).rejects.toThrow("admin access");
  });
});
