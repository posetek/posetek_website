"use strict";
const M = require("./issue-tracker-bridge-model");
const ROWS = "issueTrackerRows";
const rowDocumentId = (group, key) => `${group}-${M.digest(key)}`;
const plain = value => JSON.parse(M.canonical(value));

/** Machine values are sharded by stable source key. Human columns never enter
 * this store. Global metadata keeps counters/exact join maps; only needed rows
 * are loaded for each batch, plus action snapshots referenced by its mappings.
 */
function createSeedStore(db) {
  async function load(metadata) {
    if (!metadata) M.fail("tracker_missing_seed");
    if (metadata.rows && Object.values(metadata.rows).some(rows => Object.keys(rows || {}).length)) M.fail("tracker_seed_requires_sharding");
    const seed = { ...plain(metadata), rows: Object.fromEntries(M.GROUPS.map(group => [group, {}])) };
    const actions = await db.collection(ROWS).where("group", "==", "actions").get();
    for (const doc of actions.docs) {
      const row = doc.data();
      if (doc.id !== rowDocumentId("actions", row.key) || !row.value) M.fail("tracker_invalid_seed_row");
      seed.rows.actions[row.key] = row.value;
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
  return { load, hydrate };
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
module.exports = { ROWS, rowDocumentId, createSeedStore, splitSeed };
