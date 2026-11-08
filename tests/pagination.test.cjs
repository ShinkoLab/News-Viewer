/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile local TypeScript with the project's pinned compiler; no test dependency.
function modules(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    if (name in mocks) return mocks[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name);
    const filename = path.resolve(__dirname, '../src', name.slice(2) + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loaded = { exports: {} }; cache.set(name, loaded.exports);
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})',
      { Buffer, Date, console, ...globals }, { filename })(load, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}
const load = modules();
const { encodeBatchCursor, parseBatchBoundary } = load('@/lib/batchCursor');
const { listFilteredBatchesPageFrom } = load('@/lib/db.shared');
const sort = { mode: 'name', order: [] };
const filters = { category: null, period: 'all' };

test('opaque cursor preserves ID and nanoseconds; legacy ISO remains accepted', () => {
  const c = { seconds: 1700000000, nanoseconds: 123456789, id: '10' };
  assert.equal(JSON.stringify(parseBatchBoundary(encodeBatchCursor(c))), JSON.stringify(c));
  assert.equal(parseBatchBoundary('2026-11-03T00:00:00.000Z').toISOString(), '2026-11-03T00:00:00.000Z');
  for (const bad of ['nope', 'v1.!!!', 'v1.' + Buffer.from('[0,1000000000,"1"]').toString('base64url'),
    'v1.' + Buffer.from('[0,0,"../secret"]').toString('base64url')]) {
    assert.throws(() => parseBatchBoundary(bad));
  }
});

function sourceFor(records) {
  return {
    async listBatchesPage(limit, before) {
      const rows = records.filter(r => !before || r.id < Number(before.id));
      return { records: rows.slice(0, limit), hasMore: rows.length > limit };
    },
    async hydrateBatches(rows) {
      return rows.map(r => ({ id: r.id, executedAt: r.executedAt.toISOString(), totalArticles: 1,
        digestText: 'digest', categories: [{ category: r.id === 1 ? 'rare' : 'common', articles: [{ sources: [{}] }] }] }));
    },
  };
}
const records = Array.from({ length: 35 }, (_, i) => ({ id: 35 - i,
  executedAt: new Date('2026-11-03T00:00:00Z'), totalArticles: 1, digestText: '' }));

test('same-time pages return every batch once, including scan-bound filtered pages', async () => {
  const source = sourceFor(records); let before; const ids = [];
  do {
    const page = await listFilteredBatchesPageFrom(source, 3, sort, filters, before);
    ids.push(...page.batches.map(b => b.id));
    if (!page.hasMore) break;
    before = parseBatchBoundary(page.nextBefore);
  } while (true);
  assert.deepEqual(ids, records.map(r => r.id));
  const empty = await listFilteredBatchesPageFrom(source, 3, sort, { ...filters, category: 'rare' });
  assert.equal(empty.batches.length, 0); assert.equal(empty.hasMore, true);
  const last = await listFilteredBatchesPageFrom(source, 3, sort, { ...filters, category: 'rare' }, parseBatchBoundary(empty.nextBefore));
  assert.equal(last.batches[0].id, 1); assert.equal(last.hasMore, false);
});

test('Firestore uses exact Timestamp plus document ID, preserving sub-millisecond precision', async () => {
  const calls = [];
  class Timestamp { constructor(seconds, nanoseconds) { Object.assign(this, { seconds, nanoseconds }); }
    toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); } }
  const stamp = new Timestamp(1700000000, 123456789);
  const docs = ['9', '2', '10'].map(id => ({ id, data: () => ({ id: Number(id), executed_at: stamp, total_articles: 1 }) }));
  const query = { orderBy(...args) { calls.push(['orderBy', ...args]); return this; },
    where(...args) { calls.push(['where', ...args]); return this; },
    startAfter(...args) { calls.push(['startAfter', ...args]); return this; },
    limit() { return this; }, async get() { return { docs }; } };
  const fsLoad = modules({ '@google-cloud/firestore': { Timestamp, FieldPath: { documentId: () => '__name__' }, Firestore: class {} } },
    { firestore: { collection: () => query } });
  const backend = fsLoad('@/lib/db.firestore');
  const boundary = { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds, id: '9' };
  const page = await backend.listBatchesPage(2, boundary, new Date('2023-01-01T00:00:00Z'));
  assert.equal(calls.find(c => c[0] === 'orderBy' && c[1] === '__name__')[2], 'desc');
  const after = calls.find(c => c[0] === 'startAfter');
  assert.equal(after[1].nanoseconds, 123456789); assert.equal(after[2], '9');
  assert.equal(page.records[0].cursor.nanoseconds, 123456789);
  assert.equal(page.records[0].cursor.id, '9'); assert.equal(page.hasMore, true);
});

test('Firestore keyset pages cover document ID ties and adjacent nanoseconds', async () => {
  class Timestamp {
    constructor(seconds, nanoseconds) { Object.assign(this, { seconds, nanoseconds }); }
    toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); }
  }
  const docs = ['2', '10', '9', '11', '12', '13', '14'].map((id, i) => ({
    id, stamp: new Timestamp(1700000000, i < 4 ? 123456789 : 123456788),
    data() { return { id: Number(id), executed_at: this.stamp, total_articles: 1 }; },
  }));
  const compare = (a, b) => b.stamp.seconds - a.stamp.seconds || b.stamp.nanoseconds - a.stamp.nanoseconds || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  class Query {
    orderBy() { return this; }
    where() { return this; }
    startAfter(stamp, id) { this.after = { stamp, id }; return this; }
    limit(n) { this.n = n; return this; }
    async get() { return { docs: [...docs].sort(compare).filter(d => !this.after || compare(d, this.after) > 0).slice(0, this.n) }; }
  }
  const fsLoad = modules({ '@google-cloud/firestore': { Timestamp, FieldPath: { documentId: () => '__name__' }, Firestore: class {} } },
    { firestore: { collection: () => new Query() } });
  const backend = fsLoad('@/lib/db.firestore'); let before; const seen = [];
  for (let i = 0; i < 10; i++) {
    const page = await backend.listBatchesPage(2, before);
    seen.push(...page.records.map(r => r.id));
    if (!page.hasMore) break;
    before = parseBatchBoundary(encodeBatchCursor(page.records.at(-1).cursor));
  }
  assert.deepEqual(seen, [...docs].sort(compare).map(d => Number(d.id)));
  assert.equal(new Set(seen).size, 7);
});

test('SQLite keyset covers equal timestamps with a period boundary', async () => {
  const { createRequire } = require('node:module');
  const SQLite = createRequire(require.resolve('@prisma/adapter-better-sqlite3'))('better-sqlite3');
  const db = new SQLite(':memory:');
  try {
    db.exec('CREATE TABLE batches (id INTEGER PRIMARY KEY, executed_at TEXT)');
    const insert = db.prepare('INSERT INTO batches VALUES (?, ?)');
    for (let id = 1; id <= 7; id++) insert.run(id, '2026-11-03 00:00:00');
    insert.run(8, '2026-10-01 00:00:00');
    const prisma = {
      async $queryRaw(parts, ...values) { return db.prepare(parts.join('?')).all(...values); },
      batches: { async findMany({ where, take }) {
        return db.prepare('SELECT * FROM batches ORDER BY executed_at DESC, id DESC').all()
          .filter(r => !where || where.id.in.includes(r.id)).slice(0, take)
          .map(r => ({ ...r, executed_at: new Date(r.executed_at.replace(' ', 'T') + 'Z'), total_articles: 1, digest_text: null }));
      } },
    };
    const sqliteLoad = modules({ '@/generated/prisma/client': {}, '@prisma/adapter-better-sqlite3': {} }, { prisma });
    const backend = sqliteLoad('@/lib/db.sqlite');
    const { cursorFromDate } = load('@/lib/batchCursor');
    let before; const seen = [];
    for (let i = 0; i < 10; i++) {
      const page = await backend.listBatchesPage(3, before, new Date('2026-11-01T00:00:00Z'));
      seen.push(...page.records.map(r => r.id));
      if (!page.hasMore) break;
      const last = page.records.at(-1);
      before = parseBatchBoundary(encodeBatchCursor(cursorFromDate(last.executedAt, String(last.id))));
    }
    assert.deepEqual(seen, [7, 6, 5, 4, 3, 2, 1]);
    const legacy = await backend.listBatchesPage(3, new Date('2026-11-03T00:00:00Z'));
    assert.equal(legacy.records[0].id, 8);
  } finally { db.close(); }
});
