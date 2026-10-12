import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('HTTP session, scoped data, telemetry authentication and handover workflow', async t => {
  const { server } = createApp({ persist: false, simulate: false, token: 'test-token' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, body, cookie, token) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await req('/api/state')).status, 401);
  const login = await req('/api/session', { staffId: 'sarah' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const state = await (await req('/api/state', null, cookie)).json();
  assert.equal(state.deliveries.length, 2);
  assert.equal((await req('/api/deliveries/RR-2050/incident', { message: 'Cannot access another ward' }, cookie)).status, 400);
  assert.equal((await req('/api/telemetry', { anything: true })).status, 401);
  const now = new Date().toISOString();
  const packet = { robotId: 'RR-01', deliveryId: 'RR-2048', timestamp: now, temperatureC: 4.2, impactG: .1, agitationRpm: null, batteryPct: 80, locked: true, etaSeconds: 0, status: 'arrived', position: { x: 84, y: 78, floor: 'L4', mapId: 'demo-hospital', timestamp: now } };
  assert.equal((await req('/api/telemetry', packet, null, 'test-token')).status, 200);
  assert.equal((await req('/api/deliveries/RR-2048/receive', { code: 'RBC-008421' }, cookie)).status, 200);
  const after = await (await req('/api/state', null, cookie)).json();
  assert.equal(after.deliveries[0].status, 'delivered');
  assert.equal((await req('/api/logout', {}, cookie)).status, 200);
  assert.equal((await req('/api/state', null, cookie)).status, 401);
});
