/** Share only concurrent work. Nothing is retained after settlement or invalidation. */
export function inFlightRequests<T>() {
  let generation = 0;
  const pending = new Map<string, Promise<T>>();
  return {
    clear() { generation++; pending.clear(); },
    run(key: string, load: () => Promise<T>) {
      const existing = pending.get(key); if (existing) return existing;
      const start = generation;
      const promise = Promise.resolve().then(load).then(result => {
        if (start !== generation) throw Object.assign(new Error("Account context changed. Refresh to check access."), { code: "permission-denied" });
        return result;
      }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
      pending.set(key, promise); return promise;
    },
  };
}
