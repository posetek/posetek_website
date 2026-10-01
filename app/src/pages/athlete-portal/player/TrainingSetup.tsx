import { useId, useState } from 'react';
import { EQUIPMENT_LABELS, FACILITIES, LOCATION_PRESETS, clearSpaceRestrictions, locationSetup, setupErrors } from './training-access';
import type { SetupDraft } from './training-access';

/** The same compact setup is used before creation, revisions and session recovery. */
export default function TrainingSetup({ value, onChange, onConfirm, disabled = false, title = 'Where will you train?', confirmLabel = 'Use this setup', inline = false }: {
  value: SetupDraft; onChange: (value: SetupDraft) => void; onConfirm?: (value: SetupDraft) => void; disabled?: boolean; title?: string; confirmLabel?: string; inline?: boolean;
}) {
  const [extra, setExtra] = useState(''), [attempted, setAttempted] = useState(false), id = useId();
  const update = (patch: Partial<SetupDraft>) => onChange({ ...value, ...patch, confirmed: false });
  const toggle = (item: string) => update({ equipment: value.equipment.includes(item) ? value.equipment.filter(e => e !== item) : [...value.equipment, item], equipmentAnswered: true });
  const errors = attempted ? setupErrors(value) : [];
  const preset = value.facility in LOCATION_PRESETS ? LOCATION_PRESETS[value.facility as keyof typeof LOCATION_PRESETS] : null;
  return <section className={`training-setup${inline ? ' training-setup-inline' : ' portal-card'}`} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{title}</h2><p className="muted-copy">We’ll start with the usual equipment for your setting. Adjust anything you don’t have.</p>
    <fieldset disabled={disabled}>
      <div className="workout-choice-grid workout-location-options" role="group" aria-label="Training location">
        {Object.entries(LOCATION_PRESETS).map(([key, option]) => <button type="button" className="workout-choice" key={key} aria-pressed={value.facility === key} onClick={() => onChange(locationSetup(key as keyof typeof LOCATION_PRESETS, value))}>
          <span className="material-symbols-outlined" aria-hidden="true">{option.icon}</span><strong>{option.label}</strong><small>{option.description}</small>
        </button>)}
      </div>
      {value.facility && !preset && <p className="muted-copy">Current setting: {FACILITIES[value.facility]}</p>}
      <div className="workout-resource-switches">
        {[['ball', 'Football', 'Bring your ball'], ['goal', 'Goal', 'A goal you can use']].map(([item, label, description]) => <button type="button" key={item} role="switch" aria-checked={value.equipment.includes(item)} className="workout-resource-switch" onClick={() => toggle(item)}><span><strong>{label}</strong><small>{description}</small></span><span className="workout-switch-indicator" aria-hidden="true"><i /></span></button>)}
      </div>
      <details className="workout-setup-extras"><summary>Adjust equipment or training with others</summary>
        {(value.lengthMeters !== '' || value.widthMeters !== '' || value.surface || value.overheadConfirmed || value.goalAreaConfirmed) && <div className="workout-inherited-space"><p><strong>Earlier space details still apply:</strong> {[value.lengthMeters !== '' && `${value.lengthMeters} m length`, value.widthMeters !== '' && `${value.widthMeters} m width`, value.surface && `${value.surface} surface`, value.overheadConfirmed && (value.overheadClear ? 'clear overhead space' : 'limited overhead space'), value.goalAreaConfirmed && (value.goalArea ? 'marked goal area' : 'no marked goal area')].filter(Boolean).join(' · ')}</p><button type="button" className="text-button" onClick={() => onChange(clearSpaceRestrictions(value))}>Use suitable space at this location</button><small>Use this only when those earlier limits no longer describe where you’ll train.</small></div>}
        <p className="muted-copy">Selected equipment</p><div className="workout-resource-chips">{value.equipment.map(item => <button type="button" key={item} onClick={() => toggle(item)} aria-label={`Remove ${EQUIPMENT_LABELS[item] || item}`}><span>{EQUIPMENT_LABELS[item] || item}</span><span aria-hidden="true">×</span></button>)}{!value.equipment.length && <span>Bodyweight only</span>}</div>
        <div className="workout-extra-equipment"><label htmlFor={`${id}-extra`}>Add equipment<select id={`${id}-extra`} value={extra} onChange={e => setExtra(e.target.value)}><option value="">Choose an item</option>{Object.entries(EQUIPMENT_LABELS).filter(([key]) => !value.equipment.includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" className="hub-secondary" disabled={!extra} onClick={() => { toggle(extra); setExtra(''); }}>Add</button></div>
        <div className="workout-segments" role="group" aria-label="Training participants"><button type="button" aria-pressed={value.participantCount === 1} onClick={() => update({ participantCount: 1 })}>Solo</button><button type="button" aria-pressed={Number(value.participantCount) > 1} onClick={() => update({ participantCount: Math.max(2, Number(value.participantCount) || 2) })}>With others</button></div>
        {Number(value.participantCount) > 1 && <label>People, including you<input type="number" inputMode="numeric" min={2} max={12} value={value.participantCount} onChange={e => update({ participantCount: e.target.value === '' ? '' : Number(e.target.value) })} /></label>}
      </details>
      {!!errors.length && <div className="player-error" role="alert"><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      {onConfirm && <button type="button" className="primary-cta" onClick={() => { setAttempted(true); if (!setupErrors(value).length) onConfirm({ ...value, confirmed: true }); }}>{confirmLabel}</button>}
    </fieldset>
  </section>;
}
