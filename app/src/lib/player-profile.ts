/* Profile fields every staff-created player carries (mobile docs/plans/PLAYER_CREATION_FIELDS_PLAN.md).
   Phone and position are required; height and weight are optional, entered in ft/in and lb,
   and sent as cm and kg. The callables enforce the same rules server-side. */
import { isPosition, type Position } from "./contracts/types";

export interface StaffPlayerProfileInput {
  phone: string;
  position: Position | "";
  heightFeet: string;
  heightInches: string;
  weightPounds: string;
}

export const emptyStaffPlayerProfile = (): StaffPlayerProfileInput =>
  ({ phone: "", position: "", heightFeet: "", heightInches: "", weightPounds: "" });

/** US phone number → "(XXX)-XXX-XXXX"; null when it is not a complete number. */
export function normalizePhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}` : null;
}

const blank = (value: string) => value.trim() === "";

export function heightCm(input: StaffPlayerProfileInput): number | null {
  if (blank(input.heightFeet) && blank(input.heightInches)) return null;
  const feet = blank(input.heightFeet) ? 0 : Number(input.heightFeet);
  const inches = blank(input.heightInches) ? 0 : Number(input.heightInches);
  const cm = (feet * 12 + inches) * 2.54;
  return Number.isFinite(cm) && cm > 0 && cm <= 300 ? cm : null;
}

export function weightKg(input: StaffPlayerProfileInput): number | null {
  if (blank(input.weightPounds)) return null;
  const kg = Number(input.weightPounds) * 0.453592;
  return Number.isFinite(kg) && kg > 0 && kg <= 500 ? kg : null;
}

/** First missing or invalid field, in form order; null when the profile can be saved. */
export function missingRequirement(input: StaffPlayerProfileInput, requiresWeight = false): string | null {
  if (!normalizePhone(input.phone)) return blank(input.phone) ? "Enter a phone number." : "Enter a 10-digit US phone number.";
  if (!isPosition(input.position)) return "Choose a position.";
  if (!(blank(input.heightFeet) && blank(input.heightInches)) && heightCm(input) === null) return "Enter a valid height, or leave it blank.";
  if (requiresWeight && weightKg(input) === null) return "Enter the player's weight in pounds.";
  if (!blank(input.weightPounds) && weightKg(input) === null) return "Enter a valid weight, or leave it blank.";
  return null;
}

/** Callable / Firestore fields. Call only when `missingRequirement` is null. */
export function staffPlayerProfileFields(input: StaffPlayerProfileInput): Record<string, string | number> {
  const fields: Record<string, string | number> = { phone_number: normalizePhone(input.phone)!, position: input.position };
  const height = heightCm(input), weight = weightKg(input);
  if (height !== null) fields.height = height;
  if (weight !== null) fields.weight = weight;
  return fields;
}
