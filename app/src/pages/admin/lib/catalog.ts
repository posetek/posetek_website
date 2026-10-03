// Drill catalog reads and the three admin write paths — create, edit, media.
// DRILL_CATALOG_V2_CONTRACT.md §1, §6.2, §7 (freshness) and §8 (new ids).
//
// Every write here is a v2 document. A v1 document is readable but never
// written back: agent 02 owns the migration, and a partial rewrite from this
// side would fight it. Every field edit bumps `drillCatalogMeta/current`'s
// patch component **in the same transaction** as the document write, because a
// read followed by a batch loses one of two concurrent edits (01A F22).

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { auth, db, storage, cloud } from "../../../lib/firebase";
import { captureIssue } from "../../../lib/user-issues";
import { normalizeCatalogDrill } from "../../../lib/contracts/drillV2";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import { DOMAIN_CODES, MEDIA_SLOTS } from "../../../lib/contracts/types";
import type { Domain, MediaSlot, Position } from "../../../lib/contracts/types";
import { ADMIN_CLIENT_VERSION } from "./identity";

const CATALOG = "drillCatalog";
const META = "drillCatalogMeta";

// MARK: - Reads

export async function loadCatalog(): Promise<CatalogDrill[]> {
  const snapshot = await db.collection(CATALOG).get();
  return snapshot.docs.map(doc => normalizeCatalogDrill(doc.id, doc.data()));
}

export async function loadDrill(drillId: string): Promise<CatalogDrill | null> {
  const doc = await db.collection(CATALOG).doc(drillId).get();
  return doc.exists ? normalizeCatalogDrill(doc.id, doc.data()) : null;
}

export async function loadCatalogVersion(): Promise<string> {
  const doc = await db.collection(META).doc("current").get();
  return String(doc.data()?.catalogVersion ?? "1.0.0");
}

// MARK: - Version bump (§7)

/** `1.0.4` → `1.0.5`. A malformed or missing version restarts at `1.0.1`, never at `1.0.0`. */
export function bumpPatch(version: unknown): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? "").trim());
  if (!match) return "1.0.1";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

// MARK: - Writing a drill

export interface DrillWrite {
  name: string;
  domain: Domain;
  minAge: number;
  maxAge: number;
  difficultyLevel: number;
  equipment: string[];
  requiresPartner: boolean;
  /** null = any position. Always written, so a merging update can clear it. */
  positionSpecific: Position | null;
  howTo: { setup: string; steps: string[] };
  dose: Record<string, unknown>;
  maxFrequencyPerWeek: number;
  coachComments: string[];
  adaptiveLevers: string[];
  status: "draft" | "published" | "archived";
}

function requireAdminUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("You are signed out. Sign in again to save.");
  return uid;
}

/** Every rule-checked field, in one place, so create and update cannot drift apart. */
function drillPayload(drillId: string, write: DrillWrite, catalogVersion: string, uid: string) {
  return {
    schemaVersion: 2,
    drillId,
    name: write.name,
    domain: write.domain,
    minAge: write.minAge,
    maxAge: write.maxAge,
    difficultyLevel: write.difficultyLevel,
    equipment: write.equipment,
    requiresPartner: write.requiresPartner,
    // Explicit null, never omitted: `update` merges, so only a written null
    // takes a drill back to "any position".
    positionSpecific: write.positionSpecific ?? null,
    howTo: { setup: write.howTo.setup, steps: write.howTo.steps },
    dose: write.dose,
    maxFrequencyPerWeek: write.maxFrequencyPerWeek,
    coachComments: write.coachComments,
    adaptiveLevers: write.adaptiveLevers,
    status: write.status,
    catalogVersion,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: uid,
    howToSource: "admin",
    coachCommentsSource: "admin",
  };
}

function metaPatch(catalogVersion: string, uid: string, drillId: string, kind: string) {
  return {
    catalogVersion,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: uid,
    lastChange: { drillId, kind },
  };
}

/**
 * Allocate an id and create the drill in ONE transaction (§8): read the
 * per-domain counter, take the first candidate above it whose document does not
 * exist, then write the counter, the bumped catalog version and the drill
 * together. An unconditional set on an allocated id could replace an existing
 * workbook drill, which is why non-existence is checked inside the transaction.
 */
export async function createDrill(write: DrillWrite): Promise<string> {
  const uid = requireAdminUid();
  const code = DOMAIN_CODES[write.domain];
  if (!code) throw new Error(`No id prefix for domain “${write.domain}”.`);

  return db.runTransaction(async transaction => {
    const countersRef = db.collection(META).doc("idCounters");
    const currentRef = db.collection(META).doc("current");
    const [countersDoc, currentDoc] = await Promise.all([
      transaction.get(countersRef),
      transaction.get(currentRef),
    ]);

    const counters = (countersDoc.data() || {}) as Record<string, unknown>;
    const stored = Number(counters[code]);
    let counter = Number.isFinite(stored) && stored >= 500 ? Math.round(stored) : 500;

    let drillId = "";
    for (let attempt = 0; attempt < 25 && !drillId; attempt += 1) {
      counter += 1;
      const candidate = `${code}-${String(counter).padStart(3, "0")}`;
      const existing = await transaction.get(db.collection(CATALOG).doc(candidate));
      if (!existing.exists) drillId = candidate;
    }
    if (!drillId) throw new Error(`Could not find a free ${code} id — the counter may need attention.`);

    const catalogVersion = bumpPatch(currentDoc.data()?.catalogVersion);
    transaction.set(db.collection(CATALOG).doc(drillId), {
      ...drillPayload(drillId, write, catalogVersion, uid),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(countersRef, { [code]: counter }, { merge: true });
    transaction.set(currentRef, metaPatch(catalogVersion, uid, drillId, "created"), { merge: true });
    return drillId;
  });
}

/**
 * Edit an existing **v2** drill. Refuses a v1 document: the migration is agent
 * 02's, and writing a v2 shape over half of one from here would make the
 * migration's "fill unresolved fields only" rerun ambiguous.
 */
export async function updateDrill(drillId: string, write: DrillWrite, expectedCatalogVersion?: string): Promise<string> {
  const uid = requireAdminUid();
  const current = await db.collection(CATALOG).doc(drillId).get();
  if (current.data()?.productionBatchId) {
    if (!expectedCatalogVersion) throw new Error("Reload this drill before editing its reviewed content.");
    const result = (await cloud.httpsCallable("trainingSaveDrill")({ drillId, write, expectedCatalogVersion })).data;
    return String(result.catalogVersion);
  }
  return db.runTransaction(async transaction => {
    const drillRef = db.collection(CATALOG).doc(drillId);
    const currentRef = db.collection(META).doc("current");
    const [drillDoc, currentDoc] = await Promise.all([
      transaction.get(drillRef),
      transaction.get(currentRef),
    ]);
    if (!drillDoc.exists) throw new Error(`${drillId} no longer exists.`);
    if (Number(drillDoc.data()?.schemaVersion) !== 2) {
      throw new Error(
        `${drillId} has not been migrated to catalog v2 yet. Editing becomes available once the migration has run.`,
      );
    }
    const catalogVersion = bumpPatch(currentDoc.data()?.catalogVersion);
    const kind = write.status === "archived" && drillDoc.data()?.status !== "archived" ? "archived" : "edited";
    transaction.update(drillRef, drillPayload(drillId, write, catalogVersion, uid) as any);
    transaction.set(currentRef, metaPatch(catalogVersion, uid, drillId, kind), { merge: true });
    return catalogVersion;
  });
}

// MARK: - Media (§6.2)

/** New uploads always take the `app` version segment; historical `3.4` objects stay readable. */
export const MEDIA_PREFIX = "drillCatalogMedia/app";
/** The rules' hard cap. The contract's own guidance is ≤ 250 MB, ≤ 90 s, ≤ 1080p. */
export const MAX_MEDIA_BYTES = 300 * 1024 * 1024;
export const RECOMMENDED_MAX_MEDIA_BYTES = 250 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function mediaFileErrors(slot: MediaSlot, file: File): string[] {
  const errors: string[] = [];
  const extension = EXTENSIONS[file.type];
  if (!extension) {
    errors.push("Upload an MP4 or MOV video, or a JPEG/PNG still for the bird's-eye slot.");
  } else if (extension === "jpg" || extension === "png") {
    if (slot !== "birdsEye") errors.push("Only the bird's-eye slot accepts a still image.");
  }
  if (file.size > MAX_MEDIA_BYTES) errors.push("That file is over the 300 MB upload limit.");
  return errors;
}

export function mediaStoragePath(drillId: string, slot: MediaSlot, file: File, uploadId?: string): string {
  return `${MEDIA_PREFIX}/${drillId}/${slot}${uploadId ? `.${uploadId}` : ""}.${EXTENSIONS[file.type] ?? "mp4"}`;
}

export interface MediaUploadHandle {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * Upload one slot, then stamp the document. `mediaPublishedAt` is exactly what
 * the app's `DrillCatalogStore` freshness probe watches, so every other device
 * refetches on its next refresh with no code change. A media-only change does
 * NOT bump `catalogVersion` (§7).
 */
export function uploadDrillMedia(
  drillId: string,
  slot: MediaSlot,
  file: File,
  onProgress: (fraction: number) => void,
  managed = false,
): MediaUploadHandle {
  const uid = requireAdminUid();
  const path = mediaStoragePath(drillId, slot, file, managed ? crypto.randomUUID() : undefined);
  const task = storage.ref(path).put(file, { contentType: file.type });

  const promise = new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot: any) => onProgress(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0),
      (error: any) => { if (error.code !== "storage/canceled") captureIssue(error, "catalog_media_upload", { ownerUid: uid }); reject(error); },
      () => resolve(),
    );
  }).then(async () => {
    const metadata: any = await task.snapshot.ref.getMetadata();
    const current = await db.collection(CATALOG).doc(drillId).get();
    await db.collection(CATALOG).doc(drillId).update({
      [`media.${slot}`]: {
        storagePath: path,
        contentType: file.type,
        bytes: file.size,
        generation: String(metadata?.generation ?? ""),
        status: current.data()?.productionBatchId ? "pending" : "approved",
        uploadedBy: uid,
        uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      mediaPublishedAt: firebase.firestore.FieldValue.serverTimestamp(),
      mediaSchemaVersion: 1,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    });
  });

  return { promise, cancel: () => task.cancel() };
}

/** Remove an `app`-prefix slot. Portal (`3.4`) objects are never client-deletable. */
export async function removeDrillMedia(drillId: string, slot: MediaSlot, storagePath: string): Promise<void> {
  const uid = requireAdminUid();
  if (storagePath.startsWith(`${MEDIA_PREFIX}/`)) {
    try {
      await storage.ref(storagePath).delete();
    } catch (error) {
      console.warn("[admin] media object delete failed; clearing the slot anyway", error);
    }
  }
  await db.collection(CATALOG).doc(drillId).update({
    [`media.${slot}`]: firebase.firestore.FieldValue.delete(),
    mediaPublishedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * `storagePath` is the only durable address — resolve it at render time and
 * never persist the result: a download URL expires, a path does not.
 * A slot whose `status` is present and not `approved` is not playable.
 */
export async function mediaPlaybackUrl(asset: any): Promise<string | null> {
  const path = String(asset?.storagePath ?? "");
  if (!path) return null;
  const status = asset?.status;
  if (status !== undefined && status !== null && status !== "approved") return null;
  try {
    return await storage.ref(path).getDownloadURL();
  } catch (error) {
    console.warn("[admin] media unavailable", path, error);
    return null;
  }
}

export function presentSlots(media: any): MediaSlot[] {
  return MEDIA_SLOTS.filter(slot => Boolean(media?.[slot]?.storagePath));
}

export const CATALOG_CLIENT_VERSION = ADMIN_CLIENT_VERSION;
