import { db } from "../../../lib/firebase";

type OrganizationDocument = { exists: boolean; data(): { schemaVersion?: unknown } | undefined };
export type SummaryOrganization = { kind: "canonical"; organizationId: string } | { kind: "legacy" } | { kind: "unavailable" };
const readOrganization = (organizationId: string): Promise<OrganizationDocument> => db.collection("organizations").doc(organizationId).get();

/** One exact organization document. Never load a global roster or infer schema from a profile field. */
export async function loadPlayerSummaryOrganization(organizationId: string | null, read = readOrganization): Promise<SummaryOrganization> {
  if (!organizationId) return { kind: "unavailable" };
  const document = await read(organizationId);
  if (!document.exists) return { kind: "unavailable" };
  return document.data()?.schemaVersion === 2 ? { kind: "canonical", organizationId } : { kind: "legacy" };
}
