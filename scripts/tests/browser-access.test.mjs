import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../supabase/functions/_shared/browser-access.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { validBrowserSession, executionAccessAllowed, hashToken } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const orgId = 'org-a';
const session = () => ({ id: 'session-a', organization_id: orgId, token_hash: '', expires_at: new Date(Date.now() + 60_000).toISOString(), gateway_browser_credentials: { username: 'visitor', revoked: false, valid_from: null, expires_at: null } });
const client = (row, org = { is_active: true, settings: { private_browser_access_enabled: true } }, failure = false) => ({
  from(table) {
    const filters = [];
    return {
      select() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      async maybeSingle() {
        if (failure) return { error: new Error('Database unavailable'), data: null };
        const data = table === 'organizations' ? org : row && filters.every(([k, v]) => row[k] === v) ? row : null;
        return { data, error: null };
      },
    };
  },
});
test('valid session is scoped to the organization and hashed bearer token', async () => {
  const row = session(); row.token_hash = await hashToken('secret-session');
  assert.equal((await validBrowserSession(client(row), orgId, 'secret-session')).username, 'visitor');
  assert.equal(await validBrowserSession(client(row), 'another-org', 'secret-session'), null);
  assert.equal(await validBrowserSession(client(row), orgId, 'wrong-token'), null);
  assert.equal(await validBrowserSession(client(row), orgId), null);
});
test('expired sessions and expired, future or revoked credentials deny access', async () => {
  for (const mutate of [
    row => row.expires_at = new Date(Date.now() - 1000).toISOString(),
    row => row.gateway_browser_credentials.revoked = true,
    row => row.gateway_browser_credentials.expires_at = new Date(Date.now() - 1000).toISOString(),
    row => row.gateway_browser_credentials.valid_from = new Date(Date.now() + 60_000).toISOString(),
  ]) {
    const row = session(); mutate(row);
    assert.equal(await validBrowserSession(client(row), orgId, undefined, row.id), null);
  }
});
test('database failures and deleted sessions fail closed', async () => {
  assert.equal(await validBrowserSession(client(null), orgId, undefined, 'deleted'), null);
  assert.equal(await validBrowserSession(client(session(), undefined, true), orgId, undefined, 'session-a'), null);
});
test('enabling private access invalidates old public processing tokens', async () => {
  assert.equal(await executionAccessAllowed(client(null), { org_id: orgId }), false);
  assert.equal(await executionAccessAllowed(client(null), { org_id: orgId, access_kind: 'public' }), false);
  assert.equal(await executionAccessAllowed(client(null, { is_active: true, settings: {} }), { org_id: orgId }), true);
});
test('browser processing requires a live session and embed processing remains allowed', async () => {
  const row = session();
  assert.equal(await executionAccessAllowed(client(row), { org_id: orgId, access_kind: 'browser', browser_session_id: row.id }), true);
  row.gateway_browser_credentials.revoked = true;
  assert.equal(await executionAccessAllowed(client(row), { org_id: orgId, access_kind: 'browser', browser_session_id: row.id }), false);
  assert.equal(await executionAccessAllowed(client(null), { org_id: orgId, access_kind: 'browser' }), false);
  assert.equal(await executionAccessAllowed(client(null), { org_id: orgId, access_kind: 'embed' }), true);
});
test('inactive organizations and database errors deny processing', async () => {
  assert.equal(await executionAccessAllowed(client(null, { is_active: false, settings: {} }), { org_id: orgId, access_kind: 'embed' }), false);
  assert.equal(await executionAccessAllowed(client(null, undefined, true), { org_id: orgId, access_kind: 'embed' }), false);
});

async function authRequest({ privateAccess = true, sessionRow = null, embedValid = false, body = {} } = {}) {
  let handler;
  const db = client(sessionRow);
  const service = {
    from(table) {
      if (table === 'gateway_browser_sessions') return db.from(table);
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          if (table === 'organizations') return { data: { id: orgId, slug: 'test-org', is_active: true, settings: { private_browser_access_enabled: privateAccess } } };
          return { data: table === 'dataspace_configs' ? { id: 'config-a' } : { features: {} } };
        },
      };
    },
    functions: { async invoke() { return { data: { ok: embedValid, organization_id: orgId } }; } },
  };
  const code = fs.readFileSync(new URL('../../supabase/functions/pdc-auth/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const context = vm.createContext({ serve: h => { handler = h; }, createClient: () => service, validBrowserSession, crypto, TextEncoder, Response, btoa, console, Deno: { env: { get: () => 'test-only' } } });
  vm.runInContext(js, context);
  const response = await handler(new Request('http://localhost/pdc-auth', { method: 'POST', body: JSON.stringify({ action: 'issue_public', org_slug: 'test-org', ...body }) }));
  return { status: response.status, data: await response.json() };
}
test('private token issuer rejects missing, invalid and revoked browser sessions', async () => {
  assert.equal((await authRequest()).status, 401);
  assert.equal((await authRequest({ body: { browser_access_token: 'invalid' } })).status, 401);
  const row = session(); row.token_hash = await hashToken('secret'); row.gateway_browser_credentials.revoked = true;
  assert.equal((await authRequest({ sessionRow: row, body: { browser_access_token: 'secret' } })).status, 401);
});
test('private token issuer binds browser execution to its session and expiry', async () => {
  const row = session(); row.token_hash = await hashToken('secret');
  const result = await authRequest({ sessionRow: row, body: { browser_access_token: 'secret', ttl_seconds: 3600 } });
  assert.equal(result.status, 200);
  const payload = JSON.parse(Buffer.from(result.data.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.access_kind, 'browser');
  assert.equal(payload.browser_session_id, row.id);
  assert.equal(payload.exp, Math.floor(Date.parse(row.expires_at) / 1000));
});
test('private token issuer validates embed tokens and preserves public access when disabled', async () => {
  assert.equal((await authRequest({ body: { embed_token: 'invalid' } })).status, 403);
  const result = await authRequest({ embedValid: true, body: { embed_token: 'valid' } });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(Buffer.from(result.data.token.split('.')[1], 'base64url').toString()).access_kind, 'embed');
  assert.equal((await authRequest({ privateAccess: false })).status, 200);
});
