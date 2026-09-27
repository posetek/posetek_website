"use strict";
// Profile fields every staff-created player must carry (mobile
// docs/plans/PLAYER_CREATION_FIELDS_PLAN.md). Phone and position are required;
// height (cm) and weight (kg) are optional but validated. Field names and bounds
// match the canonical Firestore rules for player documents.
const POSITIONS = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"];

/** US phone number → "(XXX)-XXX-XXXX", the shape the app has always stored; null when incomplete. */
function normalizePhone(value) {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Validates staff input and returns the player-document fields, or calls `fail`. */
function staffPlayerProfile(data, fail) {
  const phone = normalizePhone(data?.phone_number);
  if (!phone) fail("invalid-argument", "Enter the player's 10-digit phone number.");
  if (!POSITIONS.includes(data?.position)) fail("invalid-argument", "Choose the player's position.");
  const profile = { phone_number: phone, position: data.position };
  for (const [field, max] of [["height", 300], ["weight", 500]]) {
    if (data?.[field] === undefined || data?.[field] === null) continue;
    if (typeof data[field] !== "number" || !Number.isFinite(data[field]) || data[field] <= 0 || data[field] > max) fail("invalid-argument", `Enter a valid ${field}.`);
    profile[field] = data[field];
  }
  return profile;
}

module.exports = { POSITIONS, normalizePhone, staffPlayerProfile };
