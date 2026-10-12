import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';

const nurse = { id: 'sarah', name: 'Sarah Lee', role: 'nurse', ward: '4B' };
const admin = { id: 'bank', name: 'Alex Tan', role: 'bloodbank', ward: null };
const packet = (now, overrides = {}) => ({ robotId: 'RR-01', deliveryId: 'RR-2048', timestamp: new Date(now).toISOString(), temperatureC: 4.2, impactG: 0.08, agitationRpm: null, batteryPct: 82, locked: true, status: 'in_transit', etaSeconds: 360, position: { x: 47, y: 58, floor: 'L4', mapId: 'demo-hospital', timestamp: new Date(now).toISOString() }, ...overrides });

test('ward visibility is enforced in the store', () => {
  const s = createStore({ now: 100000 });
  assert.deepEqual(s.snapshot(nurse, 100000).deliveries.map(d => d.id), ['RR-2048', 'RR-2049']);
  assert.equal(s.snapshot(admin, 100000).deliveries.length, 3);
});
test('telemetry rejects invalid fields and out-of-order updates', () => {
  const s = createStore({ now: 100000 });
  assert.throws(() => s.ingest(packet(100000, { temperatureC: 'hot' }), 100000), /temperature/);
  assert.throws(() => s.ingest(packet(100000, { position: { x: 200, y: 20 } }), 100000), /position/);
  s.ingest(packet(101000), 101000);
  assert.throws(() => s.ingest(packet(100000), 101000), /order/);
});
test('missing readings and stale location never appear normal', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000, { temperatureC: null, position: null }), 101000);
  const d = s.snapshot(nurse, 101000).deliveries[0];
  assert.equal(d.condition.temperature, 'unknown');
  assert.equal(d.condition.location, 'unknown');
  assert.equal(s.snapshot(nurse, 120000).deliveries[0].condition.connection, 'stale');
});
test('excursions deduplicate, acknowledgement does not resolve, recovery does', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000, { temperatureC: 12 }), 101000);
  s.ingest(packet(102000, { temperatureC: 12 }), 102000);
  let alerts = s.snapshot(nurse, 102000).alerts.filter(a => a.type === 'temperature');
  assert.equal(alerts.length, 1);
  s.acknowledge(alerts[0].id, nurse, 102000);
  assert.equal(s.snapshot(nurse, 102000).alerts.find(a => a.id === alerts[0].id).active, true);
  s.ingest(packet(103000), 103000);
  assert.equal(s.snapshot(nurse, 103000).alerts.find(a => a.id === alerts[0].id).active, false);
});
test('receipt checks unit, ward, arrival and telemetry conditions', () => {
  const s = createStore({ now: 100000 });
  assert.throws(() => s.receive('RR-2048', 'RBC-008421', nurse, 100000), /arriv/);
  s.ingest(packet(101000, { status: 'arrived', etaSeconds: 0 }), 101000);
  assert.throws(() => s.receive('RR-2048', 'WRONG', nurse, 101000), /match/);
  s.receive('RR-2048', 'RBC-008421', nurse, 101000);
  assert.equal(s.snapshot(nurse, 101000).deliveries[0].status, 'delivered');
  assert.throws(() => s.receive('RR-2048', 'RBC-008421', nurse, 101000), /already/);
});
test('simulator cannot overwrite robot-source telemetry', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000), 101000);
  assert.throws(() => s.scenario('RR-2048', 'temperature', admin, 102000), /robot/);
  s.simulate(102000);
  assert.equal(s.snapshot(nurse, 102000).deliveries[0].source, 'robot');
  assert.equal(s.snapshot(nurse, 102000).deliveries[0].temperatureC, 4.2);
});
