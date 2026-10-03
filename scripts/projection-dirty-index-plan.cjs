"use strict";

// Pure deployment planner. The operator reads this exact field immediately
// before applying its additive PATCH; this module does not contact Google.
const FIELD = "projects/kickai-69dd0/databases/(default)/collectionGroups/projectionDirty/fields/pending";
const REQUIRED = Object.freeze({ queryScope: "COLLECTION_GROUP", fields: [{ fieldPath: "pending", order: "ASCENDING" }] });
function writableIndex(index) {
  const { name, state, ...configuration } = index;
  return structuredClone(configuration);
}
function matches(index) {
  return index?.queryScope === REQUIRED.queryScope && index.fields?.length === 1
    && index.fields[0].fieldPath === "pending" && index.fields[0].order === "ASCENDING";
}
function plan(field) {
  if (field?.name !== FIELD || !Array.isArray(field.indexConfig?.indexes)) throw new Error("projection_index_current_field_required");
  const indexes = field.indexConfig.indexes;
  const exact = indexes.filter(matches);
  if (exact.length > 1) throw new Error("projection_index_ambiguous_configuration");
  const body = { name: FIELD, indexConfig: { indexes: indexes.map(writableIndex) } };
  if (!exact.length) body.indexConfig.indexes.push(structuredClone(REQUIRED));
  return { field: FIELD, updateMask: "indexConfig", needsPatch: !exact.length,
    ready: exact.length === 1 && exact[0].state === "READY", existingIndexCount: indexes.length,
    body };
}
module.exports = { FIELD, REQUIRED, matches, plan };
