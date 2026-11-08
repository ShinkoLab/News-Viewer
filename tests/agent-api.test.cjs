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

const secret = 'test-only-key-not-for-deployment-000000000000';
const fixtureDate = new Date('2026-11-08T00:00:00Z');
function api(env = {}, overrides = {}) {
  const calls = [];
  const deps = {
    async listCategoryOptions() { calls.push('categories'); return ['synthetic']; },
    async listFilteredBatchesPage() { calls.push('batches'); return { batches: [], hasMore: true, nextBefore: 'opaque' }; },
    async getBatch() { calls.push('batch'); return null; },
    async hydrateBatches() { return []; },
    async searchArticles() { calls.push('search'); return { query: 'test', results: [], degraded: true, truncated: true }; },
    ...overrides,
  };
  const load = modules({ '@/lib/db': {}, '@/lib/search': {} },
    { process: { env: {} }, Response, URL });
  return {
    calls, load, deps,
    handle: load('@/lib/agentApi').createAgentApi(deps, { NEWS_API_KEY: secret, DB_BACKEND: 'sqlite', ...env }, () => fixtureDate.getTime()),
  };
}
function req(path, key = secret, method = 'GET') {
  return new Request('http://localhost/api/v1/' + path, { method, headers: { 'x-news-api-key': key } });
}
test('disabled/unauthorized APIs do not access storage, even for malformed requests', async () => {
  for (const [env, key, expected] of [[{ NEWS_API_KEY: '' }, secret, 503], [{}, '', 401], [{}, 'wrong', 401]]) {
    const a = api(env);
    const r = await a.handle(req('batches?limit=-1', key), ['batches']);
    assert.equal(r.status, expected);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(a.calls, []);
  }
});
test('reject invalid inputs and methods before data access', async () => {
  for (const [url, path] of [
    ['batches?limit=11', ['batches']], ['batches?before=broken', ['batches']],
    ['batches?period=tomorrow', ['batches']], ['batches?limit=1&limit=2', ['batches']],
    ['batches/1e3', ['batches', '1e3']], ['categories?unknown=x', ['categories']],
    ['search?q=', ['search']],
  ]) {
    const a = api(); assert.equal((await a.handle(req(url), path)).status, 400); assert.deepEqual(a.calls, []);
  }
  const a = api();
  assert.equal((await a.handle(req('categories', secret, 'POST'), ['categories'])).status, 405);
  assert.deepEqual(a.calls, []);
});
test('Firestore search requires explicit opt-in; SQLite does not', async () => {
  const a = api({ DB_BACKEND: 'firestore' });
  assert.equal((await a.handle(req('search?q=test'), ['search'])).status, 403);
  assert.deepEqual(a.calls, []);
  for (const env of [{}, { DB_BACKEND: 'firestore', NEWS_API_ALLOW_FIRESTORE_SEARCH: 'true' }]) {
    const b = api(env), r = await b.handle(req('search?q=test'), ['search']);
    const body = await r.json();
    assert.equal(r.status, 200); assert.equal(body.truncated, true); assert.equal(body.degraded, true);
    assert.deepEqual(b.calls, ['search']);
  }
});
test('empty scan window retains continuation; errors do not leak upstream details', async () => {
  const a = api();
  const body = await (await a.handle(req('batches'), ['batches'])).json();
  assert.equal(body.nextBefore, 'opaque'); assert.equal(body.meta.scanLimited, true);
  const b = api({}, { async listCategoryOptions() { throw new Error('private credential /db/path'); } });
  const r = await b.handle(req('categories'), ['categories']);
  assert.equal(r.status, 503); assert.equal(await r.text(), '{"error":{"code":"upstream_unavailable"}}');
});
test('shared per-process rate budget returns 429 without more data reads', async () => {
  const a = api();
  for (let i = 0; i < 60; i++) assert.equal((await a.handle(req('categories'), ['categories'])).status, 200);
  const r = await a.handle(req('categories'), ['categories']);
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60'); assert.equal(a.calls.length, 60);
});
for (const backend of ['firestore', 'sqlite']) {
  test(backend + ' synthetic records preserve dates, source IDs and batch status through the API', async () => {
    const a = api({ DB_BACKEND: backend });
    const load = modules({
      '@google-cloud/firestore': { Firestore: class {} },
      '@/generated/prisma/client': {}, '@prisma/adapter-better-sqlite3': {},
    }, { process: { env: {} } });
    const row = { id: 5, batch_id: 1, category: 'synthetic', group_id: null, group_topic: null,
      summary_title: 'summary', summary_text: 'synthetic text', keywords: '["test"]',
      original_url: 'https://example.com/story', original_title: 'source', feed_title: 'fixture',
      published_at: fixtureDate, created_at: fixtureDate };
    const record = backend === 'sqlite'
      ? load('@/lib/db.sqlite').toArticleRecord(row)
      : load('@/lib/db.firestore').mapArticle('5', { ...row, published_at: { toDate: () => fixtureDate } });
    const batch = { id: 1, executedAt: fixtureDate, totalArticles: 1, digestText: 'fixture', status: 'partial' };
    const shared = load('@/lib/db.shared');
    const hydrated = shared.buildBatchesWithArticles([batch], [record], { mode: 'name', order: [] });
    const b = api({ DB_BACKEND: backend }, { async getBatch() { return batch; }, async hydrateBatches() { return hydrated; } });
    const r = await b.handle(req('batches/1/articles/5'), ['batches', '1', 'articles', '5']);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.article.publishedAt, fixtureDate.toISOString());
    assert.equal(body.article.storedAt, fixtureDate.toISOString());
    assert.equal(body.article.fetchedAt, null);
    assert.equal(body.article.sources[0].originalUrl, row.original_url);
    assert.equal(body.article.fullTextAvailable, false);
    const batchResponse = await (await b.handle(req('batches/1'), ['batches', '1'])).json();
    assert.equal(batchResponse.batch.status, 'partial');
    assert.equal((await a.handle(req('batches/99'), ['batches', '99'])).status, 404);
    assert.equal((await b.handle(req('batches/1/articles/missing'), ['batches', '1', 'articles', 'missing'])).status, 404);
  });
}
