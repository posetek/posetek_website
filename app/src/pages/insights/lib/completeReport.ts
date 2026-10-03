/** A cold projection rebuild can make progress without returning partial totals. */
export async function completeReport<T>(load: () => Promise<T>, isCurrent: () => boolean, onRebuild?: () => void): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!isCurrent()) return null;
    try { const data = await load(); return isCurrent() ? data : null; }
    catch (error) {
      if (!isCurrent()) return null;
      const failure = error as { code?: string; details?: { reason?: string } };
      if (String(failure.code || "").split("/").at(-1) !== "failed-precondition" || failure.details?.reason !== "insights-rebuild-required" || attempt === 4) throw error;
      onRebuild?.();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  return null;
}
