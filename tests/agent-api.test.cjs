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
test('SQLite rows with unparseable dates map to null instead of throwing', () => {
  const load = modules({ '@/generated/prisma/client': {}, '@prisma/adapter-better-sqlite3': {} },
    { process: { env: {} } });
  const record = load('@/lib/db.sqlite').toArticleRecord({
    id: 7, batch_id: 1, category: 'synthetic', group_id: null, group_topic: null,
    summary_title: 'summary', summary_text: 'synthetic text', keywords: '[]',
    original_url: null, original_title: 'source', feed_title: null,
    // Prisma returns Invalid Date for TEXT it cannot parse; toISOString() would throw RangeError.
    published_at: new Date('not a date'), created_at: new Date(Number.NaN),
  });
  assert.equal(record.publishedAt, null);
  assert.equal(record.storedAt, null);
});
test('SQLite search candidates use plain positional SQL (no cross-bundle Prisma.sql fragments)', () => {
  const { createRequire } = require('node:module');
  const SQLite = createRequire(require.resolve('@prisma/adapter-better-sqlite3'))('better-sqlite3');
  const sqlite = new SQLite(':memory:');
  sqlite.exec(`CREATE TABLE batches (id INTEGER PRIMARY KEY, executed_at TEXT);
    CREATE TABLE article_summaries (id INTEGER PRIMARY KEY, batch_id INTEGER, category TEXT,
      summary_title TEXT, summary_text TEXT, keywords TEXT);
    INSERT INTO batches VALUES (1, '2026-10-01 00:00:00'), (2, '2026-11-07 00:00:00');
    INSERT INTO article_summaries VALUES
      (1, 1, 'A', 'old 50% story', '', '[]'),
      (2, 2, 'A', 'new 50% story', '', '[]'),
      (3, 2, 'B', 'new 50% other category', '', '[]'),
      (4, 2, 'A', '5000 percent, not a literal match', '', '[]'),
      (5, 2, 'A', 'keyword only', '', '["AI"]'),
      (6, 2, 'A', 'keyword substring only', '', '["OpenAI"]');`);
  const load = modules({ '@/generated/prisma/client': {}, '@prisma/adapter-better-sqlite3': {} },
    { process: { env: {} } });
  const { buildCandidateQuery } = load('@/lib/search.sqlite');
  const ids = (terms, filters, since) => {
    const { sql, params } = buildCandidateQuery(terms, filters, since);
    for (const term of terms) assert.ok(!sql.includes(term), 'user input must be bound, not concatenated');
    return sqlite.prepare(sql).all(...params).map((r) => r.id);
  };
  // `%` is matched literally (row 4 would match an unescaped LIKE); newest batch first.
  assert.deepEqual(ids(['50%'], { category: null }, undefined), [2, 3, 1]);
  assert.deepEqual(ids(['50%'], { category: 'A' }, new Date('2026-11-01T00:00:00Z')), [2]);
  // Keywords match whole JSON elements only.
  assert.deepEqual(ids(['AI'], { category: null }, undefined), [5]);
  // Several terms are OR-ed together.
  assert.deepEqual(ids(['old', 'keyword only'], { category: null }, undefined), [5, 1]);
  sqlite.close();
});

// ---------------------------------------------------------------- MCP (/mcp) and agent-only mode
function mcpSetup(env = {}, overrides = {}) {
  const base = api(env, overrides);
  const load = modules({ '@/lib/db': {}, '@/lib/search': {} },
    { process: { env: {} }, Response, URL, TextDecoder });
  const { createAgentCore, createRestHandler, newBudgets } = load('@/lib/agentApi');
  const fullEnv = { NEWS_API_KEY: secret, DB_BACKEND: 'sqlite', ...env };
  const core = createAgentCore(base.deps, fullEnv, () => fixtureDate.getTime(), newBudgets());
  return { calls: base.calls, mcp: load('@/lib/agentMcp').createMcpHandler(core, fullEnv), rest: createRestHandler(core) };
}
function rpc(method, params, { id = 1, notification = false, headers = { authorization: 'Bearer ' + secret }, raw } = {}) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: raw ?? JSON.stringify(notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
  });
}
const callTool = (name, args, opts) => rpc('tools/call', { name, arguments: args }, opts);
const toolPayload = async (r) => { const b = await r.json(); return { isError: b.result.isError, data: JSON.parse(b.result.content[0].text) }; };

test('REST accepts Authorization: Bearer as well as X-News-Api-Key', async () => {
  const { rest, calls } = mcpSetup();
  const bearer = (v) => new Request('http://localhost/api/v1/categories', { headers: { authorization: v } });
  assert.equal((await rest(bearer('Bearer ' + secret), ['categories'])).status, 200);
  assert.equal((await rest(bearer('bearer ' + secret), ['categories'])).status, 200);
  for (const bad of ['Bearer wrong', 'Basic ' + secret, secret, 'Bearer ' + secret + ' extra', 'Bearer']) {
    assert.equal((await rest(bearer(bad), ['categories'])).status, 401, bad);
  }
  assert.deepEqual(calls, ['categories', 'categories']);
});

test('MCP initialize negotiates the protocol version and needs no key', async () => {
  const { mcp, calls } = mcpSetup();
  for (const [requested, expected] of [['2025-06-18', '2025-06-18'], ['2025-11-25', '2025-11-25'], ['1999-01-01', '2025-11-25'], [undefined, '2025-11-25']]) {
    const r = await mcp(rpc('initialize', { protocolVersion: requested, capabilities: {}, clientInfo: { name: 't', version: '1' } }, { headers: {} }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('mcp-session-id'), null);
    const body = await r.json();
    assert.equal(body.result.protocolVersion, expected);
    assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
    assert.equal(body.result.serverInfo.version, 'v1');
  }
  assert.deepEqual(calls, []);
});

test('MCP transport rules: POST only, notifications 202, JSON-RPC errors', async () => {
  const { mcp } = mcpSetup();
  for (const method of ['GET', 'DELETE']) {
    const r = await mcp(new Request('http://localhost/mcp', { method }));
    assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'POST');
  }
  assert.equal((await mcp(rpc('notifications/initialized', undefined, { notification: true }))).status, 202);
  const parse = await mcp(rpc(null, null, { raw: '{not json' }));
  assert.equal(parse.status, 400); assert.equal((await parse.json()).error.code, -32700);
  const batch = await mcp(rpc(null, null, { raw: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]) }));
  assert.equal(batch.status, 400); assert.equal((await batch.json()).error.code, -32600);
  const big = await mcp(rpc(null, null, { raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70000) } }) }));
  assert.equal(big.status, 413);
  assert.deepEqual((await (await mcp(rpc('ping', {}))).json()).result, {});
  assert.equal((await (await mcp(rpc('resources/list', {}))).json()).error.code, -32601);
  assert.equal((await (await mcp(callTool('drop_tables', {}))).json()).error.code, -32602);
});

test('MCP tools/list works without a key and advertises read-only tools', async () => {
  const { mcp, calls } = mcpSetup();
  const body = await (await mcp(rpc('tools/list', {}, { headers: {} }))).json();
  assert.deepEqual(body.result.tools.map(t => t.name),
    ['search_news', 'list_categories', 'list_batches', 'get_batch', 'get_article']);
  for (const tool of body.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(calls, []);
});

test('MCP tools/call requires the key and never touches storage without it', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-news-api-key': 'wrong' }]) {
    const { mcp, calls } = mcpSetup();
    const r = await mcp(callTool('list_categories', {}, { headers }));
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('www-authenticate'), null);
    assert.equal((await r.json()).error.code, -32001);
    assert.deepEqual(calls, []);
  }
  const disabled = mcpSetup({ NEWS_API_KEY: '' });
  assert.equal((await disabled.mcp(callTool('list_categories', {}))).status, 503);
  assert.deepEqual(disabled.calls, []);
});

test('MCP tools return the REST payloads with Bearer or X-News-Api-Key', async () => {
  const { mcp, calls } = mcpSetup();
  const cats = await toolPayload(await mcp(callTool('list_categories', {})));
  assert.equal(cats.isError, false); assert.deepEqual(cats.data.categories, ['synthetic']);
  const viaHeader = await toolPayload(await mcp(callTool('list_categories', undefined, { headers: { 'x-news-api-key': secret } })));
  assert.deepEqual(viaHeader.data.categories, ['synthetic']);
  const found = await toolPayload(await mcp(callTool('search_news', { q: 'test', period: 'all' })));
  assert.equal(found.data.degraded, true);
  const page = await toolPayload(await mcp(callTool('list_batches', { limit: 2 })));
  assert.equal(page.data.nextBefore, 'opaque');
  assert.deepEqual(calls, ['categories', 'categories', 'search', 'batches']);
});

test('MCP input errors are tool errors and do not read storage', async () => {
  for (const [name, args, code] of [
    ['list_batches', { limit: 11 }, 'invalid_limit'],
    ['list_batches', { limit: 1.5 }, 'invalid_parameters'],
    ['list_batches', { period: 'tomorrow' }, 'invalid_period'],
    ['list_categories', { extra: 'x' }, 'invalid_parameters'],
    ['search_news', {}, 'invalid_query'],
    ['search_news', { q: true }, 'invalid_parameters'],
    ['get_batch', { batch_id: 'abc' }, 'invalid_batch_id'],
    ['get_batch', {}, 'invalid_batch_id'],
    ['get_article', { batch_id: 1, article_id: '../x' }, 'invalid_article_id'],
    ['list_categories', [], 'invalid_parameters'],
  ]) {
    const { mcp, calls } = mcpSetup();
    const r = await mcp(callTool(name, args));
    assert.equal(r.status, 200, name);
    const out = await toolPayload(r);
    assert.equal(out.isError, true, name); assert.equal(out.data.error.code, code, name + ' ' + JSON.stringify(args));
    assert.deepEqual(calls, [], name);
  }
  const notFound = mcpSetup();
  assert.equal((await toolPayload(await notFound.mcp(callTool('get_batch', { batch_id: 99 })))).data.error.code, 'batch_not_found');
});

test('MCP hides upstream failures and Firestore search still needs opt-in', async () => {
  const leak = mcpSetup({}, { async listCategoryOptions() { throw new Error('private credential /db/path'); } });
  const r = await leak.mcp(callTool('list_categories', {}));
  const text = await r.text();
  assert.ok(!text.includes('private') && !text.includes('/db/path'));
  assert.equal(JSON.parse(JSON.parse(text).result.content[0].text).error.code, 'upstream_unavailable');
  const fs = mcpSetup({ DB_BACKEND: 'firestore' });
  assert.equal((await toolPayload(await fs.mcp(callTool('search_news', { q: 'x' })))).data.error.code, 'firestore_search_not_enabled');
  assert.deepEqual(fs.calls, []);
});

test('REST and MCP share one rate budget', async () => {
  const { mcp, rest, calls } = mcpSetup();
  for (let i = 0; i < 59; i++) assert.equal((await rest(req('categories'), ['categories'])).status, 200);
  assert.equal((await mcp(callTool('list_categories', {}))).status, 200);
  const limited = await mcp(callTool('list_categories', {}));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await rest(req('categories'), ['categories'])).status, 429);
  assert.equal(calls.length, 60);
});

test('agent-only proxy exposes only /mcp and /api/v1', () => {
  const { NextRequest } = require('next/server');
  const load = (env) => modules({}, { process: { env } })('@/lib/../proxy');
  const status = (proxy, path) => {
    const r = proxy(new NextRequest('http://localhost' + path));
    return r.headers.get('x-middleware-next') === '1' ? 'next' : r.status;
  };
  const on = load({ NEWS_AGENT_ONLY: 'true' }).proxy;
  for (const path of ['/mcp', '/api/v1/categories', '/api/v1/batches/1/articles/2']) assert.equal(status(on, path), 'next', path);
  for (const path of ['/', '/search?q=x', '/batches/1', '/api/batches', '/api/v1', '/api/v1x/categories',
    '/mcp/x', '/MCP', '/_next/static/chunks/app.js', '/_next/data/b/index.json', '/favicon.ico',
    '/api/v1/../batches', '/api/v1/%2e%2e/batches']) {
    assert.equal(status(on, path), 404, path);
  }
  for (const env of [{}, { NEWS_AGENT_ONLY: 'false' }, { NEWS_AGENT_ONLY: '1' }]) {
    const off = load(env).proxy;
    for (const path of ['/', '/search', '/api/batches']) assert.equal(status(off, path), 'next', path);
  }
});

test('MCP caps the body while streaming, even without Content-Length', async () => {
  const { mcp } = mcpSetup();
  const declared = await mcp(new Request('http://localhost/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '70000' }, body: '{}' }));
  assert.equal(declared.status, 413);
  let pulled = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulled++; controller.enqueue(new Uint8Array(16 * 1024).fill(32));
    if (pulled > 100) controller.close();
  } });
  const chunked = await mcp(new Request('http://localhost/mcp', { method: 'POST', body: stream, duplex: 'half',
    headers: { 'content-type': 'application/json' } }));
  assert.equal(chunked.status, 413);
  assert.ok(pulled <= 6, 'stopped reading soon after the limit, pulled ' + pulled);
});

test('MCP rejects browser Origins unless allow-listed', async () => {
  const blocked = mcpSetup();
  const r = await blocked.mcp(rpc('tools/list', {}, { headers: { origin: 'http://evil.example' } }));
  assert.equal(r.status, 403);
  const allowed = mcpSetup({ NEWS_MCP_ALLOWED_ORIGINS: 'https://a.example, http://evil.example' });
  assert.equal((await allowed.mcp(rpc('tools/list', {}, { headers: { origin: 'http://evil.example' } }))).status, 200);
});

test('anonymous MCP traffic has its own budget and cannot exhaust keyed calls', async () => {
  const { mcp, calls } = mcpSetup();
  for (let i = 0; i < 60; i++) assert.equal((await mcp(rpc('tools/list', {}, { headers: {} }))).status, 200);
  const anon = await mcp(rpc('tools/list', {}, { headers: {} }));
  assert.equal(anon.status, 429); assert.equal(anon.headers.get('retry-after'), '60');
  assert.equal((await mcp(callTool('list_categories', {}, { headers: {} }))).status, 429);
  assert.equal((await mcp(rpc('tools/list', {}))).status, 200);
  assert.equal((await toolPayload(await mcp(callTool('list_categories', {})))).isError, false);
  assert.deepEqual(calls, ['categories']);
});

test('MCP null arguments: allowed for known names, rejected for unknown names', async () => {
  const known = mcpSetup();
  const ok = await toolPayload(await known.mcp(callTool('list_batches', { before: null, limit: null })));
  assert.equal(ok.isError, false);
  const unknown = mcpSetup();
  const bad = await toolPayload(await unknown.mcp(callTool('list_batches', { limt: null })));
  assert.equal(bad.data.error.code, 'invalid_parameters');
  assert.deepEqual(unknown.calls, []);
});
