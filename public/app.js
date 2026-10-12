const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  box: '<path d="m3 7 9-4 9 4v11l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v11M7 5l9 4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 1 2 4h4l2-3 4-1 2-3-2-3 1-3-4-2-2-3Z"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 11 3 3 5-5"/>',
  temp: '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM12 7v10m5-9h3m-3-4h3"/>',
  wave: '<path d="M2 12h3l3-7 4 14 4-11 2 4h4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  battery: '<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M23 10v4M6 10v4m4-4v4m4-4v4"/>',
  alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  robot: '<rect x="4" y="6" width="16" height="12" rx="4"/><path d="M12 3v3M2 10v4m20-4v4M8 18v3m8-3v3M8 10v1m8-1v1m-7 3h6"/>',
  flag: '<path d="M5 21V3m0 0c4-3 8 3 14 0v10c-6 3-10-3-14 0"/>',
  activity: '<path d="M4 6v12m5-8v8m5-14v14m5-6v6"/>',
  link: '<path d="m9 15 6-6m-7 4-2 2a4 4 0 0 0 6 6l3-3m1-7 2-2a4 4 0 0 0-6-6L9 6"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
const badge = (text, color = 'neutral') => `<span class="badge ${color}">${escape(text)}</span>`;
const time = value => value ? new Date(value).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' }) : '—';
const date = value => new Date(value).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' });
const ago = value => { const s = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000)); return s < 5 ? 'Just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`; };
const statusNames = { preparing: 'Preparing', in_transit: 'In transit', delayed: 'Delayed', arrived: 'Awaiting receipt', delivered: 'Delivered' };
const statusBadge = d => badge(statusNames[d.status], d.status === 'delivered' ? 'green' : d.status === 'delayed' ? 'amber' : d.status === 'preparing' ? 'neutral' : 'red');
let snapshot, selectedId = 'RR-2048', view = 'overview', filter = 'all', query = '', stream, feedConnected = false, lastEventAt = 0, dialogAction, toastTimer;
const titles = { overview: 'Delivery overview', deliveries: 'Your deliveries', alerts: 'Alerts & incidents', history: 'Journey history', settings: 'Workspace settings' };
const activeAlerts = () => snapshot?.alerts.filter(a => a.active) || [];
function selected() { return snapshot?.deliveries.find(d => d.id === selectedId) || snapshot?.deliveries[0]; }
async function api(url, body) {
  const res = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) { if (res.status === 401 && url !== '/api/session') showLogin(); throw new Error(data.error || 'Request failed'); }
  return data;
}
function toast(message, error = false) { clearTimeout(toastTimer); const el = $('#toast'); el.textContent = message; el.className = `toast${error ? ' error-toast' : ''}`; el.hidden = false; toastTimer = setTimeout(() => { el.hidden = true; }, 5000); }
function accept(data) { snapshot = data; if (!snapshot.deliveries.some(d => d.id === selectedId)) selectedId = snapshot.deliveries[0]?.id; render(); }
function openFeed() {
  stream?.close(); stream = new EventSource('/api/events');
  stream.onmessage = e => { feedConnected = true; lastEventAt = Date.now(); accept(JSON.parse(e.data)); };
  stream.onerror = () => { feedConnected = false; render(); };
}
async function login(id) {
  try {
    await api('/api/session', { staffId: id });
    snapshot = await api('/api/state'); selectedId = snapshot.deliveries[0]?.id;
    $('#login').hidden = true; $('#shell').hidden = false;
    openFeed(); render();
  } catch (e) { $('#login-error').textContent = e.message; }
}
async function showLogin() {
  stream?.close(); feedConnected = false; snapshot = null;
  $('#shell').hidden = true; $('#login').hidden = false; $('#action-dialog').close();
  try {
    const { staff } = await api('/api/staff');
    $('#staff-options').innerHTML = staff.map(u => `<button class="staff-choice" data-staff="${u.id}"><span class="avatar">${u.name.split(' ').map(s => s[0]).join('')}</span><span><strong>${escape(u.name)}</strong><small>${escape(u.title)} · ${u.ward ? 'Ward ' + u.ward : 'All wards'}</small></span>${icon('arrow')}</button>`).join('');
  } catch { $('#login-error').textContent = 'Server unavailable. Start the app with npm start, then refresh.'; }
}
function nav() {
  $('#nav').innerHTML = [['overview', 'grid', 'Overview'], ['deliveries', 'box', 'Deliveries'], ['alerts', 'bell', 'Alerts'], ['history', 'clock', 'History'], ['settings', 'settings', 'Settings']].map(([id, glyph, label]) => `<button class="nav-item ${view === id ? 'active' : ''}" data-nav="${id}" aria-label="${label}" ${view === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span class="nav-text">${label}</span>${id === 'alerts' && activeAlerts().length ? `<span class="count">${activeAlerts().length}</span>` : ''}</button>`).join('');
  $('#breadcrumb').textContent = view.charAt(0).toUpperCase() + view.slice(1);
  $('#notification-button').innerHTML = icon('bell');
  $('#notification-button').classList.toggle('notification-active', activeAlerts().length > 0);
  const u = snapshot.user, initials = u.name.split(' ').map(s => s[0]).join('');
  $('#staff-name').textContent = u.name; $('#staff-role').textContent = u.ward ? `Ward ${u.ward} · Nurse` : u.title;
  $('.account .avatar').textContent = initials; $('#top-avatar').textContent = initials;
  const healthy = feedConnected && Date.now() - lastEventAt < 7000;
  $('#feed-status').classList.toggle('offline', !healthy);
  $('#feed-status').innerHTML = `<i></i>${healthy ? 'Dashboard connected' : 'Dashboard reconnecting'}`;
}
function intro(subtitle, actions = '') {
  return `<section class="page-intro"><div><p class="eyebrow">${snapshot.user.ward ? `WARD ${escape(snapshot.user.ward)} WORKSPACE` : 'HOSPITAL WORKSPACE'}</p><h1>${titles[view]}</h1><p class="subtitle">${subtitle}</p></div><div class="intro-actions">${actions}</div></section>`;
}
function prototypeStrip(d) {
  return `<div class="prototype-strip"><span><strong>${d?.source === 'robot' ? 'ROBOT DATA' : 'SIMULATED DATA'}</strong> · ${d?.source === 'robot' ? 'Live gateway readings' : 'Interactive demonstration'} · Demo staff identity</span><span>Example monitoring limits <a href="#settings" data-nav="settings">View details</a></span></div>`;
}
function effective(d) {
  if (!feedConnected || Date.now() - lastEventAt > 7000) return { ...d, condition: { ...d.condition, connection: 'stale', location: 'unknown', temperature: 'unknown', impact: 'unknown', agitation: d.product === 'platelets' ? 'unknown' : 'not_required', lock: 'unknown', battery: 'unknown' } };
  return d;
}
function stats() {
  const ds = snapshot.deliveries, moving = ds.filter(d => ['in_transit', 'delayed', 'arrived'].includes(d.status)).length;
  const items = [
    ['box', 'Active deliveries', String(moving).padStart(2, '0'), '', 'Across your workspace', 'red'],
    ['shield', 'Within profile', ds.filter(d => d.status !== 'delivered' && Object.values(effective(d).condition).every(v => !['stale', 'unknown', 'breach'].includes(v))).length, 'monitored', 'Based on latest readings', 'green'],
    ['bell', 'Active alerts', String(activeAlerts().length).padStart(2, '0'), '', activeAlerts().length ? 'Review and acknowledge' : 'No issues flagged', activeAlerts().length ? 'red' : ''],
    ['check', 'Completed deliveries', String(ds.filter(d => d.status === 'delivered').length).padStart(2, '0'), '', 'Verified handovers', '']
  ];
  return `<section class="stats" aria-label="Workspace summary">${items.map(([glyph, label, value, unit, caption, color]) => `<div class="stat"><span class="stat-icon ${color}">${icon(glyph)}</span><div><div class="stat-label">${label}</div><div class="stat-value">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="stat-caption">${caption}</div></div></div>`).join('')}</section>`;
}
function floorMap(d) {
  const mapMatches = d.position?.mapId === 'demo-hospital' && d.position?.floor === 'L4';
  const valid = d.condition.location === 'normal' && mapMatches;
  const x = mapMatches ? d.position.x : 17, y = mapMatches ? d.position.y : 24;
  return `<div class="map-wrap"><svg class="floor-map" viewBox="0 0 100 90" role="img" aria-label="Schematic floor plan. ${valid ? `Robot at ${Math.round(x)}, ${Math.round(y)} on Level 4` : 'Current robot position unavailable on this map'}">
    <defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" class="map-grid" fill="none"/></pattern></defs><rect width="100" height="90" fill="url(#grid)"/>
    <path d="M5 6h24v12H5ZM5 32h24v17H5ZM5 65h24v18H5ZM42 6h23v12H42ZM42 32h23v17H42ZM42 66h22v17H42ZM78 6h17v43H78Z" class="map-room"/>
    <path d="M5 52h24v6H5ZM42 52h23v6H42ZM78 52h17v15H78Z" class="map-room light"/><path d="M78 71h17v12H78Z" class="map-room ward"/>
    <text x="17" y="12" text-anchor="middle" class="map-text">Blood bank</text><text x="17" y="16" text-anchor="middle" class="map-caption">COLLECTION POINT</text><text x="17" y="41" text-anchor="middle" class="map-text">Laboratory</text><text x="17" y="75" text-anchor="middle" class="map-text">Consultation</text><text x="53" y="12" text-anchor="middle" class="map-text">Staff room</text><text x="53" y="41" text-anchor="middle" class="map-text">Treatment</text><text x="53" y="76" text-anchor="middle" class="map-text">Nurses' station</text><text x="86" y="28" text-anchor="middle" class="map-text">Ward 4A</text><text x="86" y="61" text-anchor="middle" class="map-text">Lift lobby</text><text x="86" y="77" text-anchor="middle" class="map-text">${escape(d.destination)}</text>
    <path d="M17 24H35V58H71V78H84" class="map-route-shadow"/><path d="M17 24H35V58H71V78H84" class="map-route"/>
    <circle cx="17" cy="24" r="2" fill="#a6322b" stroke="#fffdfa" stroke-width=".7"/><circle cx="84" cy="78" r="2" fill="#fffdfa" stroke="#a6322b" stroke-width=".8"/>
    ${valid ? `<circle cx="${x}" cy="${y}" r="6" class="map-halo"/><g transform="translate(${x} ${y})"><rect x="-3" y="-3" width="6" height="6" rx="2" class="map-robot"/><path d="M-1.2-.7v.4m2.4-.4v.4M-1 1h2M0-4v1" stroke="#fffdfa" stroke-width=".6" stroke-linecap="round"/><circle cx="0" cy="-4.4" r=".5" fill="#a6322b"/></g>` : ''}
  </svg><div class="map-overlay"><span class="map-label">${icon('pin')}<b>Level 4</b> · Demo floor plan</span><span class="map-label">${escape(d.robotId)}</span></div><div class="map-legend"><span>●</span> Blood bank <span> ┄ </span> Planned route <span>◉</span> Destination</div></div>${!valid ? `<p class="map-warning">${mapMatches ? 'Location unavailable. Last known position: ' + Math.round(x) + ', ' + Math.round(y) + '. Updated ' + ago(d.position.timestamp) + '.' : 'Position does not match the demonstration map. Configure a matching floor map before plotting this robot.'}</p>` : ''}`;
}
function mapPanel(d) {
  const step = { preparing: 0, in_transit: 1, delayed: 1, arrived: 2, delivered: 3 }[d.status];
  return `<section class="panel"><div class="panel-heading"><div><h2>Live journey ${badge(d.id, 'neutral')}</h2><p>Blood bank → ${escape(d.destination)} · ${escape(d.department)}</p></div><span class="live-label"><i class="live-dot"></i>${d.condition.location === 'normal' ? 'TRACKING' : 'UNAVAILABLE'}</span></div>${floorMap(d)}<div class="route-footer"><span class="route-icon">${icon('robot')}</span><div><strong>${escape(d.destination)}</strong><small>${d.status === 'delivered' ? 'Receipt verified by ' + escape(d.receivedBy) : `${escape(d.robotId)} · ${escape(statusNames[d.status])}`}</small></div><div class="eta"><small>${d.status === 'delivered' ? 'Received at' : d.status === 'arrived' ? 'Ready for' : 'Estimated arrival'}</small><strong>${d.status === 'delivered' ? time(d.receivedAt) : d.status === 'arrived' ? '<span>verification</span>' : d.condition.connection === 'stale' ? '—' : `${Math.ceil(d.etaSeconds / 60)} <span>min</span>`}</strong></div></div><div class="journey-progress">${['Preparing', 'In transit', 'Arrived', 'Received'].map((s, i) => `<span class="journey-step ${i < step ? 'done' : i === step ? 'current' : ''}">${s}</span>`).join('')}</div></section>`;
}
function chart(d) {
  const points = d.history.slice(-50), values = points.filter(p => typeof p.temperatureC === 'number').map(p => p.temperatureC);
  if (!values.length) return '<div class="empty">Waiting for temperature readings.</div>';
  const low = Math.min(d.profile.minC, ...values) - .6, high = Math.max(d.profile.maxC, ...values) + .6;
  const y = n => 71 - (n - low) / (high - low) * 61;
  let segments = [], line = [];
  points.forEach((p, i) => { if (p.temperatureC === null) { if (line.length) segments.push(line); line = []; } else line.push(`${22 + i / Math.max(1, points.length - 1) * 260},${y(p.temperatureC)}`); });
  if (line.length) segments.push(line);
  return `<svg class="temperature-chart" viewBox="0 0 310 90" role="img" aria-label="Temperature history, ${time(points[0].timestamp)} to ${time(points.at(-1).timestamp)}. Example range ${d.profile.minC} to ${d.profile.maxC} degrees Celsius."><rect x="22" y="${y(d.profile.maxC)}" width="260" height="${y(d.profile.minC) - y(d.profile.maxC)}" rx="3" fill="#edf3eb"/>${[d.profile.maxC, (d.profile.minC + d.profile.maxC) / 2, d.profile.minC].map(v => `<path d="M22 ${y(v)}H282" class="chart-grid"/><text x="5" y="${y(v) + 3}" class="chart-label">${v}</text>`).join('')}${segments.map(s => `<polyline points="${s.join(' ')}" class="chart-line"/>`).join('')}<text x="22" y="87" class="chart-label">${time(points[0].timestamp)}</text><text x="282" y="87" text-anchor="end" class="chart-label">${time(points.at(-1).timestamp)}</text></svg>`;
}
function verdict(value) { return value === 'normal' ? badge('Within profile', 'green') : value === 'not_required' ? badge('Not required') : value === 'breach' ? badge('Check reading', 'red') : badge('Unavailable', 'amber'); }
function conditions(d) {
  const c = d.condition, ok = Object.values(c).every(v => !['stale', 'unknown', 'breach'].includes(v));
  return `<section class="panel condition-panel"><div class="panel-heading"><div><h2>Transport conditions</h2><p>${escape(d.profile.name)} · ${d.units} ${d.units === 1 ? 'unit' : 'units'}</p></div>${icon('activity')}</div><div class="condition-summary ${ok ? '' : 'warning'}">${icon(ok ? 'shield' : 'alert')}${ok ? 'Latest readings are within the example profile' : 'Monitoring needs your attention'}</div><div class="temp-header"><div><div class="metric-label">${icon('temp')}Chamber temperature</div><div class="temp-value">${c.temperature === 'unknown' ? '—' : d.temperatureC.toFixed(1)}<small>°C</small></div><div class="temp-caption">Example profile ${d.profile.minC}–${d.profile.maxC}°C</div></div><div class="temp-status">${verdict(c.temperature)}</div></div>${chart(d)}<div class="chart-bottom"><span class="chart-key"><i></i>Temperature history</span><span>Updated ${ago(d.lastSeen)}</span></div><div class="condition-row"><span class="metric-label">${icon('wave')}Handling / impact</span><span class="condition-reading">${c.impact === 'unknown' ? '—' : d.impactG.toFixed(2) + ' g'}${verdict(c.impact)}</span></div>${d.product === 'platelets' ? `<div class="condition-row"><span class="metric-label">${icon('activity')}Agitation</span><span class="condition-reading">${c.agitation === 'unknown' ? '—' : d.agitationRpm + ' RPM'}${verdict(c.agitation)}</span></div>` : ''}<div class="condition-row"><span class="metric-label">${icon('lock')}Compartment</span><span class="condition-reading">${c.lock === 'unknown' ? 'Unknown' : d.locked ? 'Locked' : 'Open'}${badge(c.lock === 'normal' ? 'Secured' : c.lock === 'unknown' ? 'Unavailable' : 'Check', c.lock === 'normal' ? 'green' : 'amber')}</span></div><div class="condition-row"><span class="metric-label">${icon('battery')}Robot battery</span><span class="condition-reading">${c.battery === 'unknown' ? '—' : d.batteryPct + '%'}<small>${c.connection === 'connected' ? 'Connected' : 'Connection lost'}</small></span></div><div class="condition-note">Chamber readings do not establish blood core temperature or suitability for transfusion. Follow hospital verification procedures.</div></section>`;
}
function deliveryList() {
  return `<section class="panel"><div class="panel-heading"><h2>Your deliveries ${badge(snapshot.deliveries.length)}</h2><button class="button text" data-nav="deliveries">View all ${icon('arrow')}</button></div><div class="delivery-list">${snapshot.deliveries.map(d => `<button class="delivery-item ${d.id === selectedId ? 'selected' : ''}" data-select="${d.id}" aria-pressed="${d.id === selectedId}"><span class="delivery-icon">${icon('box')}</span><span class="delivery-info"><strong>${d.id}${d.priority === 'Urgent' ? badge('Urgent', 'red') : ''}</strong><small>${escape(d.profile.name)} · ${d.units} ${d.units === 1 ? 'unit' : 'units'} → ${escape(d.destination)}</small></span><span class="delivery-right">${statusBadge(d)}<small>${d.status === 'delivered' ? time(d.receivedAt) : d.status === 'arrived' ? 'Verify receipt' : Math.ceil(d.etaSeconds / 60) + ' min ETA'}</small></span></button>`).join('')}</div></section>`;
}
function timeline(d, full = false) {
  const events = [...d.timeline].reverse().slice(0, full ? 100 : 3);
  return `<section class="panel"><div class="panel-heading"><h2>Journey timeline</h2><span class="badge neutral">${escape(d.id)}</span></div><div class="timeline">${events.map(e => `<div class="timeline-item"><span class="timeline-dot"></span><div><strong>${escape(e.title)}</strong><p>${escape(e.detail)}<br>${escape(e.actor)}</p></div><time datetime="${e.timestamp}">${time(e.timestamp)}</time></div>`).join('')}</div></section>`;
}
function demo(d) {
  if (d.source === 'robot') return `<div class="demo-panel"><summary>Real robot telemetry connected · Demo controls are disabled for ${d.id}.</summary></div>`;
  if (d.status === 'delivered') return '';
  const options = [['normal', 'Normal readings'], ['temperature', 'Temperature excursion'], ['impact', 'Handling event'], ['offline', 'Connection loss'], ['delay', 'Route delay'], ['open', 'Open compartment'], [d.status === 'preparing' ? 'dispatch' : 'arrive', d.status === 'preparing' ? 'Dispatch delivery' : 'Arrive at ward']];
  return `<details class="demo-panel" id="demo-panel"><summary>Demo scenario controls <span>Test the workflow without connected hardware</span></summary><div class="demo-controls"><p>Applies only to ${d.id}. These controls simulate sensor reports and do not command a robot. Connection loss becomes an alert after 15 seconds.</p>${options.map(([name, label]) => `<button data-scenario="${name}" class="${d.scenario === name ? 'active' : ''}" ${!feedConnected ? 'disabled' : ''}>${label}</button>`).join('')}</div></details>`;
}
function overview() {
  const d = effective(selected());
  const ready = d.status === 'arrived' && Object.values(d.condition).every(v => !['stale', 'unknown', 'breach'].includes(v)) && !activeAlerts().some(a => a.deliveryId === d.id);
  return intro('A clear view of every delivery, every step of the way.', `<button class="button secondary" data-action="incident">${icon('flag')}Report issue</button><button class="button primary" data-action="receive" ${ready ? '' : 'disabled'} title="${ready ? 'Verify delivery receipt' : 'Available after arrival, with current readings and no active issues'}">${icon('check')}Verify receipt</button>`) + prototypeStrip(d) + stats() + `<div class="dashboard-grid">${mapPanel(d)}${conditions(d)}</div><div class="lower-grid">${deliveryList()}${timeline(d)}</div>${demo(d)}`;
}
function deliveries() {
  const ds = snapshot.deliveries.filter(d => (filter === 'all' || filter === 'active' && d.status !== 'delivered' || filter === 'completed' && d.status === 'delivered') && `${d.id} ${d.destination} ${d.unitCode}`.toLowerCase().includes(query.toLowerCase()));
  return intro('The right delivery, with the details you need.', `<a class="button secondary" href="/api/export">${icon('download')}Export report</a>`) + filterBar([['all', 'All deliveries'], ['active', 'Active'], ['completed', 'Completed']], true) + `<div class="full-deliveries">${ds.map(d => `<section class="panel delivery-card"><div class="delivery-card-head"><h2>${d.id}</h2>${statusBadge(d)}</div><div class="destination">${escape(d.destination)}</div><p>Blood bank → ${escape(d.department)}<br>${escape(d.profile.name)} · ${d.units} ${d.units === 1 ? 'unit' : 'units'} · ${escape(d.unitCode)}</p><div class="delivery-card-metrics"><span><small>Estimated arrival</small>${d.status === 'arrived' ? 'Arrived' : d.status === 'delivered' ? 'Received' : effective(d).condition.connection === 'stale' ? 'Unavailable' : Math.ceil(d.etaSeconds / 60) + ' min'}</span><span><small>Temperature</small>${effective(d).condition.temperature === 'unknown' ? 'Unavailable' : d.temperatureC.toFixed(1) + '°C'}</span><span><small>Robot</small>${escape(d.robotId)}</span></div><div class="delivery-card-footer">${badge(d.source === 'robot' ? 'Robot data' : 'Simulated', 'neutral')}<button class="button text" data-open="${d.id}">Track delivery ${icon('arrow')}</button></div></section>`).join('')}</div>${ds.length ? '' : '<div class="panel empty">No deliveries match this view.</div>'}`;
}
function filterBar(items, search = false) {
  return `<div class="filter-bar"><div class="filters" aria-label="Filter view">${items.map(([id, label]) => `<button class="filter ${filter === id ? 'active' : ''}" data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`).join('')}</div>${search ? `<label class="search">${icon('search')}<input id="delivery-search" type="search" placeholder="Search deliveries…" aria-label="Search deliveries" value="${escape(query)}"></label>` : ''}</div>`;
}
function alerts() {
  const list = [...snapshot.alerts].reverse().filter(a => filter === 'all' || filter === 'active' && a.active || filter === 'resolved' && !a.active);
  return intro('Know what changed. Make the next step clear.', `<button class="button primary" data-action="incident">${icon('flag')}Report issue</button>`) + filterBar([['all', 'All alerts'], ['active', `Active (${activeAlerts().length})`], ['resolved', 'Recovered / resolved']]) + `<div class="alert-list">${list.map(a => `<article class="panel alert-card"><span class="alert-icon ${a.active ? '' : 'resolved'}">${icon(a.active ? 'alert' : 'check')}</span><div class="alert-body"><h2>${escape(a.title)} ${badge(a.active ? a.severity : 'Recovered / resolved', a.active ? a.severity === 'critical' ? 'red' : 'amber' : 'green')}</h2><p>${escape(a.detail)}</p><div class="alert-meta">${a.deliveryId} · ${date(a.timestamp)} at ${time(a.timestamp)}${a.resolvedAt ? ' · Recovered ' + time(a.resolvedAt) : ''}</div><div class="alert-actions">${a.acknowledgedBy ? badge('Acknowledged by ' + a.acknowledgedBy) : `<button class="button secondary" data-ack="${a.id}">Acknowledge</button>`}${a.type === 'incident' && a.active ? `<button class="button secondary" data-resolve="${a.id}">Resolve incident</button>` : ''}<button class="button text" data-open="${a.deliveryId}">View delivery ${icon('arrow')}</button></div></div></article>`).join('')}</div>${list.length ? '<p class="condition-note">Acknowledging an alert records that you have seen it. Sensor alerts recover only when readings recover; missing data cannot clear an excursion.</p>' : `<div class="panel empty">${icon('shield')}<strong>No ${filter === 'resolved' ? 'recovered' : 'matching'} alerts.</strong><br>Monitoring events and staff reports will appear here.<br>Use the demo scenario controls on Overview to explore an incident.</div>`}`;
}
function history() {
  return intro('A record of the journey, from request to receipt.', `<a class="button secondary" href="/api/export">${icon('download')}Export report</a>`) + `<section class="panel"><div class="panel-heading"><h2>Delivery records</h2>${badge(snapshot.deliveries.length + ' records')}</div><div class="table-wrap"><table><thead><tr><th>DELIVERY</th><th>DESTINATION</th><th>STATUS</th><th>HANDOVER</th><th></th></tr></thead><tbody>${snapshot.deliveries.map(d => `<tr><td><b>${d.id}</b><small>${escape(d.unitCode)}<br>${escape(d.profile.name)}</small></td><td>${escape(d.destination)}<small>${escape(d.department)}</small></td><td>${statusBadge(d)}</td><td>${d.receivedAt ? escape(d.receivedBy) + '<small>' + date(d.receivedAt) + ' · ' + time(d.receivedAt) + '</small>' : 'Pending receipt'}</td><td><button class="button text" data-history="${d.id}">View log ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div></section><div class="lower-grid">${timeline(selected(), true)}<section class="panel settings-card"><h2>Traceability, without the chasing</h2><p>Each journey records delivery status, sensor events, staff incident reports, alert acknowledgements and verified receipt.</p><p>Reports include the readings currently retained for each delivery (up to 180 samples), source labels and timestamps. This prototype saves records on the local server.</p><p class="integration-notice">Receipt confirms a transport handover. Patient matching and approval for transfusion remain part of the hospital's clinical workflow.</p></section></div>`;
}
function settings() {
  const supervisor = snapshot.user.role === 'supervisor';
  return intro('A considered setup for your prototype.') + `<div class="settings-grid"><section class="panel settings-card"><h2>Staff access</h2><p>Signed in as <b>${escape(snapshot.user.name)}</b>. ${snapshot.user.ward ? 'Your workspace is restricted to deliveries for Ward ' + escape(snapshot.user.ward) + '.' : 'Your demo role can view deliveries across all wards.'}</p><dl><dt>Identity</dt><dd>Demo identity · Not hospital verified</dd><dt>Future integration</dt><dd>Institutional single sign-on, with access assignments provided by the hospital.</dd><dt>Patient data</dt><dd>None stored in this prototype.</dd></dl><button class="button secondary" data-action="switch">Switch demo workspace ${icon('arrow')}</button></section><section class="panel settings-card"><h2>Robot connection</h2><p>The telemetry gateway accepts robot navigation and sensor readings. Simulation stops for a delivery as soon as robot-source data is accepted.</p><dl><dt>Gateway endpoint</dt><dd><code>POST /api/telemetry</code></dd><dt>Location</dt><dd>Normalized floor-map coordinates (0–100), floor, map ID and position timestamp. The demo map is <code>demo-hospital</code>, floor <code>L4</code>.</dd><dt>Connection timeout</dt><dd>15 seconds without telemetry. Dashboard connection is monitored separately.</dd></dl><p>See the repository README for the adapter payload and token configuration.</p></section>${Object.entries(snapshot.profiles).map(([id, p]) => `<section class="panel settings-card"><h2>${escape(p.name)} profile</h2><p>Illustrative limits for demonstrating alerts. A hospital must validate the limits and sensors before operational use.</p><form class="profile-form" data-profile="${id}"><label>Minimum °C<input name="minC" type="number" step="0.1" min="-80" max="80" value="${p.minC}" required ${supervisor ? '' : 'disabled'}></label><label>Maximum °C<input name="maxC" type="number" step="0.1" min="-80" max="80" value="${p.maxC}" required ${supervisor ? '' : 'disabled'}></label><label>Maximum impact (g)<input name="maxImpactG" type="number" step="0.1" min="0.1" max="100" value="${p.maxImpactG}" required ${supervisor ? '' : 'disabled'}></label><label>Journey limit (min)<input name="maxTransportMinutes" type="number" min="1" max="240" value="${p.maxTransportMinutes}" required ${supervisor ? '' : 'disabled'}></label>${supervisor ? '<button class="button secondary">Save example profile</button>' : '<p>Switch to the supervisor demo workspace to edit these example limits.</p>'}</form><p>${p.minRpm === null ? 'Agitation is not required by this example profile.' : `Example agitation range: ${p.minRpm}–${p.maxRpm} RPM.`} Chamber temperature and handling measurements do not establish product viability.</p></section>`).join('')}</div>`;
}
function render(force = false) {
  if (!snapshot || $('#shell').hidden) return;
  nav();
  if (view === 'settings' && !force && $('#page').dataset.view === 'settings') return;
  const focused = document.activeElement, focusId = focused?.id, selectionStart = focused?.selectionStart, selectionEnd = focused?.selectionEnd;
  const openDemo = $('#demo-panel')?.open;
  $('#page').innerHTML = ({ overview, deliveries, alerts, history, settings }[view])();
  $('#page').dataset.view = view; document.title = `RedRoute · ${titles[view]}`;
  if (openDemo && $('#demo-panel')) $('#demo-panel').open = true;
  if (focusId && document.getElementById(focusId)) { const el = document.getElementById(focusId); el.focus({ preventScroll: true }); if (typeof el.setSelectionRange === 'function' && el.type === 'search') el.setSelectionRange(selectionStart, selectionEnd); }
}
function navigate(next) { view = next; filter = 'all'; query = ''; render(true); window.scrollTo({ top: 0, behavior: 'instant' }); }
function openDialog(action) {
  const d = selected(); dialogAction = { action, deliveryId: d.id };
  $('#dialog-error').textContent = '';
  $('#dialog-eyebrow').textContent = d.id + ' · ' + d.destination;
  if (action === 'incident') {
    $('#dialog-title').textContent = 'Report a delivery issue';
    $('#dialog-description').textContent = 'Record an unexpected event for this delivery. This creates an in-app incident; it does not contact emergency services or stop the robot.';
    $('#dialog-fields').innerHTML = `<label class="field">Delivery<select name="deliveryId">${snapshot.deliveries.filter(d => d.status !== 'delivered').map(x => `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${x.id} · ${escape(x.destination)}</option>`).join('')}</select></label><label class="field">What happened?<textarea name="message" minlength="5" maxlength="500" placeholder="Describe the issue and any assistance needed…" required></textarea><small>Avoid entering patient names or other identifying information.</small></label>`;
    $('#dialog-submit').textContent = 'Create incident';
  } else {
    $('#dialog-title').textContent = 'Verify delivery receipt';
    $('#dialog-description').textContent = 'Confirm the unit identifier on the delivered package. This records receipt at the ward; it does not approve the blood for transfusion.';
    $('#dialog-fields').innerHTML = `<label class="field">Blood unit identifier<input name="code" placeholder="Enter the identifier on the package" autocomplete="off" required><small>For this demo, the package identifier is ${escape(d.unitCode)}. In the prototype, type the code or use a keyboard barcode scanner.</small></label>`;
    $('#dialog-submit').textContent = 'Confirm receipt';
  }
  $('#action-dialog').showModal();
}
document.addEventListener('click', async event => {
  const b = event.target.closest('button,a[data-nav]'); if (!b) return;
  try {
    if (b.dataset.staff) return await login(b.dataset.staff);
    if (b.dataset.nav) { event.preventDefault(); return navigate(b.dataset.nav); }
    if (b.dataset.select) { selectedId = b.dataset.select; return render(true); }
    if (b.dataset.open) { selectedId = b.dataset.open; return navigate('overview'); }
    if (b.dataset.history) { selectedId = b.dataset.history; return render(true); }
    if (b.dataset.filter) { filter = b.dataset.filter; return render(true); }
    if (b.dataset.scenario) { accept(await api(`/api/deliveries/${selectedId}/scenario`, { scenario: b.dataset.scenario })); return toast(b.dataset.scenario === 'offline' ? 'Demo feed paused. Lost-connection alert appears after 15 seconds.' : 'Demo scenario updated.'); }
    if (b.dataset.ack) { accept(await api(`/api/alerts/${b.dataset.ack}/acknowledge`, {})); return toast('Alert acknowledged. Monitoring continues.'); }
    if (b.dataset.resolve) { accept(await api(`/api/alerts/${b.dataset.resolve}/resolve`, {})); return toast('Incident marked resolved.'); }
    if (b.dataset.action === 'switch' || b.id === 'account') { await api('/api/logout', {}); return await showLogin(); }
    if (b.dataset.action) return openDialog(b.dataset.action);
    if (b.id === 'notification-button') return navigate('alerts');
    if (['close-dialog', 'cancel-dialog'].includes(b.id)) $('#action-dialog').close();
  } catch (e) { toast(e.message, true); }
});
document.addEventListener('input', e => { if (e.target.id === 'delivery-search') { query = e.target.value; render(true); } });
document.addEventListener('submit', async e => {
  const form = e.target;
  if (form.id !== 'action-form' && !form.dataset.profile) return;
  e.preventDefault();
  const submit = form.querySelector('button[type="submit"]') || form.querySelector('button');
  try {
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(form));
    if (form.dataset.profile) {
      await api('/api/profiles', { product: form.dataset.profile, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) });
      return toast('Example monitoring profile saved.');
    }
    const { action, deliveryId } = dialogAction;
    const data = await api(`/api/deliveries/${values.deliveryId || deliveryId}/${action}`, values);
    $('#action-dialog').close(); accept(data); toast(action === 'receive' ? 'Delivery receipt verified and recorded.' : 'Incident recorded. Review it in Alerts.');
  } catch (e) { if (form.id === 'action-form') $('#dialog-error').textContent = e.message; else toast(e.message, true); }
  finally { submit.disabled = false; }
});
$('#action-dialog').addEventListener('click', e => { if (e.target === $('#action-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
setInterval(() => { if (snapshot && !$('#shell').hidden && Date.now() - lastEventAt > 7000) render(); }, 2000);
try { snapshot = await api('/api/state'); $('#login').hidden = true; $('#shell').hidden = false; openFeed(); render(); } catch { await showLogin(); }
