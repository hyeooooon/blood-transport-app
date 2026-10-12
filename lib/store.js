import { randomUUID } from 'node:crypto';

export const STAFF = {
  sarah: { id: 'sarah', name: 'Sarah Lee', role: 'nurse', ward: '4B', title: 'Ward nurse' },
  maya: { id: 'maya', name: 'Maya Lim', role: 'nurse', ward: '6A', title: 'Ward nurse' },
  alex: { id: 'alex', name: 'Alex Tan', role: 'bloodbank', ward: null, title: 'Blood bank' },
  jordan: { id: 'jordan', name: 'Jordan Chen', role: 'supervisor', ward: null, title: 'Supervisor' }
};
export const STALE_MS = 15000;
const iso = n => new Date(n).toISOString();
const canSee = (u, d) => !!u && (u.role !== 'nurse' || u.ward === d.ward);
const numeric = (v, min, max) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);

function seed(now) {
  const profiles = {
    rbc: { name: 'Red blood cells', minC: 2, maxC: 10, maxImpactG: 2, minRpm: null, maxRpm: null, maxTransportMinutes: 30 },
    platelets: { name: 'Platelets', minC: 20, maxC: 24, maxImpactG: 2, minRpm: 40, maxRpm: 70, maxTransportMinutes: 30 }
  };
  const deliveries = [
    { id: 'RR-2048', robotId: 'RR-01', ward: '4B', destination: 'Ward 4B', department: 'Obstetrics', product: 'rbc', units: 2, unitCode: 'RBC-008421', priority: 'Urgent', status: 'in_transit', temperatureC: 4.2, impactG: .08, agitationRpm: null, batteryPct: 82, locked: true, etaSeconds: 360, position: { x: 47, y: 58, floor: 'L4', mapId: 'demo-hospital', timestamp: iso(now) }, startedAt: iso(now - 7 * 60000) },
    { id: 'RR-2049', robotId: 'RR-02', ward: '4B', destination: 'Ward 4B', department: 'Obstetrics', product: 'rbc', units: 1, unitCode: 'RBC-008422', priority: 'Routine', status: 'preparing', temperatureC: 4.3, impactG: .06, agitationRpm: null, batteryPct: 96, locked: true, etaSeconds: 720, position: { x: 17, y: 24, floor: 'L4', mapId: 'demo-hospital', timestamp: iso(now) }, startedAt: null },
    { id: 'RR-2050', robotId: 'RR-03', ward: '6A', destination: 'Ward 6A', department: 'Haematology', product: 'platelets', units: 1, unitCode: 'PLT-004103', priority: 'Routine', status: 'in_transit', temperatureC: 22.1, impactG: .1, agitationRpm: 55, batteryPct: 74, locked: true, etaSeconds: 540, position: { x: 47, y: 58, floor: 'L4', mapId: 'demo-hospital', timestamp: iso(now) }, startedAt: iso(now - 4 * 60000) }
  ].map(d => ({ ...d, source: 'simulator', lastSeen: iso(now), scenario: 'normal', history: Array.from({ length: 30 }, (_, i) => ({ timestamp: iso(now - (29 - i) * 10000), temperatureC: +(d.temperatureC + Math.sin(i * .7) * .14).toFixed(2), impactG: .08 + Math.abs(Math.sin(i)) * .07 })), timeline: [{ id: randomUUID(), timestamp: iso(now - 8 * 60000), title: 'Delivery requested', detail: 'Blood bank → ' + d.destination, actor: 'Demo workflow' }, ...(d.startedAt ? [{ id: randomUUID(), timestamp: d.startedAt, title: 'Dispatched', detail: 'Unit verified and compartment secured', actor: 'Alex Tan' }] : [])] }));
  return { version: 1, profiles, deliveries, alerts: [], audit: [] };
}

export function createStore({ now = Date.now(), initial } = {}) {
  const state = initial || seed(now);
  function access(id, user) {
    const d = state.deliveries.find(d => d.id === id);
    if (!d || !canSee(user, d)) throw new Error('Delivery not found or access denied');
    return d;
  }
  function record(d, title, detail, actor, time) {
    const event = { id: randomUUID(), timestamp: iso(time), title, detail, actor };
    d.timeline.push(event);
    state.audit.push({ ...event, deliveryId: d.id });
  }
  function condition(d, time) {
    const p = state.profiles[d.product];
    const stale = time - Date.parse(d.lastSeen) > STALE_MS;
    const locStale = !d.position || time - Date.parse(d.position.timestamp) > STALE_MS;
    const verdict = (value, ok) => stale || value === null ? 'unknown' : ok ? 'normal' : 'breach';
    return {
      connection: stale ? 'stale' : 'connected',
      timing: d.source === 'robot' && d.status !== 'preparing' && !d.startedAt ? 'unknown' : 'normal',
      location: locStale ? 'unknown' : 'normal',
      temperature: verdict(d.temperatureC, d.temperatureC >= p.minC && d.temperatureC <= p.maxC),
      impact: verdict(d.impactG, d.impactG <= p.maxImpactG),
      agitation: p.minRpm === null ? 'not_required' : verdict(d.agitationRpm, d.agitationRpm >= p.minRpm && d.agitationRpm <= p.maxRpm),
      lock: verdict(d.locked, d.locked === true),
      battery: verdict(d.batteryPct, d.batteryPct >= 20)
    };
  }
  function evaluate(time) {
    for (const d of state.deliveries) {
      if (d.status === 'delivered') continue;
      const c = condition(d, time), p = state.profiles[d.product];
      const checks = {
        connection: [c.connection === 'stale', 'Telemetry connection lost', 'No robot updates for more than 15 seconds. Contact the transport team.'],
        location: [c.location === 'unknown', 'Location unavailable', 'Current position is missing or stale. Last known position is retained.'],
        temperature: [c.temperature === 'breach', 'Temperature outside profile', `Chamber reading ${d.temperatureC}°C; configured example range ${p.minC}–${p.maxC}°C.`],
        sensor: [c.connection === 'connected' && (c.temperature === 'unknown' || c.impact === 'unknown' || (p.minRpm !== null && c.agitation === 'unknown') || c.lock === 'unknown' || c.battery === 'unknown'), 'Sensor data unavailable', 'One or more required sensor values are missing.'],
        impact: [c.impact === 'breach', 'Unexpected handling detected', `Impact reading ${d.impactG} g exceeds the example threshold.`],
        agitation: [c.agitation === 'breach', 'Agitation outside profile', 'Reported agitation is outside the configured example range.'],
        lock: [c.lock === 'breach', 'Compartment open', 'Check the compartment and chain of custody.'],
        battery: [c.battery === 'breach', 'Robot battery low', 'Arrange assistance or charging.'],
        delay: [d.status === 'delayed', 'Delivery delayed', 'Robot reports a delay. Contact the transport team.'],
        duration: [!!d.startedAt && time - Date.parse(d.startedAt) > p.maxTransportMinutes * 60000, 'Transport timer exceeded', 'Configured example journey duration has been exceeded.'],
        timer: [c.timing === 'unknown', 'Transport start time unavailable', 'The robot adapter has not provided a dispatch timestamp. Journey duration cannot be verified.']
      };
      for (const [type, [bad, title, detail]] of Object.entries(checks)) {
        const existing = state.alerts.find(a => a.deliveryId === d.id && a.type === type && a.active);
        if (bad && !existing) {
          const alert = { id: randomUUID(), deliveryId: d.id, type, title, detail, severity: ['battery', 'delay', 'duration'].includes(type) ? 'warning' : 'critical', timestamp: iso(time), active: true, acknowledgedBy: null };
          state.alerts.push(alert);
          record(d, title, detail, 'Monitoring system', time);
        } else if (!bad && existing) {
          // Missing or stale values are not evidence that a sensor excursion recovered.
          const sensorKey = { temperature: 'temperature', impact: 'impact', agitation: 'agitation', lock: 'lock', battery: 'battery' }[type];
          if ((sensorKey && c[sensorKey] === 'unknown') || (type === 'sensor' && c.connection === 'stale') || (type === 'duration' && c.timing === 'unknown')) continue;
          existing.active = false;
          existing.resolvedAt = iso(time);
          record(d, 'Condition recovered', title, 'Monitoring system', time);
        }
      }
    }
  }
  function ingest(payload, time = Date.now(), source = 'robot') {
    if (!payload || typeof payload !== 'object') throw new Error('Telemetry object required');
    const d = state.deliveries.find(d => d.id === payload.deliveryId && d.robotId === payload.robotId);
    if (!d) throw new Error('Unknown delivery or robot pairing');
    if (d.status === 'delivered') throw new Error('Delivery already received');
    const ts = Date.parse(payload.timestamp);
    if (!Number.isFinite(ts) || ts > time + 5000 || ts < time - 60000) throw new Error('timestamp must be recent and not in the future');
    if (source === d.source && ts <= Date.parse(d.lastSeen)) throw new Error('Out of order telemetry');
    for (const [key, min, max] of [['temperatureC', -80, 80], ['impactG', 0, 100], ['agitationRpm', 0, 500], ['batteryPct', 0, 100]]) {
      if (!numeric(payload[key], min, max)) throw new Error(`Invalid ${key}`);
    }
    if (payload.locked !== null && typeof payload.locked !== 'boolean') throw new Error('locked must be boolean or null');
    if (!['preparing', 'in_transit', 'delayed', 'arrived'].includes(payload.status)) throw new Error('Invalid status');
    if (!numeric(payload.etaSeconds, 0, 86400) || payload.etaSeconds === null) throw new Error('Invalid etaSeconds');
    if (Object.hasOwn(payload, 'transportStartedAt') && payload.transportStartedAt !== null && (typeof payload.transportStartedAt !== 'string' || !Number.isFinite(Date.parse(payload.transportStartedAt)) || Date.parse(payload.transportStartedAt) > ts)) throw new Error('transportStartedAt must be a timestamp no later than the measurement, or null');
    const pos = payload.position;
    if (pos !== null && (!pos || !numeric(pos.x, 0, 100) || pos.x === null || !numeric(pos.y, 0, 100) || pos.y === null || typeof pos.floor !== 'string' || !pos.floor.trim() || typeof pos.mapId !== 'string' || !pos.mapId.trim() || !Number.isFinite(Date.parse(pos.timestamp)) || Date.parse(pos.timestamp) > time + 5000)) throw new Error('Invalid position');
    if (source === 'simulator' && d.source === 'robot') throw new Error('Simulator cannot overwrite robot data');
    const previousStatus = d.status;
    const previousSource = d.source;
    for (const key of ['temperatureC', 'impactG', 'agitationRpm', 'batteryPct', 'locked', 'etaSeconds', 'status']) d[key] = payload[key];
    d.lastSeen = payload.timestamp;
    if (pos) d.position = { ...pos }; else if (d.position) d.position = { ...d.position, timestamp: iso(0) };
    d.source = source;
    if (source !== previousSource) {
      d.history = [];
      d.startedAt = null;
      record(d, 'Robot telemetry connected', 'Receiving real robot data; simulation disabled for this delivery. Chart history starts with robot readings.', 'Telemetry gateway', time);
    }
    if (source === 'robot' && Object.hasOwn(payload, 'transportStartedAt')) d.startedAt = payload.transportStartedAt;
    if (source === 'simulator' && d.status === 'in_transit' && !d.startedAt) d.startedAt = iso(time);
    if (d.status !== previousStatus) record(d, d.status === 'arrived' ? 'Arrived at destination' : 'Status updated', d.status.replaceAll('_', ' '), 'Robot telemetry', time);
    d.history.push({ timestamp: payload.timestamp, temperatureC: payload.temperatureC, impactG: payload.impactG });
    d.history = d.history.slice(-180);
    evaluate(time);
    return d.id;
  }
  return {
    state, ingest,
    snapshot(user, time = Date.now()) {
      evaluate(time);
      const deliveries = state.deliveries.filter(d => canSee(user, d)).map(d => ({ ...d, profile: state.profiles[d.product], condition: condition(d, time) }));
      const ids = new Set(deliveries.map(d => d.id));
      return structuredClone({ user, serverTime: iso(time), deliveries, alerts: state.alerts.filter(a => ids.has(a.deliveryId)), profiles: state.profiles });
    },
    acknowledge(id, user, time = Date.now()) {
      const a = state.alerts.find(a => a.id === id);
      if (!a) throw new Error('Alert not found');
      const d = access(a.deliveryId, user);
      if (!a.acknowledgedBy) { a.acknowledgedBy = user.name; a.acknowledgedAt = iso(time); record(d, 'Alert acknowledged', a.title, user.name, time); }
    },
    report(id, message, user, time = Date.now()) {
      const d = access(id, user);
      if (typeof message !== 'string' || message.trim().length < 5 || message.length > 500) throw new Error('Describe the incident in 5–500 characters');
      state.alerts.push({ id: randomUUID(), deliveryId: id, type: 'incident', title: 'Staff incident report', detail: message.trim(), severity: 'warning', timestamp: iso(time), active: true, acknowledgedBy: null });
      record(d, 'Incident reported', message.trim(), user.name, time);
    },
    resolve(id, user, time = Date.now()) {
      const a = state.alerts.find(a => a.id === id);
      if (!a || a.type !== 'incident') throw new Error('Only staff incidents can be manually resolved');
      const d = access(a.deliveryId, user);
      if (a.active) { a.active = false; a.resolvedAt = iso(time); record(d, 'Incident resolved', a.detail, user.name, time); }
    },
    receive(id, code, user, time = Date.now()) {
      const d = access(id, user);
      if (d.status === 'delivered') throw new Error('Delivery already received');
      if (d.status !== 'arrived') throw new Error('Robot must arrive before receipt can be verified');
      if (typeof code !== 'string' || code.trim().toUpperCase() !== d.unitCode) throw new Error('Unit code does not match this delivery');
      evaluate(time);
      const c = condition(d, time);
      if (c.connection === 'stale' || Object.values(c).some(v => ['unknown', 'breach'].includes(v)) || state.alerts.some(a => a.deliveryId === id && a.active)) throw new Error('Resolve monitoring issues before normal receipt; contact the blood bank for exceptions');
      d.status = 'delivered'; d.receivedAt = iso(time); d.receivedBy = user.name;
      record(d, 'Receipt verified', `${d.unitCode} received at ${d.destination}. Transport receipt only; clinical checks remain required.`, user.name, time);
    },
    scenario(id, name, user, time = Date.now()) {
      const d = access(id, user);
      if (d.source === 'robot') throw new Error('Demo controls cannot change robot-source data');
      if (d.status === 'delivered') throw new Error('Delivery already received');
      if (!['normal', 'temperature', 'impact', 'offline', 'delay', 'open', 'arrive', 'dispatch'].includes(name)) throw new Error('Unknown scenario');
      d.scenario = name;
      record(d, 'Demo scenario changed', name, user.name, time);
    },
    simulate(time = Date.now()) {
      for (const d of state.deliveries) {
        if (d.source !== 'simulator' || d.status === 'delivered' || d.scenario === 'offline' || time <= Date.parse(d.lastSeen)) continue;
        const p = state.profiles[d.product], arrived = d.scenario === 'arrive' || d.status === 'arrived';
        const status = arrived ? 'arrived' : d.scenario === 'delay' ? 'delayed' : d.scenario === 'dispatch' || d.status !== 'preparing' ? 'in_transit' : 'preparing';
        const progress = status === 'preparing' ? 0 : arrived ? 1 : Math.min(.94, .25 + ((time - Date.parse(d.startedAt || iso(time))) / 1200000));
        // Shared normalized floor-map route: bank -> corridor -> ward.
        const points = [[17,24], [35,24], [35,58], [71,58], [71,78], [84,78]];
        const segment = Math.min(4, Math.floor(progress * 5)), t = progress * 5 - segment;
        this.ingest({ robotId: d.robotId, deliveryId: d.id, timestamp: iso(time), temperatureC: d.scenario === 'temperature' ? p.maxC + 2.3 : +( (p.minC + p.maxC) / 2 - (d.product === 'rbc' ? 1.8 : 0) + Math.sin(time / 18000) * .18).toFixed(2), impactG: d.scenario === 'impact' ? 3.4 : +(.08 + Math.abs(Math.sin(time / 7000)) * .08).toFixed(2), agitationRpm: d.product === 'platelets' ? 55 : null, batteryPct: d.batteryPct, locked: d.scenario !== 'open', etaSeconds: arrived ? 0 : status === 'preparing' ? 720 : Math.max(60, Math.round((1 - progress) * 600)), status, position: { x: points[segment][0] + (points[segment + 1][0] - points[segment][0]) * t, y: points[segment][1] + (points[segment + 1][1] - points[segment][1]) * t, floor: 'L4', mapId: 'demo-hospital', timestamp: iso(time) } }, time, 'simulator');
      }
      evaluate(time);
    },
    updateProfile(product, patch, user, time = Date.now()) {
      if (user.role !== 'supervisor') throw new Error('Supervisor role required');
      const p = state.profiles[product];
      if (!p || !patch || !numeric(patch.minC, -80, 80) || patch.minC === null || !numeric(patch.maxC, -80, 80) || patch.maxC === null || patch.minC >= patch.maxC || !numeric(patch.maxImpactG, .1, 100) || patch.maxImpactG === null || !numeric(patch.maxTransportMinutes, 1, 240) || patch.maxTransportMinutes === null) throw new Error('Invalid profile limits');
      Object.assign(p, { minC: patch.minC, maxC: patch.maxC, maxImpactG: patch.maxImpactG, maxTransportMinutes: patch.maxTransportMinutes });
      state.audit.push({ id: randomUUID(), timestamp: iso(time), title: 'Example profile updated', actor: user.name, product, ...patch });
      evaluate(time);
    }
  };
}
