import firebase, { auth, db } from '../../../lib/firebase';
import { personalAge } from './personal-workouts';
import type { Row } from './execution';

export async function readOwnPlayerAge(playerId: string, ownerUid: string): Promise<number | undefined> {
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) return undefined;
  const player = (await db.collection('players').doc(playerId).get({ source: 'server' })).data();
  if (!player || auth.currentUser?.uid !== ownerUid) return undefined;
  const binding = player.authenticationUID || player.userUID;
  if (binding ? binding !== ownerUid : playerId !== ownerUid) return undefined;
  return personalAge(player);
}

/** A recorded age is a dated observation, never an invented date of birth. */
export async function saveOwnPlayerAge(playerId: string, ownerUid: string, age: number): Promise<Row> {
  if (!Number.isInteger(age) || age < 5 || age > 80) throw new Error('Choose your actual age, from 5 to 80.');
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) throw new Error('Sign in again before saving your age.');
  const ref = db.collection('players').doc(playerId);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), player = snapshot.data();
    if (!snapshot.exists || !player || auth.currentUser?.uid !== ownerUid) throw new Error('Your player profile could not be verified. Sign in again.');
    const binding = player.authenticationUID || player.userUID;
    if (binding ? binding !== ownerUid : playerId !== ownerUid) throw new Error('Only the player can confirm this profile age.');
    if (personalAge({ birthDate: player.birthDate, dateOfBirth: player.dateOfBirth }) !== undefined) throw new Error('Your birthday is already recorded. Refresh to use your current profile age.');
    transaction.update(ref, { age, ageRecordedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  const confirmed = (await ref.get({ source: 'server' })).data();
  if (!confirmed || personalAge(confirmed) !== age || auth.currentUser?.uid !== ownerUid) throw new Error('Your age could not be confirmed. Retry before creating a workout.');
  return confirmed;
}
