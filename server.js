import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createStore, STAFF } from './lib/store.js';
import { createPersistence } from './lib/persistence.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createApp({ persist = true, simulate = true, token = process.env.TELEMETRY_TOKEN || 'local-prototype-token', dataFile = path.join(root, 'data/state.json') } = {}) {
  let initial;
  if (persist && existsSync(dataFile)) {
    try { initial = JSON.parse(readFileSync(dataFile, 'utf8')); }
    catch (e) { throw new Error(`Cannot load saved state (${dataFile}): ${e.message}. Preserve the file before resetting.`); }
  }
  const store = createStore({ initial });
  const snapshotFor = (user, time = Date.now()) => ({ ...store.snapshot(user, time), simulatorEnabled: simulate });
  const sessions = new Map(), streams = new Set();
  const writeState = createPersistence(dataFile);
  const save = () => persist ? writeState(store.state) : Promise.resolve();
  function broadcast() {
    const now = Date.now();
    for (const client of streams) {
      const session = sessions.get(client.sid);
      if (!session || session.expires < now) { client.res.end(); streams.delete(client); continue; }
      client.res.write(`data: ${JSON.stringify(snapshotFor(session.user, now))}\n\n`);
    }
  }
  function json(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }
  async function body(req) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('Request exceeds 16 KB'); }
    try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin requests are not permitted' });
      if (route === '/api/telemetry' && req.method === 'POST') {
        const received = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${token}`);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) return json(res, 401, { error: 'Telemetry bearer token required' });
        store.ingest(await body(req)); await save(); broadcast();
        return json(res, 200, { accepted: true });
      }
      if (route === '/api/staff' && req.method === 'GET') return json(res, 200, { staff: Object.values(STAFF), demo: true });
      if (route === '/api/session' && req.method === 'POST') {
        const user = STAFF[(await body(req)).staffId];
        if (!user) return json(res, 400, { error: 'Choose a demo staff member' });
        const old = /(?:^|;\s*)redroute=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        if (old) sessions.delete(old);
        const sid = randomUUID(); sessions.set(sid, { user, expires: Date.now() + 8 * 3600000 });
        return json(res, 200, { user }, { 'Set-Cookie': `redroute=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      if (route.startsWith('/api/')) {
        const sid = /(?:^|;\s*)redroute=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        const session = sessions.get(sid);
        if (!session || session.expires < Date.now()) return json(res, 401, { error: 'Demo staff sign-in required' });
        const user = session.user;
        if (route === '/api/logout' && req.method === 'POST') {
          sessions.delete(sid); broadcast();
          return json(res, 200, { ok: true }, { 'Set-Cookie': 'redroute=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        }
        if (route === '/api/state' && req.method === 'GET') return json(res, 200, snapshotFor(user));
        if (route === '/api/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          const client = { res, sid }; streams.add(client);
          res.write(`data: ${JSON.stringify(snapshotFor(user))}\n\n`);
          req.on('close', () => streams.delete(client)); return;
        }
        if (route === '/api/export' && req.method === 'GET') {
          const data = store.snapshot(user);
          return json(res, 200, { exportedAt: new Date().toISOString(), note: 'Prototype transport records. Not clinical release approval.', ...data }, { 'Content-Disposition': 'attachment; filename="redroute-journey-report.json"' });
        }
        if (req.method === 'POST') {
          const input = await body(req);
          const delivery = /^\/api\/deliveries\/([^/]+)\/(scenario|incident|receive)$/.exec(route);
          const alert = /^\/api\/alerts\/([^/]+)\/(acknowledge|resolve)$/.exec(route);
          if (delivery) {
            const [, id, action] = delivery;
            if (action === 'scenario') {
              if (!simulate) throw new Error('Simulator is disabled on this server');
              store.scenario(id, input.scenario, user);
            }
            if (action === 'incident') store.report(id, input.message, user);
            if (action === 'receive') store.receive(id, input.code, user);
            if (simulate) store.simulate(Date.now());
          } else if (alert) {
            if (alert[2] === 'acknowledge') store.acknowledge(alert[1], user); else store.resolve(alert[1], user);
          } else if (route === '/api/profiles') store.updateProfile(input.product, input, user);
          else return json(res, 404, { error: 'Endpoint not found' });
          await save(); broadcast(); return json(res, 200, snapshotFor(user));
        }
        return json(res, 404, { error: 'Endpoint not found' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      const files = { '/': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const file = files[route];
      if (!file) return json(res, 404, { error: 'Not found' });
      const content = readFileSync(path.join(root, 'public', file[0]));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message }); else res.end(); }
  });
  const timer = setInterval(async () => {
    try { if (simulate) store.simulate(); broadcast(); await save(); }
    catch (e) { console.error('Telemetry update failed:', e.message); }
    for (const [id, s] of sessions) if (s.expires < Date.now()) sessions.delete(id);
  }, 2000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); for (const c of streams) c.res.end(); });
  return { server, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp({ simulate: process.env.SIMULATOR !== 'off' });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`RedRoute is running at http://127.0.0.1:${port}\nDemo identity only. Example monitoring limits; no real patient data.\nTelemetry: POST /api/telemetry (set TELEMETRY_TOKEN for your adapter).`));
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
