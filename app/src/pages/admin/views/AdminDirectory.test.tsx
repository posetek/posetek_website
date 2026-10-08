import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../lib/firebase", () => ({ default: {}, auth: {}, db: {} }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: vi.fn(), clubCall: vi.fn(), invalidateClubContext: vi.fn() }));
import MonitorAccounts, { DirectoryPlayersTable, DirectoryTabs, PlayerReporting } from "./MonitorAccounts";
import type { PlayerRow } from "../lib/accounts";
import type { AdminDirectoryState } from "../lib/adminNavigation";
const state: AdminDirectoryState = { orgId: "club", teamId: "team", directoryTab: "players", search: "Example", page: 1 };
const player: PlayerRow = { id: "athlete", name: "Example Athlete", email: "player@example.test", coachId: null, organizationId: "club", teamId: "team", registered: true, signupCode: null, raw: { organizationId: "club", birthDate: "2011-01-01" } };

describe("admin directory presentation", () => {
  it("renders the workspace and tabs before organizations or unrelated accounts finish loading", () => {
    const html = renderToStaticMarkup(<MemoryRouter><MonitorAccounts /></MemoryRouter>);
    expect(html).toContain("People &amp; organizations"); expect(html).toContain("Loading organizations…");
    for (const label of ["Players", "Staff", "Manage teams", "Organization settings"]) expect(html).toContain(label);
    expect(html).not.toContain("Loading accounts…");
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain("Jump to people");
    expect(html).not.toContain("directory-player-table");
  });
  it("has one selected keyboard tab and associates each tab with its panel", () => {
    const html = renderToStaticMarkup(<DirectoryTabs active="staff" onChange={() => {}} />);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1); expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('id="directory-tab-staff" role="tab" aria-selected="true" aria-controls="directory-panel-staff"');
  });
  it("opens Results from the name and exposes one-action Workouts/Profile without losing directory state", () => {
    const html = renderToStaticMarkup(<MemoryRouter><DirectoryPlayersTable players={[player]} state={state} choose={() => {}} /></MemoryRouter>);
    expect(html).toContain('id="admin-player-athlete"'); expect(html).toContain('aria-label="Workouts for Example Athlete"'); expect(html).toContain('aria-label="Profile for Example Athlete"');
    expect(html).toContain("playerTab=workouts"); expect(html).toContain("playerTab=profile"); expect(html).toContain("search=Example"); expect(html).toContain("page=1"); expect(html).toContain("returnTo=");
    expect(html).not.toContain("playerTab=results"); expect(html).not.toContain("/admin/organizations");
  });
  it("limits visible invitations/profile rows to the current page", () => {
    const players = Array.from({ length: 45 }, (_, index) => ({ ...player, id: `p${index}`, name: `Player ${index}` }));
    const html = renderToStaticMarkup(<MemoryRouter><DirectoryPlayersTable players={players} state={{ ...state, search: "", page: 2 }} choose={() => {}} /></MemoryRouter>);
    expect(html).toContain("Player 20"); expect(html).toContain("Player 39"); expect(html).not.toContain("Player 40"); expect(html).not.toContain("Player 19"); expect(html).toContain("Page 2 of 3");
  });
  it("retains the known unassigned identity count while an attention queue loads", () => {
    const html = renderToStaticMarkup(<MemoryRouter><PlayerReporting state={{ ...state, teamId: undefined, directoryLookup: "unassigned", reportTeamAssignment: "unassigned", reportMode: "attention" }} choose={() => {}} scope={{ kind: "organization", organizationId: "club" }} accountCount={2} scopeLabel="Unassigned / unavailable team · Club" accountRows={[]} enabled showPeople toolbar={null} /></MemoryRouter>);
    expect(html).toContain('class="workspace-scope-accounts"><strong>2</strong> player accounts');
    expect(html).toContain("Unassigned / unavailable team · Club");
  });
});
