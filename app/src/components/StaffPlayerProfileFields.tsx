import { POSITIONS, POSITION_LABELS, type Position } from "../lib/contracts/types";
import type { StaffPlayerProfileInput } from "../lib/player-profile";

/** Phone, position, height and weight inputs shared by every staff "add player" form. */
export function StaffPlayerProfileFields({ value, onChange, disabled = false }: {
  value: StaffPlayerProfileInput;
  onChange: (next: StaffPlayerProfileInput) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<StaffPlayerProfileInput>) => onChange({ ...value, ...patch });
  return <>
    <label>Phone number<input type="tel" required autoComplete="off" inputMode="tel" placeholder="(555)-123-4567" disabled={disabled} value={value.phone} onChange={event => set({ phone: event.target.value })} /></label>
    <label>Position<select required disabled={disabled} value={value.position} onChange={event => set({ position: event.target.value as Position | "" })}>
      <option value="" disabled>Choose a position</option>
      {POSITIONS.map(position => <option key={position} value={position}>{position} · {POSITION_LABELS[position]}</option>)}
    </select></label>
    <label>Height (ft)<input type="number" min={0} max={8} inputMode="numeric" disabled={disabled} value={value.heightFeet} onChange={event => set({ heightFeet: event.target.value })} /></label>
    <label>Height (in)<input type="number" min={0} max={11} inputMode="numeric" disabled={disabled} value={value.heightInches} onChange={event => set({ heightInches: event.target.value })} /></label>
    <label>Weight (lbs)<input type="number" min={0} step="0.1" inputMode="decimal" disabled={disabled} value={value.weightPounds} onChange={event => set({ weightPounds: event.target.value })} /></label>
  </>;
}
