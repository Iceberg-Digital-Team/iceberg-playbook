import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/transpile.mjs';

const { createApiClient } = await importTs('src/lib/apiClient.ts', 'api-client');

function setup(handler) {
  const calls = [];
  const store = new Map();
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    fetch: async (url, init = {}) => {
      const call = { url: String(url), method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body };
      calls.push(call);
      return handler(call, calls.length);
    },
  });
  return { client, calls, store };
}

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = { access_token: 'A1', refresh_token: 'R1', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@b.co' } };

test('query builder serializes filters, order, mode and returning', async () => {
  const { client, calls } = setup(() => reply({ data: [], error: null }));
  await client.from('issues').select('id, title').eq('playbook_id', 'wa').is('deleted_at', null).not('status', 'is', null).or('code.eq.A,slug.eq.B').order('created_at', { ascending: false }).limit(5).maybeSingle();
  const spec = JSON.parse(calls[0].body);
  assert.equal(calls[0].url, 'http://api.test/rest/v1/query');
  assert.deepEqual(spec.filters, [
    { column: 'playbook_id', op: 'eq', value: 'wa' },
    { column: 'deleted_at', op: 'is', value: null },
    { column: 'status', op: 'is', value: null, negate: true },
  ]);
  assert.deepEqual(spec.or, ['code.eq.A,slug.eq.B']);
  assert.deepEqual(spec.order, [{ column: 'created_at', ascending: false }]);
  assert.equal(spec.mode, 'maybe');
  assert.equal(spec.limit, 5);
  assert.equal(spec.returning, true);
});

test('insert returns data only when select() is chained', async () => {
  const { client, calls } = setup(() => reply({ data: null, error: null }));
  await client.from('media_files').insert({ a: 1 });
  await client.from('issues').insert({ a: 1 }).select('id').single();
  assert.equal(JSON.parse(calls[0].body).returning, false);
  assert.equal(JSON.parse(calls[1].body).returning, true);
  assert.equal(JSON.parse(calls[1].body).mode, 'single');
});

test('database errors are returned, never thrown', async () => {
  const { client } = setup(() => reply({ data: null, error: { code: '42501', message: 'denied' } }, 400));
  const { data, error } = await client.from('issues').select('*');
  assert.equal(data, null);
  assert.equal(error.code, '42501');
});

test('rpc posts the arguments to the function endpoint', async () => {
  const { client, calls } = setup(() => reply({ data: 'WA-007', error: null }));
  const { data } = await client.rpc('fn_generate_issue_code', { p_playbook_id: 'whatsapp' });
  assert.equal(data, 'WA-007');
  assert.equal(calls[0].url, 'http://api.test/rest/v1/rpc/fn_generate_issue_code');
  assert.deepEqual(JSON.parse(calls[0].body), { p_playbook_id: 'whatsapp' });
});

test('sign in stores the session and requests carry the Bearer token', async () => {
  const { client, calls, store } = setup(call => call.url.includes('/auth/v1/token') ? reply(session) : reply({ data: [], error: null }));
  const result = await client.auth.signInWithPassword({ email: 'a@b.co', password: 'pw' });
  assert.equal(result.error, null);
  assert.ok(store.get('iceberg-playbook.session'));
  await client.from('issues').select('id');
  assert.equal(calls[1].headers.get('authorization'), 'Bearer A1');
});

test('a 401 triggers one refresh and a retry; a rejected refresh signs out', async () => {
  let queryCalls = 0;
  const { client, calls, store } = setup(call => {
    if (call.url.includes('grant_type=password')) return reply(session);
    if (call.url.includes('grant_type=refresh_token')) return reply({ ...session, access_token: 'A2' });
    queryCalls += 1;
    return queryCalls === 1 ? reply({ data: null, error: { message: 'expired' } }, 401) : reply({ data: [{ id: 1 }], error: null });
  });
  await client.auth.signInWithPassword({ email: 'a@b.co', password: 'pw' });
  const { data } = await client.from('issues').select('id');
  assert.deepEqual(data, [{ id: 1 }]);
  assert.equal(calls.at(-1).headers.get('authorization'), 'Bearer A2');

  const dead = setup(call => call.url.includes('grant_type=password') ? reply(session) : call.url.includes('grant_type=refresh_token') ? reply({ error: 'invalid_grant' }, 401) : reply({ data: null, error: { message: 'expired' } }, 401));
  await dead.client.auth.signInWithPassword({ email: 'a@b.co', password: 'pw' });
  await dead.client.from('issues').select('id');
  assert.equal(dead.store.get('iceberg-playbook.session') ?? null, null);
  assert.equal(store.size, 1);
});

test('failed sign in returns the server message', async () => {
  const { client, store } = setup(() => reply({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400));
  const { error } = await client.auth.signInWithPassword({ email: 'a@b.co', password: 'bad' });
  assert.equal(error.message, 'Invalid login credentials');
  assert.equal(store.size, 0);
});

test('functions.invoke maps HTTP failures to FunctionsHttpError with the Response as context', async () => {
  const { client } = setup(() => reply({ error: { code: 'forbidden' } }, 403));
  const { error } = await client.functions.invoke('admin-users/users', { method: 'GET' });
  assert.equal(error.name, 'FunctionsHttpError');
  assert.equal(error.context.status, 403);
});

test('storage signed urls are absolute', async () => {
  const { client } = setup(() => reply({ signedURL: '/storage/v1/object/signed/support-assets/a.mp4?token=t' }));
  const { data } = await client.storage.from('support-assets').createSignedUrl('a.mp4', 60);
  assert.equal(data.signedUrl, 'http://api.test/storage/v1/object/signed/support-assets/a.mp4?token=t');
});
