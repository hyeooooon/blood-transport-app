# RedRoute prototype

Approved direction: responsive web app, telemetry server, swappable robot adapter, and clearly labelled simulator. Preserve the supplied cream, deep red, rounded-panel design and the RedRoute name.

## Scope
Ward staff track assigned ward deliveries, floor-plan position, ETA, temperature and handling history, lock state, battery, and timestamp freshness. Blood-bank and supervisor demo roles can view all deliveries. Staff can report incidents, acknowledge alerts, and verify a delivery using its unit identifier. No real patient records, clinical release decisions, or physical robot controls.

## Architecture
Dependency-free Node 20+ HTTP server with server-sent events; semantic HTML/CSS/JavaScript client. A store owns telemetry validation, product profiles, alert lifecycle, scoped visibility, and audited handovers. Persist readings and workflow records locally in ignored data/state.json. Demo identity sessions are server-issued cookies, explicitly not institutional authentication. Gateway endpoint accepts bearer-authenticated telemetry. Default server binding is loopback only.

## Monitoring
Use example, configurable transport profiles, not clinically approved limits. Report chamber air temperature, never claim core blood temperature. Motion is an impact measurement; platelet agitation is separately reported. Unknown, stale, or absent values cannot produce a normal state. Threshold excursion alerts remain in history after recovery; acknowledgement does not resolve them. Telemetry older than 15 seconds produces an unavailable state; location timestamp is independently checked. Robot-source telemetry overrides simulation for that delivery and cannot be overwritten by simulator commands.

Real-source transition clears synthetic chart history and the fictional dispatch time. The robot supplies transportStartedAt; if unavailable, duration is explicitly unknown and normal receipt remains blocked. Global simulator-off mode also rejects one-shot scenario commands. Delivery list ETAs use the same freshness rules as the map.

## Demo workflow
Select a demo staff role, inspect seeded deliveries, simulate temperature excursion, impact, delay, connection loss, or lock opening, acknowledge alerts, report an incident, and verify receipt by unit code. Demo-only scenario controls are visible and never command hardware. Simulator follows a schematic hospital route. Real position coordinates are normalized 0-100 against the supplied floor map and map ID.

## Verification
Node tests for validation, stale data, alert deduplication/recovery, ward scope, source isolation, acknowledgement and receipt constraints. HTTP tests for session/auth, ingestion, scope and persistence. Browser checks for main flows, responsive layout and console errors.
