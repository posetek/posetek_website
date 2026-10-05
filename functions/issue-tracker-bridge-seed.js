"use strict";
const M = require("./issue-tracker-bridge-model");
const ROWS = "issueTrackerRows";
const INDEX_BASES = "issueTrackerIndexBases", INDICES = "issueTrackerIndices";
const INDEX_GROUPS = Object.freeze(["actionMappings", "emailAliases", "emailCanonicalItems", "emailCanonicalAliases", "emailLinks", "providerOccurrences", "outboxOccurrences"]);
const PAGE_SIZE = 500, SHA256 = /^[a-f0-9]{64}$/;
const rowDocumentId = (group, key) => `${group}-${M.digest(key)}`;
const plain = value => JSON.parse(M.canonical(value));
const mapsOf = seed => Object.fromEntries(INDEX_GROUPS.map(group => [group, plain(seed?.[group] || {})]));
const indexDocumentId = (baseSha256, group, key) => `${baseSha256}-${group}-${M.digest(key)}`;
const indexHash = row => M.digest({ baseSha256: row.baseSha256, group: row.group, key: row.key, deleted: row.deleted, ...(row.deleted ? {} : { value: row.value }) });
const validMap = value => value && typeof value === "object" && !Array.isArray(value);

function verifyIndex(row, id = row?.id) {
  if (!row || !SHA256.test(row.baseSha256 || "") || !INDEX_GROUPS.includes(row.group) || typeof row.key !== "string" || !row.key || row.key.length > 1024 || /[\u0000-\u001f]/.test(row.key) || typeof row.deleted !== "boolean" ||
      !row.deleted && row.value === undefined || row.deleted && Object.hasOwn(row, "value") || id !== indexDocumentId(row.baseSha256, row.group, row.key) || row.sha256 !== indexHash(row)) M.fail("tracker_invalid_seed_index");
  return row;
}

/** Only the existing v1 map snapshot is archived once. Later metadata changes
 * are bounded per-key shards, never another copy of the complete growing map.
 * The public normalizer and native workbook payload keep their v1 contracts.
 */
function partitionSeed(nextSeed, previousSeed) {
  const { metadata, changedRows } = splitSeed(nextSeed, previousSeed), previousMaps = mapsOf(previousSeed), nextMaps = mapsOf(nextSeed);
  const indexBase = previousSeed.storageVersion === 2 ? null : { schemaVersion: 1, maps: previousMaps };
  const baseSha256 = indexBase ? M.digest(indexBase) : previousSeed.indexBaseSha256;
  if (!SHA256.test(baseSha256 || "")) M.fail("tracker_invalid_seed_index_base");
  const changedIndices = [];
  for (const group of INDEX_GROUPS) for (const key of [...new Set([...Object.keys(previousMaps[group]), ...Object.keys(nextMaps[group])])].sort()) {
    const present = Object.hasOwn(nextMaps[group], key), before = Object.hasOwn(previousMaps[group], key);
    if (present === before && (!present || M.canonical(previousMaps[group][key]) === M.canonical(nextMaps[group][key]))) continue;
    const row = { baseSha256, group, key, deleted: !present, ...(present ? { value: nextMaps[group][key] } : {}) };
    changedIndices.push({ id: indexDocumentId(baseSha256, group, key), ...row, sha256: indexHash(row) });
  }
  for (const group of INDEX_GROUPS) delete metadata[group];
  Object.assign(metadata, { storageVersion: 2, indexBaseSha256: baseSha256, indexStateSha256: M.digest(nextMaps), indexEntryCounts: Object.fromEntries(INDEX_GROUPS.map(group => [group, Object.keys(nextMaps[group]).length])) });
  return { metadata, changedRows, changedIndices, indexBase };
}

/** Machine values are sharded by stable source key. Human columns never enter
 * this store. Global metadata keeps counters/exact join maps; only needed rows
 * are loaded for each batch, plus action snapshots referenced by its mappings.
 */
function createSeedStore(db) {
  async function loadMetadata(metadata) {
    if (!metadata) M.fail("tracker_missing_seed");
    if (metadata.storageVersion == null || metadata.storageVersion === 1) return plain(metadata);
    if (metadata.storageVersion !== 2 || !SHA256.test(metadata.indexBaseSha256 || "") || !SHA256.test(metadata.indexStateSha256 || "") || INDEX_GROUPS.some(group => Object.hasOwn(metadata, group))) M.fail("tracker_invalid_seed_index_metadata");
    const base = (await db.doc(`${INDEX_BASES}/${metadata.indexBaseSha256}`).get()).data();
    if (!base || base.schemaVersion !== 1 || M.digest(base) !== metadata.indexBaseSha256 || Object.keys(base.maps || {}).sort().join() !== [...INDEX_GROUPS].sort().join() || INDEX_GROUPS.some(group => !validMap(base.maps[group]))) M.fail("tracker_invalid_seed_index_base");
    const maps = plain(base.maps), visited = new Set(); let cursor;
    for (;;) {
      let query = db.collection(INDICES).where("baseSha256", "==", metadata.indexBaseSha256).orderBy("__name__").limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        if (visited.has(doc.id)) M.fail("tracker_seed_index_pagination");
        visited.add(doc.id); const row = verifyIndex(doc.data(), doc.id);
        if (row.baseSha256 !== metadata.indexBaseSha256) M.fail("tracker_invalid_seed_index");
        if (row.deleted) delete maps[row.group][row.key];
        else Object.defineProperty(maps[row.group], row.key, { value: row.value, enumerable: true, writable: true, configurable: true });
      }
      if (page.size < PAGE_SIZE) break;
      cursor = page.docs.at(-1).id;
    }
    if (M.digest(maps) !== metadata.indexStateSha256 || INDEX_GROUPS.some(group => !Number.isSafeInteger(metadata.indexEntryCounts?.[group]) || metadata.indexEntryCounts[group] !== Object.keys(maps[group]).length)) M.fail("tracker_seed_index_snapshot_changed");
    return { ...plain(metadata), ...maps };
  }
  async function load(metadata) {
    if (!metadata) M.fail("tracker_missing_seed");
    if (metadata.rows && Object.values(metadata.rows).some(rows => Object.keys(rows || {}).length)) M.fail("tracker_seed_requires_sharding");
    const seed = { ...await loadMetadata(metadata), rows: Object.fromEntries(M.GROUPS.map(group => [group, {}])) };
    let cursor;
    for (;;) {
      let query = db.collection(ROWS).where("group", "==", "actions").orderBy("__name__").limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const actions = await query.get();
      for (const doc of actions.docs) {
        const row = doc.data();
        if (doc.id !== rowDocumentId("actions", row.key) || !row.value || Object.hasOwn(seed.rows.actions, row.key)) M.fail("tracker_invalid_seed_row");
        seed.rows.actions[row.key] = row.value;
      }
      if (actions.size < PAGE_SIZE) break;
      cursor = actions.docs.at(-1).id;
    }
    return seed;
  }
  async function hydrate(seed, group, key) {
    if (!M.GROUPS.includes(group) || typeof key !== "string" || !key) M.fail("tracker_invalid_seed_key");
    if (Object.hasOwn(seed.rows[group], key)) return;
    const doc = await db.doc(`${ROWS}/${rowDocumentId(group, key)}`).get();
    if (!doc.exists) return;
    const row = doc.data();
    if (row.group !== group || row.key !== key || !row.value) M.fail("tracker_invalid_seed_row");
    // defineProperty handles arbitrary Outlook IDs without prototype mutation.
    Object.defineProperty(seed.rows[group], key, { value: row.value, enumerable: true, writable: true, configurable: true });
  }
  return { load, loadMetadata, hydrate };
}

function splitSeed(nextSeed, previousSeed = { rows: {} }) {
  const metadata = plain(nextSeed); delete metadata.rows;
  const changedRows = [];
  for (const group of M.GROUPS) for (const [key, value] of Object.entries(nextSeed.rows?.[group] || {})) {
    const prior = previousSeed.rows?.[group]?.[key];
    if (prior && M.canonical(prior) === M.canonical(value)) continue;
    changedRows.push({ id: rowDocumentId(group, key), group, key, value: plain(value) });
  }
  return { metadata, changedRows };
}
module.exports = { ROWS, INDEX_BASES, INDICES, INDEX_GROUPS, indexDocumentId, verifyIndex, rowDocumentId, createSeedStore, splitSeed, partitionSeed };
