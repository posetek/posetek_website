/** Shared eligibility age policy. Stored observations remain inspectable even
 * when they cannot be used for a new prescription. No birthday is inferred. */
export interface ProfileAge {
  age: number | null;
  source: 'birthDate' | 'legacyDateOfBirth' | 'playerDocAge' | 'absent';
  stale: boolean;
  recordedAge: number | null;
  recordedAt: Date | null;
  observationStatus: 'current' | 'stale' | 'undated' | 'future' | 'invalid' | 'absent';
}
function validDate(value: unknown): Date | null {
  try {
    let normalized = value;
    if (typeof value === 'string') {
      const calendar = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
      if (!calendar) return null;
      const check = new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3])));
      if (check.getUTCFullYear() !== Number(calendar[1]) || check.getUTCMonth() + 1 !== Number(calendar[2]) || check.getUTCDate() !== Number(calendar[3])) return null;
      // The gateway treats a timestamp without an offset as UTC. JavaScript
      // otherwise reads it in the browser's timezone, changing DOB and freshness.
      if (value.includes('T') && !/(?:[zZ]|[+-]\d{2}(?::?\d{2})?(?::?\d{2})?)$/.test(value)) normalized = `${value}Z`;
    }
    const date = normalized instanceof Date ? normalized : typeof (normalized as any)?.toDate === 'function' ? (normalized as any).toDate()
      : typeof normalized === 'string' ? new Date(normalized) : null;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch { return null; }
}
export function resolveProfileAge(player: Record<string, any> | null | undefined, now = new Date()): ProfileAge {
  const recordedAge = Number.isInteger(player?.age) && player!.age >= 5 && player!.age <= 80 ? player!.age : null;
  const recordedAt = validDate(player?.ageRecordedAt), gap = recordedAt ? now.getTime() - recordedAt.getTime() : null;
  const observationStatus: ProfileAge['observationStatus'] = recordedAge === null ? player?.age === undefined || player?.age === null ? 'absent' : 'invalid'
    : gap === null ? 'undated' : gap < 0 ? 'future' : gap > 365 * 86400000 ? 'stale' : 'current';
  const observation = { recordedAge, recordedAt, observationStatus };
  for (const [field, source] of [['birthDate', 'birthDate'], ['dateOfBirth', 'legacyDateOfBirth']] as const) {
    const birth = validDate(player?.[field]);
    if (!birth || birth > now) continue;
    const age = now.getUTCFullYear() - birth.getUTCFullYear() - (now.getUTCMonth() < birth.getUTCMonth()
      || now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate() ? 1 : 0);
    if (age >= 5 && age <= 80) return { age, source, stale: false, ...observation };
  }
  return { age: observationStatus === 'current' ? recordedAge : null, source: recordedAge === null ? 'absent' : 'playerDocAge',
    stale: recordedAge !== null && observationStatus !== 'current', ...observation };
}
