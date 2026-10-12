import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';

const nurse = { id: 'sarah', name: 'Sarah Lee', role: 'nurse', ward: '4B' };
const admin = { id: 'bank', name: 'Alex Tan', role: 'bloodbank', ward: null };
const packet = (now, overrides = {}) => ({ robotId: 'RR-01', deliveryId: 'RR-2048', timestamp: new Date(now).toISOString(), transportStartedAt: new Date(now - 7 * 60000).toISOString(), temperatureC: 4.2, impactG: 0.08, agitationRpm: null, batteryPct: 82, locked: true, status: 'in_transit', etaSeconds: 360, position: { x: 47, y: 58, floor: 'L4', mapId: 'demo-hospital', timestamp: new Date(now).toISOString() }, ...overrides });

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
test('unknown readings preserve an active excursion until measured recovery', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000, { temperatureC: 12 }), 101000);
  s.ingest(packet(102000, { temperatureC: null }), 102000);
  assert.equal(s.snapshot(nurse, 102000).alerts.find(a => a.type === 'temperature').active, true);
});
test('connection loss does not falsely resolve a missing-sensor alert', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000, { temperatureC: null }), 101000);
  assert.equal(s.snapshot(nurse, 120000).alerts.find(a => a.type === 'sensor').active, true);
});
test('robot-source history never includes synthetic simulator readings', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000), 101000);
  assert.equal(s.snapshot(nurse, 101000).deliveries[0].history.length, 1);
});
test('platelet agitation is separate from impact and raises its own alert', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000, { robotId: 'RR-03', deliveryId: 'RR-2050', temperatureC: 22, agitationRpm: 0 }), 101000);
  const d = s.snapshot(admin, 101000).deliveries.find(d => d.id === 'RR-2050');
  assert.equal(d.condition.impact, 'normal');
  assert.equal(d.condition.agitation, 'breach');
});
test('profile changes require supervisor and valid ordered temperature limits', () => {
  const s = createStore({ now: 100000 });
  const p = { minC: 3, maxC: 8, maxImpactG: 1, maxTransportMinutes: 20 };
  assert.throws(() => s.updateProfile('rbc', p, nurse, 100000), /Supervisor/);
  assert.throws(() => s.updateProfile('rbc', { ...p, minC: 10 }, { ...admin, role: 'supervisor' }, 100000), /Invalid/);
  s.updateProfile('rbc', p, { ...admin, role: 'supervisor' }, 100000);
  assert.equal(s.snapshot(nurse, 100000).profiles.rbc.minC, 3);
});
test('incident reporting and resolution are scoped and audited', () => {
  const s = createStore({ now: 100000 });
  assert.throws(() => s.report('RR-2050', 'Obstruction in corridor', nurse, 100000), /access/);
  s.report('RR-2048', 'Obstruction in corridor', nurse, 100000);
  const a = s.snapshot(nurse, 100000).alerts.find(a => a.type === 'incident');
  s.resolve(a.id, nurse, 100000);
  assert.equal(s.snapshot(nurse, 100000).alerts.find(x => x.id === a.id).active, false);
  assert.equal(s.state.audit.at(-1).actor, 'Sarah Lee');
});
test('real telemetry never inherits the fictional dispatch timer', () => {
  const s = createStore({ now: 100000 });
  const p = packet(100000 + 24 * 60000);
  delete p.transportStartedAt;
  s.ingest(p, 100000 + 24 * 60000);
  const snap = s.snapshot(nurse, 100000 + 24 * 60000);
  assert.equal(snap.deliveries[0].startedAt, null);
  assert.equal(snap.deliveries[0].condition.timing, 'unknown');
  assert.equal(snap.alerts.some(a => a.type === 'duration'), false);
  assert.equal(snap.alerts.some(a => a.type === 'timer' && a.active), true);
});
test('missing dispatch time cannot falsely clear a duration excursion', () => {
  const s = createStore({ now: 100000 });
  s.ingest(packet(101000, { transportStartedAt: new Date(101000 - 31 * 60000).toISOString() }), 101000);
  s.ingest(packet(102000, { transportStartedAt: null }), 102000);
  const a = s.snapshot(nurse, 102000).alerts.find(a => a.type === 'duration');
  assert.equal(a.active, true);
  assert.equal(a.resolvedAt, undefined);
});
