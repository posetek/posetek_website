"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FIELD, REQUIRED, plan } = require("./projection-dirty-index-plan.cjs");
const existing = ["ASCENDING", "DESCENDING", "CONTAINS"].map(value => ({ name: `${FIELD}/indexes/${value}`, state: "READY", queryScope: "COLLECTION", fields: [{ fieldPath: "pending", ...(value === "CONTAINS" ? { arrayConfig: value } : { order: value }) }] }));
test("adds only the missing group index and preserves all current field configurations", () => {
  const field = { name: FIELD, indexConfig: { indexes: existing, usesAncestorConfig: true }, ttlConfig: { state: "ACTIVE" } };
  const before = JSON.stringify(field), result = plan(field);
  assert.equal(JSON.stringify(field), before);
  assert.equal(result.needsPatch, true); assert.equal(result.ready, false);
  assert.equal(result.updateMask, "indexConfig"); assert.equal(result.body.indexConfig.indexes.length, 4);
  assert.deepEqual(result.body.indexConfig.indexes.slice(0, 3), existing.map(({ name, state, ...rest }) => rest));
  assert.deepEqual(result.body.indexConfig.indexes[3], REQUIRED);
  assert.equal("ttlConfig" in result.body, false);
});
test("a pending group index is retained rather than re-created, and readiness is explicit", () => {
  const pending = { ...REQUIRED, name: "server-index", state: "CREATING" };
  assert.equal(plan({ name: FIELD, indexConfig: { indexes: [...existing, pending] } }).needsPatch, false);
  assert.equal(plan({ name: FIELD, indexConfig: { indexes: [...existing, pending] } }).ready, false);
  assert.equal(plan({ name: FIELD, indexConfig: { indexes: [...existing, { ...pending, state: "READY" }] } }).ready, true);
});
test("refuses absent, unrelated or ambiguous live field evidence", () => {
  assert.throws(() => plan({ name: FIELD }), /current_field_required/);
  assert.throws(() => plan({ name: FIELD.replace("pending", "other"), indexConfig: { indexes: existing } }), /current_field_required/);
  assert.throws(() => plan({ name: FIELD, indexConfig: { indexes: [REQUIRED, REQUIRED] } }), /ambiguous_configuration/);
});
test("checked-in override retains collection defaults and the exact sweeper group index", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../firestore.indexes.json"), "utf8"));
  const target = config.fieldOverrides.filter(row => row.collectionGroup === "projectionDirty" && row.fieldPath === "pending");
  assert.equal(target.length, 1); assert.equal(target[0].indexes.length, 4);
  assert.deepEqual(target[0].indexes.filter(row => row.queryScope === "COLLECTION"), [
    { order: "ASCENDING", queryScope: "COLLECTION" }, { order: "DESCENDING", queryScope: "COLLECTION" }, { arrayConfig: "CONTAINS", queryScope: "COLLECTION" },
  ]);
  assert.deepEqual(target[0].indexes.find(row => row.queryScope === "COLLECTION_GROUP"), { order: "ASCENDING", queryScope: "COLLECTION_GROUP" });
});
