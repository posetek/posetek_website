"use strict";

// In-memory Firestore for the device-performance projection and report tests.
//
// The shared test-support/fake-firestore.js supports equality queries only and
// cannot order timestamps, so this fake adds what the projection relies on:
// range filters, multi-field ordering with a document-id tie-breaker,
// startAfter cursors, array-contains, serialized transactions with rollback,
// server timestamps that follow an injected clock, read accounting (documents,
// decoded page bytes, peak concurrent page reads) and write fault injection.
// It models the Admin SDK surface the modules call, not Firestore's full
// semantics; emulator tests remain an unrun check.

const SERVER_TIMESTAMP = Symbol("serverTimestamp");
const ARRAY_UNION = Symbol("arrayUnion");
const DELETE = Symbol("delete");
const INCREMENT = Symbol("increment");

class Timestamp {
  constructor(millis) { this.millis = millis; }
  static fromMillis(millis) { return new Timestamp(millis); }
  static now() { return new Timestamp(Timestamp.clock()); }
  toMillis() { return this.millis; }
  toDate() { return new Date(this.millis); }
  get seconds() { return Math.floor(this.millis / 1000); }
  get nanoseconds() { return (this.millis - Math.floor(this.millis / 1000) * 1000) * 1e6; }
  valueOf() { return this.millis; }
}
Timestamp.clock = () => Date.now();

const FieldValue = {
  serverTimestamp: () => ({ [SERVER_TIMESTAMP]: true }),
  arrayUnion: (...values) => ({ [ARRAY_UNION]: values }),
  delete: () => ({ [DELETE]: true }),
  increment: (amount) => ({ [INCREMENT]: amount }),
};

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

function clone(value) {
  if (value instanceof Timestamp) return new Timestamp(value.millis);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") {
    if (Object.getOwnPropertySymbols(value).length) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function resolveValue(existing, incoming, now) {
  if (incoming && typeof incoming === "object" && !(incoming instanceof Timestamp)) {
    if (incoming[SERVER_TIMESTAMP]) return new Timestamp(now());
    if (incoming[ARRAY_UNION]) {
      const current = Array.isArray(existing) ? [...existing] : [];
      for (const value of incoming[ARRAY_UNION]) if (!current.includes(value)) current.push(value);
      return current;
    }
    if (incoming[INCREMENT] !== undefined) return (typeof existing === "number" ? existing : 0) + incoming[INCREMENT];
    if (!Array.isArray(incoming)) {
      return Object.fromEntries(Object.entries(incoming).filter(([, entry]) => !(entry && entry[DELETE]))
        .map(([key, entry]) => [key, resolveValue(undefined, entry, now)]));
    }
  }
  return clone(incoming);
}

function fieldOf(data, field) {
  return field.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), data);
}

function compareValues(a, b) {
  const rank = (value) => (value === null || value === undefined ? 0 : typeof value === "boolean" ? 1
    : typeof value === "number" || value instanceof Timestamp || value instanceof Date ? 2 : typeof value === "string" ? 3 : 4);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  const va = a instanceof Timestamp ? a.millis : a instanceof Date ? a.getTime() : a, vb = b instanceof Timestamp ? b.millis : b instanceof Date ? b.getTime() : b;
  if (va === vb) return 0;
  return va < vb ? -1 : 1;
}

class Snapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; }
  get exists() { return this._data !== undefined; }
  data() { return this._data === undefined ? undefined : clone(this._data); }
}

class DocumentReference {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new CollectionReference(this.db, `${this.path}/${name}`); }
  async get() { return this.db.readDocument(this.path); }
  async set(data, options = {}) { this.db.write(this.path, data, { merge: Boolean(options.merge) }); }
  async update(data) { this.db.write(this.path, data, { merge: true, requireExists: true }); }
  async create(data) { this.db.write(this.path, data, { create: true }); }
  async delete() { this.db.remove(this.path); }
}

class Query {
  constructor(db, path, filters = [], orders = [], max = Infinity, cursor = null, fields = null) {
    Object.assign(this, { db, path, filters, orders, max, cursor, fields });
  }
  with(changes) {
    const next = { filters: this.filters, orders: this.orders, max: this.max, cursor: this.cursor, fields: this.fields, ...changes };
    return new Query(this.db, this.path, next.filters, next.orders, next.max, next.cursor, next.fields);
  }
  where(field, op, value) { return this.with({ filters: [...this.filters, [field, op, value]] }); }
  orderBy(field, direction = "asc") { return this.with({ orders: [...this.orders, [field, direction]] }); }
  limit(max) { return this.with({ max }); }
  startAfter(...values) { return this.with({ cursor: values }); }
  // A field projection: only these fields are returned (and decoded).
  select(...fields) { return this.with({ fields }); }
  // An aggregation: counted without decoding the documents.
  count() {
    const query = this;
    return {
      async get() {
        const depth = query.path.split("/").length + 1;
        let count = 0;
        for (const [path, data] of query.db.docs) {
          if (path.split("/").length === depth && path.startsWith(`${query.path}/`) && query.matches(data)) count++;
        }
        query.db.stats.counts = (query.db.stats.counts || 0) + 1;
        await query.db.tick();
        return { data: () => ({ count }) };
      },
    };
  }
  matches(data) {
    return this.filters.every(([field, op, value]) => {
      const actual = fieldOf(data, field);
      switch (op) {
        case "==": return actual !== undefined && compareValues(actual, value) === 0;
        case "<": return actual !== undefined && actual !== null && compareValues(actual, value) < 0;
        case "<=": return actual !== undefined && actual !== null && compareValues(actual, value) <= 0;
        case ">": return actual !== undefined && actual !== null && compareValues(actual, value) > 0;
        case ">=": return actual !== undefined && actual !== null && compareValues(actual, value) >= 0;
        case "in": return value.some((candidate) => compareValues(actual, candidate) === 0);
        case "array-contains": return Array.isArray(actual) && actual.includes(value);
        default: throw new Error(`Unsupported operator ${op}`);
      }
    });
  }
  sortKey(snapshot, field) { return field === "__name__" ? snapshot.id : fieldOf(snapshot._data, field); }
  async get() {
    const depth = this.path.split("/").length + 1;
    let docs = [];
    for (const [path, data] of this.db.docs) {
      if (path.split("/").length !== depth || !path.startsWith(`${this.path}/`)) continue;
      // An orderBy on a field excludes documents without it, as in Firestore.
      if (this.orders.some(([field]) => field !== "__name__" && fieldOf(data, field) === undefined)) continue;
      if (this.matches(data)) docs.push(new Snapshot(new DocumentReference(this.db, path), data));
    }
    const orders = this.orders.some(([field]) => field === "__name__") ? this.orders : [...this.orders, ["__name__", "asc"]];
    const compare = (a, b) => {
      for (const [field, direction] of orders) {
        const order = compareValues(this.sortKey(a, field), this.sortKey(b, field));
        if (order) return direction === "desc" ? -order : order;
      }
      return 0;
    };
    docs.sort(compare);
    if (this.cursor) {
      docs = docs.filter((doc) => {
        for (let index = 0; index < this.cursor.length; index++) {
          const [field, direction] = orders[index];
          const order = compareValues(this.sortKey(doc, field), this.cursor[index]);
          if (order) return (direction === "desc" ? -order : order) > 0;
        }
        return false;
      });
    }
    // A field projection keeps only the selected (dotted) paths, as nested maps.
    const project = (data) => {
      if (!this.fields) return data;
      const out = {};
      for (const field of this.fields) {
        const value = fieldOf(data, field);
        if (value === undefined) continue;
        const parts = field.split(".");
        let node = out;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)] = value;
      }
      return out;
    };
    const page = docs.slice(0, this.max).map((doc) => new Snapshot(doc.ref, project(doc._data)));
    this.db.stats.queries.push({
      path: this.path, filters: this.filters.map(([field, op]) => `${field} ${op}`),
      orders: this.orders.map(([field, direction]) => `${field} ${direction}`), fields: this.fields, returned: page.length,
    });
    for (const doc of page) this.db.account(doc.ref.path, doc._data);
    await this.db.tick();
    return { docs: page.map((doc) => new Snapshot(doc.ref, clone(doc._data))), empty: page.length === 0, size: page.length };
  }
}

class CollectionReference extends Query {
  doc(id) { return new DocumentReference(this.db, `${this.path}/${id ?? `generated-${++this.db.generated}`}`); }
}

class Batch {
  constructor(db) { this.db = db; this.operations = []; }
  set(ref, data, options = {}) { this.operations.push(() => this.db.write(ref.path, data, { merge: Boolean(options.merge) })); return this; }
  update(ref, data) { this.operations.push(() => this.db.write(ref.path, data, { merge: true, requireExists: true })); return this; }
  create(ref, data) { this.operations.push(() => this.db.write(ref.path, data, { create: true })); return this; }
  delete(ref) { this.operations.push(() => this.db.remove(ref.path)); return this; }
  async commit() {
    // A batch is atomic: a failing write leaves nothing behind.
    const before = this.db.checkpoint();
    try { for (const operation of this.operations) operation(); } catch (error) { this.db.restore(before); throw error; }
    await this.db.tick();
  }
}

class Transaction extends Batch {
  async get(target) {
    if (this.operations.length) throw new Error("Firestore transactions require all reads before writes");
    return target instanceof DocumentReference ? this.db.readDocument(target.path) : target.get();
  }
}

class FakeFirestore {
  constructor(seed = {}, { now = () => Date.now() } = {}) {
    this.docs = new Map();
    this.generated = 0;
    this.now = now;
    this.tail = Promise.resolve();
    this.failWrite = null;
    this.stats = { reads: 0, readsByRoot: {}, pageReads: 0, pageBytes: 0, inflightPages: 0, maxInflightPages: 0, queries: [] };
    for (const [path, data] of Object.entries(seed)) this.docs.set(path, clone(data));
  }
  resetStats() { this.stats = { reads: 0, readsByRoot: {}, pageReads: 0, pageBytes: 0, inflightPages: 0, maxInflightPages: 0, queries: [] }; }
  tick() { return new Promise((resolve) => setImmediate(resolve)); }
  account(path, data) {
    this.stats.reads++;
    const root = path.split("/")[0];
    this.stats.readsByRoot[root] = (this.stats.readsByRoot[root] || 0) + 1;
    // A decoded projection page (a field projection without rows is not one).
    if (path.includes("/projectionPages/") && data && Array.isArray(data.rows)) {
      this.stats.pageReads++;
      this.stats.pageBytes += Buffer.byteLength(JSON.stringify(data.rows), "utf8");
    }
  }
  async readDocument(path) {
    const page = path.includes("/projectionPages/");
    if (page) { this.stats.inflightPages++; this.stats.maxInflightPages = Math.max(this.stats.maxInflightPages, this.stats.inflightPages); }
    try {
      await this.tick();
      const data = this.docs.get(path);
      this.account(path, data);
      return new Snapshot(new DocumentReference(this, path), data === undefined ? undefined : clone(data));
    } finally {
      if (page) this.stats.inflightPages--;
    }
  }
  write(path, data, { merge = false, create = false, requireExists = false } = {}) {
    if (this.failWrite && this.failWrite(path, data)) throw new Error(`INJECTED_WRITE_FAILURE: ${path}`);
    const existing = this.docs.get(path);
    if (create && existing !== undefined) throw new Error(`ALREADY_EXISTS: ${path}`);
    if (requireExists && existing === undefined) throw new Error(`NOT_FOUND: ${path}`);
    const next = merge && existing !== undefined ? clone(existing) : {};
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && value[DELETE]) { delete next[key]; continue; }
      next[key] = resolveValue(next[key], value, this.now);
    }
    this.docs.set(path, next);
  }
  remove(path) { this.docs.delete(path); }
  checkpoint() { return new Map([...this.docs].map(([path, data]) => [path, clone(data)])); }
  restore(snapshot) { this.docs = snapshot; }
  collection(name) { return new CollectionReference(this, name); }
  doc(path) { return new DocumentReference(this, path); }
  batch() { return new Batch(this); }
  async runTransaction(handler) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const before = this.checkpoint();
    try {
      const transaction = new Transaction(this);
      const result = await handler(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      this.restore(before);
      throw error;
    } finally { release(); }
  }
  snapshot(path) { const data = this.docs.get(path); return data === undefined ? undefined : clone(data); }
  paths(prefix) { return [...this.docs.keys()].filter((path) => path.startsWith(prefix)).sort(); }
}

module.exports = { FakeFirestore, Timestamp, FieldValue, HttpsError, DocumentReference };
