/* Shared reader rules. Canonical server results must never be overwritten by stale artifacts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resultUsable(rep: any): boolean {
  if (rep.resultStatus) return rep.resultStatus.qualified === true && rep.resultStatus.duplicate !== true;
  return rep.resultsValid !== false && (!rep.processingStatus || rep.processingStatus === "complete")
    && !(Array.isArray(rep.failedSteps) && rep.failedSteps.length);
}

export function resultLabel(rep: any): string {
  if (!rep.resultStatus) return resultUsable(rep) ? "" : "Needs review";
  if (rep.resultStatus.duplicate) return "Duplicate recording";
  if (!rep.resultStatus.qualified) return "Result unavailable · needs review";
  return rep.resultStatus.reason === "acceptedRevision" ? "Reviewed result" : "Recorded result";
}

export function sameResultStatus(left: any, right: any): boolean {
  return ["qualified", "duplicate", "reason", "revisionId"].every(key => left?.[key] === right?.[key]);
}

export function metricValue(rep: any, field: string, meta: any = {}, fallbacks: string[] = []): number | null {
  if (!resultUsable(rep) || (!rep.resultStatus && !resultUsable(meta))) return null;
  const sources = rep.resultStatus ? [rep] : [meta, rep];
  const fields = field === "jumpHeight" ? [field, ...fallbacks, "jump_height_m", "jump_height_in", "jump_height_inches"] : [field, ...fallbacks];
  for (const key of fields) for (const source of sources) {
    const value = finiteNumber(source?.[key]);
    if (value === null) continue;
    const signed = ["launch_angle", "launchAngle"].includes(key);
    const frame = /Frame$|_frame$/.test(key);
    if ((!signed && value < 0) || (frame && !Number.isInteger(value))) return null;
    if (!signed && !frame && value === 0) return null;
    return ["jump_height_in", "jump_height_inches"].includes(key) ? value * 0.0254 : value;
  }
  return null;
}

/** Only proven pathless jump mirrors are suppressed; matching labels alone are not proof. */
/** A station attempt that failed processing, flagged by the results callable or read raw from Firestore. */
export function failedAttempt(rep: Record<string, any>): boolean {
  return rep.failedAttempt === true || (rep.processingStatus === "failed" && rep.resultsValid === false);
}

/** Failed attempts are hidden from athletes and coaches; staff review passes `includeFailedAttempts`. */
export function visibleAttempts<T extends Record<string, any>>(reps: T[], options: { includeFailedAttempts?: boolean } = {}): T[] {
  if (!options.includeFailedAttempts) reps = reps.filter(rep => !failedAttempt(rep));
  const key = (rep: T) => {
    const type = rep.repType || rep.drillType || rep._statsDrill;
    if (type !== "jump" || !Number.isSafeInteger(rep.sessionNumber) || rep.sessionNumber < 1
      || !Number.isSafeInteger(rep.repNumber) || rep.repNumber < 1) return null;
    return JSON.stringify([rep.sessionNumber, rep.repNumber]);
  };
  const backed = new Set(reps.filter(rep => rep.storagePath).map(key).filter(Boolean));
  return reps.filter(rep => !rep.resultStatus?.duplicate && (rep.resultStatus || rep.storagePath || !backed.has(key(rep))));
}

export function attemptLabel(rep: any, peers: any[] = []): string {
  const number = finiteNumber(rep.repNumber ?? rep.kickNumber);
  const label = number !== null && number > 0 ? `Rep ${number}` : "Attempt";
  const matches = peers.filter(item => (item.repNumber ?? item.kickNumber) === (rep.repNumber ?? rep.kickNumber));
  return matches.length > 1 || label === "Attempt" ? `${label} · ${String(rep.id).slice(-6)}` : label;
}
