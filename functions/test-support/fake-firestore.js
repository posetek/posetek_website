"use strict";

// Minimal in-memory Firestore for handler tests. Supports the subset the
// admission, leaderboard and share modules use: document get/set/update,
// equality and array-contains queries with limit, batches, transactions,
// count aggregation, and the FieldValue / Timestamp sentinels.

const ARRAY_UNION = Symbol("arrayUnion");
const SERVER_TIMESTAMP = Symbol("serverTimestamp");
const DELETE = Symbol("delete");
const INCREMENT = Symbol("increment");

class FakeTimestamp {
  constructor(millis) { this.millis = millis; }
  static now() { return new FakeTimestamp(FakeTimestamp.clock()); }
  static fromMillis(millis) { return new FakeTimestamp(millis); }
  toMillis() { return this.millis; }
  toDate() { return new Date(this.millis); }
}
FakeTimestamp.clock = () => Date.now();

const FieldValue = {
  arrayUnion: (...values) => ({ [ARRAY_UNION]: values }),
  serverTimestamp: () => ({ [SERVER_TIMESTAMP]: true }),
  delete: () => ({ [DELETE]: true }),
  increment: (amount) => ({ [INCREMENT]: amount }),
};

function clone(value) {
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value.millis);
  if (value instanceof DocumentReference) return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object" && !Object.getOwnPropertySymbols(value).length) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function applyValue(existing, incoming) {
  if (incoming && typeof incoming === "object") {
    if (incoming[ARRAY_UNION]) {
      const current = Array.isArray(existing) ? [...existing] : [];
      for (const value of incoming[ARRAY_UNION]) if (!current.includes(value)) current.push(value);
      return current;
    }
    if (incoming[SERVER_TIMESTAMP]) return FakeTimestamp.now();
    if (incoming[INCREMENT]) return (typeof existing === "number" ? existing : 0) + incoming[INCREMENT];
  }
  return clone(incoming);
}

function mergeInto(target, updates) {
  for (const [key, value] of Object.entries(updates)) {
    if (value && typeof value === "object" && value[DELETE]) { delete target[key]; continue; }
    if (key.includes(".")) {
      const parts = key.split(".");
      let cursor = target;
      for (const part of parts.slice(0, -1)) cursor = cursor[part] = cursor[part] && typeof cursor[part] === "object" ? cursor[part] : {};
      cursor[parts.at(-1)] = applyValue(cursor[parts.at(-1)], value);
      continue;
    }
    target[key] = applyValue(target[key], value);
  }
  return target;
}

class Snapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; }
  get exists() { return this._data !== undefined; }
  data() { return this._data === undefined ? undefined : clone(this._data); }
  get(field) { return this._data ? this._data[field] : undefined; }
}

class DocumentReference {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new CollectionReference(this.db, `${this.path}/${name}`); }
  async get() { return new Snapshot(this, this.db.read(this.path)); }
  async set(data, options = {}) { this.db.write(this.path, data, { merge: Boolean(options.merge), create: false }); }
  async update(data) { this.db.write(this.path, data, { merge: true, create: false, requireExists: true }); }
  async create(data) { this.db.write(this.path, data, { merge: false, create: true }); }
  async delete() { this.db.docs.delete(this.path); }
}

class Query {
  constructor(db, path, filters = [], max = Infinity, orders = [], cursor = null) { this.db = db; this.path = path; this.filters = filters; this.max = max; this.orders = orders; this.cursor = cursor; }
  where(field, op, value) { return new Query(this.db, this.path, [...this.filters, [field, op, value]], this.max, this.orders, this.cursor); }
  limit(max) { return new Query(this.db, this.path, this.filters, max, this.orders, this.cursor); }
  orderBy(field, direction = "asc") { return new Query(this.db, this.path, this.filters, this.max, [...this.orders, [field, direction]], this.cursor); }
  startAfter(...values) { return new Query(this.db, this.path, this.filters, this.max, this.orders, values); }
  count() { const query = this; return { async get() { const result = await query.get(); return { data: () => ({ count: result.size }) }; } }; }
  matches(data) {
    return this.filters.every(([field, op, value]) => {
      // Dotted paths reach into maps, as Firestore's do (`triage.state`).
      const actual = field.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), data);
      if (op === "==") return actual === value;
      if (op === "array-contains-any") return Array.isArray(actual) && value.some(v => actual.includes(v));
      if (op === "array-contains") return Array.isArray(actual) && actual.includes(value);
      throw new Error(`Unsupported operator ${op}`);
    });
  }
  async get() {
    const docs = [];
    for (const [path, data] of this.db.docs) {
      if (path.split("/").length !== this.path.split("/").length + 1 || !path.startsWith(this.path + "/")) continue;
      if (this.matches(data)) docs.push(new Snapshot(new DocumentReference(this.db, path), data));

    }
    this.db.queries.push({ path: this.path, filters: this.filters });
    const compare = (a, b) => {
      for (let i = 0; i < this.orders.length; i++) {
        const [field, direction] = this.orders[i], av = field === "__name__" ? a.id : a.data()[field], bv = Array.isArray(b) ? b[i] : field === "__name__" ? b.id : b.data()[field];
        if (av !== bv) return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    };
    docs.sort(compare);
    const page = docs.filter(d => !this.cursor || compare(d, this.cursor) > 0).slice(0, this.max);
    return { docs: page, empty: page.length === 0, size: page.length };
  }
}

class CollectionReference extends Query {
  doc(id = "generated-" + (++this.db.generated)) { return new DocumentReference(this.db, `${this.path}/${id}`); }
}

class Batch {
  constructor(db) { this.db = db; this.operations = []; }
  set(ref, data, options = {}) { this.operations.push(() => this.db.write(ref.path, data, { merge: Boolean(options.merge), create: false })); return this; }
  update(ref, data) { this.operations.push(() => this.db.write(ref.path, data, { merge: true, create: false, requireExists: true })); return this; }
  create(ref, data) { this.operations.push(() => this.db.write(ref.path, data, { merge: false, create: true })); return this; }
  delete(ref) { this.operations.push(() => this.db.docs.delete(ref.path)); return this; }
  async commit() { for (const operation of this.operations) operation(); }
}

class Transaction extends Batch {
  async get(target) {
    if (this.operations.length) throw new Error("Firestore transactions require all reads before writes");
    if (target instanceof DocumentReference) return new Snapshot(target, this.db.read(target.path));
    return target.get();
  }
  async getAll(...refs) {
    if (this.operations.length) throw new Error("Firestore transactions require all reads before writes");
    return this.db.getAll(...refs);
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.docs = new Map();
    this.queries = [];
    this.bulkReads = [];
    this.generated = 0;
    this.transactionTail = Promise.resolve();
    for (const [path, data] of Object.entries(seed)) this.docs.set(path, clone(data));
  }
  read(path) { const data = this.docs.get(path); return data === undefined ? undefined : clone(data); }
  write(path, data, { merge, create, requireExists }) {
    const existing = this.docs.get(path);
    if (create && existing !== undefined) throw new Error(`ALREADY_EXISTS: ${path}`);
    if (requireExists && existing === undefined) throw new Error(`NOT_FOUND: ${path}`);
    const next = merge && existing !== undefined ? clone(existing) : {};
    this.docs.set(path, mergeInto(next, data));
  }
  collection(name) { return new CollectionReference(this, name); }
  doc(path) { return new DocumentReference(this, path); }
  async getAll(...refs) {
    if (!refs.length || refs.some(ref => !(ref instanceof DocumentReference))) throw new Error("getAll requires individual document references");
    this.bulkReads.push(refs.map(ref => ref.path));
    return refs.map(ref => new Snapshot(ref, this.read(ref.path)));
  }
  batch() { return new Batch(this); }
  async runTransaction(handler) {
    // Serial transactions model atomic competing claims, with rollback on a
    // failed create/precondition. Native emulator tests cover SDK integration.
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    const before = new Map([...this.docs].map(([path, data]) => [path, clone(data)]));
    try {
      const transaction = new Transaction(this);
      const result = await handler(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      this.docs = before;
      throw error;
    } finally { release(); }
  }
  snapshot(path) { return this.read(path); }
}

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

module.exports = { FakeFirestore, FakeTimestamp, FieldValue, HttpsError, DocumentReference };
