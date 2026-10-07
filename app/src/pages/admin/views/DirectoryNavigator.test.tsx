import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DirectoryNavigator, { directoryOrganizationPatch, TeamDirectory } from "./DirectoryNavigator";
import type { AdminDirectoryState } from "../lib/adminNavigation";
import type { OrganizationRow, PlayerRow } from "../lib/accounts";
import type { ClubContext } from "../../../lib/organization-data";
import { jumpToDirectorySection, organizationPeopleScope } from "./MonitorAccounts";

const organization: OrganizationRow = { id: "club", name: "Example Club", schemaVersion: 2, code: "", coachIds: [], logoUrl: null };
const state: AdminDirectoryState = { directoryTab: "players", search: "", page: 1, orgId: "club" };
const context = { role: "admin", organization, organizations: [organization], teams: [
  { id: "a", organizationId: "club", name: "Academy", playerIds: ["stale"], coachUIDs: [] },
  { id: "b", organizationId: "club", name: "Development", playerIds: [], coachUIDs: [] },
  { id: "other", organizationId: "other", name: "Another club", playerIds: [], coachUIDs: [] },
], staff: [
  { userUID: "active", firstName: "Active", lastName: "Coach", email: "active@example.test", role: "coach", status: "active", teamIds: ["a"] },
  { userUID: "inactive", firstName: "Inactive", lastName: "Coach", email: "inactive@example.test", role: "coach", status: "inactive", teamIds: ["a"] },
], players: [], invitations: [] } as unknown as ClubContext;
const player = (id: string, teamId: string | null, organizationId = "club"): PlayerRow => ({ id, name: id, email: "", registered: true, coachId: null, organizationId, teamId, signupCode: null, raw: { organizationId } });
const render = (next = state) => renderToStaticMarkup(<DirectoryNavigator organizations={[organization]} state={next} choose={() => {}} context={context} />);
afterEach(() => vi.unstubAllGlobals());

describe("organization → team → people navigation", () => {
  it("nests only the selected organization's canonical teams without loading another directory", () => {
    const html = render();
    expect(html).toContain('aria-label="Organization hierarchy"'); expect(html).toContain("directory-nav-teams");
    expect(html).toContain("Academy"); expect(html).toContain("Development"); expect(html).not.toContain("Another club");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/directory-nav-org selected" aria-current="page"/);
  });
  it("marks a team as the current people scope without marking its ancestor as current", () => {
    const html = render({ ...state, teamId: "a", directoryLevel: "people" });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/class="selected" aria-current="page"[^>]*><span[^>]*>groups<\/span>Academy/);
    expect(html).not.toMatch(/directory-nav-org selected" aria-current="page"/);
  });
  it("gives All teams and Unassigned mutually exclusive current states", () => {
    const all = render({ ...state, directoryLevel: "people" });
    expect(all).toMatch(/class="selected" aria-current="page"[^>]*>All teams · people/);
    const unassigned = render({ ...state, directoryLevel: "people", directoryLookup: "unassigned" });
    expect(unassigned.match(/aria-current="page"/g)).toHaveLength(1);
    expect(unassigned).toMatch(/class="selected" aria-current="page"[^>]*>Unassigned \/ unavailable team/);
    expect(unassigned).not.toMatch(/class="selected" aria-current="page"[^>]*>All teams · people/);
  });
  it("does not pretend an unavailable team is an All teams selection", () => {
    const html = render({ ...state, teamId: "deleted", directoryLevel: "people" });
    expect(html).toContain("Team unavailable");
    expect(html).not.toMatch(/class="selected" aria-current="page"[^>]*>All teams · people/);
  });
  it("labels staff with the organization instead of a retained Players team", () => {
    const html = render({ ...state, directoryTab: "staff", teamId: "a", directoryLevel: "people" });
    expect(html).toContain("<strong>Example Club</strong>"); expect(html).not.toContain("directory-nav-teams");
  });
  it("counts current account ownership and active coach assignments rather than historical team arrays", () => {
    const html = renderToStaticMarkup(<TeamDirectory organization={organization} context={context} players={[player("current", "a"), player("unassigned", null), player("transferred", "a", "other")]} choose={() => {}} />);
    expect(html).toContain("1 player"); expect(html).toContain("0 players"); expect(html).toContain("Active Coach"); expect(html).not.toContain("Inactive Coach");
    expect(html).not.toContain("Another club"); expect(html).toContain("All teams"); expect(html).toContain("Unassigned / unavailable team");
    expect(html).not.toContain("Rename"); expect(html).not.toContain("Add team");
  });
  it("retains legacy access without inventing a canonical team directory", () => {
    const html = renderToStaticMarkup(<TeamDirectory organization={{ ...organization, schemaVersion: 1 }} context={null} players={[player("legacy", null)]} choose={() => {}} />);
    expect(html).toContain("View legacy roster"); expect(html).toContain("no canonical team directory"); expect(html).not.toContain("directory-team-card");
  });
  it("counts and labels only unassigned/currently unavailable account teams", () => {
    const roster = { context, notices: [], players: [player("assigned", "a"), player("unassigned", null), player("obsolete", "deleted")] };
    const selection = organizationPeopleScope(organization, roster, { ...state, directoryLookup: "unassigned", directoryLevel: "people" });
    expect(selection.players.map(player => player.id)).toEqual(["unassigned", "obsolete"]);
    expect(selection.label).toBe("Unassigned / unavailable team · Example Club");
  });
  it("returns no identity rows for an unavailable team instead of broadening to the organization", () => {
    const selection = organizationPeopleScope(organization, { context, notices: [], players: [player("assigned", "a")] }, { ...state, teamId: "deleted" });
    expect(selection.valid).toBe(false); expect(selection.players).toEqual([]);
  });
  it.each(["staff", "teams", "settings"] as const)("keeps the active %s management view when switching organizations", directoryTab => {
    expect(directoryOrganizationPatch({ ...state, directoryTab, teamId: "a" }, "next")).toMatchObject({ orgId: "next", teamId: undefined, directoryLevel: "teams", directoryTab });
  });
  it("keeps in-page jumps mounted and focuses their section without a hash/history change", () => {
    const preventDefault = vi.fn(), target = { scrollIntoView: vi.fn(), focus: vi.fn() }, getElementById = vi.fn(() => target);
    vi.stubGlobal("document", { getElementById });
    jumpToDirectorySection({ preventDefault }, "workspace-roster");
    expect(preventDefault).toHaveBeenCalledTimes(1); expect(getElementById).toHaveBeenCalledWith("workspace-roster");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" }); expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
