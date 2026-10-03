"use strict";
const { digest, canonical, fail } = require("./issue-tracker-bridge-model");
// Private immutable snapshots. JSON chunks keep large original bodies outside
// queue documents and Excel; metadata is committed only after every chunk.
function createEvidenceArchive(db) {
  return async function archive(source, sourceId, value) {
    const content = JSON.stringify(value), bytes = Buffer.byteLength(content);
    if (!sourceId || bytes > 12000000) fail("tracker_evidence_capacity");
    const hash = digest(JSON.parse(content)), id = digest([source, sourceId, hash]);
    const ref = db.doc(`issueTrackerEvidence/${id}`), old = (await ref.get()).data();
    if (old?.complete === true) {
      if (old.source !== source || old.sourceId !== sourceId || old.sha256 !== hash) fail("tracker_evidence_conflict");
      return { id, sha256: hash, bytes, complete: true };
    }
    const chunks = [];
    // Keep UTF-16 surrogate pairs together. Firestore serializes each chunk as
    // UTF-8; splitting a pair would irreversibly replace both lone halves.
    for (let start = 0; start < content.length;) {
      let end = Math.min(start + 100000, content.length);
      if (end < content.length && content.charCodeAt(end - 1) >= 0xd800 && content.charCodeAt(end - 1) <= 0xdbff && content.charCodeAt(end) >= 0xdc00 && content.charCodeAt(end) <= 0xdfff) end--;
      chunks.push(content.slice(start, end)); start = end;
    }
    for (let i = 0; i < chunks.length; i++) {
      const chunkRef = ref.collection("chunks").doc(String(i).padStart(6, "0"));
      await db.runTransaction(async tx => {
        const existing = (await tx.get(chunkRef)).data();
        const next = { index: i, content: chunks[i] };
        if (existing && canonical(existing) !== canonical(next)) fail("tracker_evidence_conflict");
        if (!existing) tx.create(chunkRef, next);
      });
    }
    await db.runTransaction(async tx => {
      const existing = (await tx.get(ref)).data();
      const next = { source, sourceId, sha256: hash, bytes, chunks: chunks.length, complete: true };
      if (existing && canonical(existing) !== canonical(next)) fail("tracker_evidence_conflict");
      if (!existing) tx.create(ref, next);
    });
    return { id, sha256: hash, bytes, complete: true };
  };
}
module.exports = { createEvidenceArchive };
