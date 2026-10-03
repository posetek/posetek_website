import { useEffect, useId, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import { personalAge } from './personal-workouts';
import { saveOwnPlayerAge } from './player-age';
import type { Row } from './execution';

export default function PlayerAgeField({ playerId, athlete, editable, preview }: { playerId: string; athlete: Row; editable: boolean; preview: boolean }) {
  const [profile, setProfile] = useState(athlete), [editing, setEditing] = useState(false), [choice, setChoice] = useState(personalAge(athlete) || 15);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), id = useId();
  useEffect(() => {
    if (preview) return;
    return db.collection('players').doc(playerId).onSnapshot(snapshot => { if (snapshot.exists) setProfile(snapshot.data()!); }, () => { /* retain the already authorized profile */ });
  }, [playerId, preview]);
  const age = personalAge(profile), hasBirthday = personalAge({ birthDate: profile.birthDate, dateOfBirth: profile.dateOfBirth }) !== undefined;
  const save = async () => {
    setSaving(true); setError('');
    try { const next = preview ? { ...profile, age: choice, ageRecordedAt: new Date() } : await saveOwnPlayerAge(playerId, auth.currentUser?.uid || '', choice); setProfile(next); setEditing(false); }
    catch (e: any) { setError(e.message || 'Your age could not be saved. Try again.'); }
    finally { setSaving(false); }
  };
  return <div className="player-profile-age"><div><span><small>Age</small><strong>{age === undefined ? 'Not confirmed' : `${age} years`}</strong></span>{editable && !hasBirthday && <button type="button" className="text-button" onClick={() => { setChoice(age || profile.age || 15); setEditing(v => !v); setError(''); }}>{editing ? 'Cancel' : age ? 'Update age' : 'Confirm age'}</button>}</div>
    {editing && <fieldset disabled={saving}><label className="workout-slider" htmlFor={`${id}-age`}><span><strong>{choice}</strong> years old</span><input id={`${id}-age`} type="range" min={5} max={80} step={1} value={choice} onChange={e => setChoice(Number(e.target.value))} /></label><small>Save your actual current age. Your birthday stays as recorded.</small><button type="button" className="hub-secondary" onClick={() => void save()}>{saving ? 'Saving…' : `Confirm age ${choice}`}</button></fieldset>}
    {error && <p className="player-error" role="alert">{error}</p>}
  </div>;
}
