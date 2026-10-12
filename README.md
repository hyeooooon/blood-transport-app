# RedRoute

A working blood-transport monitoring prototype for CDE2300. The design follows the supplied RedRoute reference: cream surfaces, deep red accents, rounded panels, a hospital route map, and condition/status cards.

## Run locally

Requires **Node.js 20 or newer**. There are no runtime packages to install.

```powershell
npm start
```

Open **http://127.0.0.1:3000**. On Windows, use `npm.cmd start` if PowerShell prevents running `npm.ps1`. Stop with Ctrl+C. Set `$env:PORT = '3002'` to change the port.

Choose a fictional staff workspace:

| Demo staff | Access |
| --- | --- |
| Sarah Lee | Ward 4B deliveries |
| Maya Lim | Ward 6A deliveries |
| Alex Tan | Blood-bank view, all wards |
| Jordan Chen | Supervisor view, all wards; edit example profiles |

Demo identities are deliberately selectable. These are **not hospital-verified accounts**. Institutional login and authoritative ward/patient assignments require hospital integration. Server-side checks scope delivery data and workflow actions to the chosen demo workspace.

## Try the prototype

1. Sign in as Sarah Lee and select RR-2048.
2. Expand **Demo scenario controls** below the dashboard.
3. Choose **Temperature excursion**, then open **Alerts**. Acknowledge the alert; it remains active.
4. Return to Overview and choose **Normal readings**. The excursion is retained in history with its recovery time.
5. Try **Connection loss**. After 15 seconds, current readings become unavailable and alerts appear. Restore **Normal readings** to reconnect.
6. Use **Report issue** to create an in-app incident. Resolve it from Alerts when handled. Reporting does not send an external message or stop the robot.
7. Choose **Arrive at ward**, then **Verify receipt**. Enter the example package identifier shown in the dialog. An incorrect identifier is rejected. Normal receipt requires fresh measurements and no active issues.
8. View **History** and download a JSON journey report. Switch to Jordan to edit the example monitoring limits in Settings.

Demo controls never command hardware. Robot navigation, physical stop/unlock, barcode camera scanning, institutional login, patient matching and external notifications are not implemented. A keyboard barcode scanner can enter a unit identifier in the receipt field.

## Real robot / sensor connection

The dashboard receives server-sent events every two seconds and immediately after mutations. A robot adapter sends JSON to `POST /api/telemetry` with `Authorization: Bearer <token>`. Set a matching `TELEMETRY_TOKEN` in both the server and adapter environments. The loopback-only local default is `local-prototype-token`.

The adapter contract is independent of TurtleBot model and ROS version. When you have hardware access, identify its ROS version, navigation pose topic, map frame, temperature sensor interface, motion sensor and compartment status signal. The supplied Python bridge can transport the resulting newline-delimited JSON; it does not invent readings or implement a ROS node.

```json
{
  "robotId": "RR-01",
  "deliveryId": "RR-2048",
  "timestamp": "2026-10-12T12:00:00.000Z",
  "transportStartedAt": "2026-10-12T11:53:00.000Z",
  "temperatureC": 4.2,
  "impactG": 0.08,
  "agitationRpm": null,
  "batteryPct": 82,
  "locked": true,
  "status": "in_transit",
  "etaSeconds": 360,
  "position": {
    "x": 47,
    "y": 58,
    "floor": "L4",
    "mapId": "demo-hospital",
    "timestamp": "2026-10-12T12:00:00.000Z"
  }
}
```

**Replace the timestamps with actual measurement and dispatch times.** The example above is a schema illustration, not a replayable current reading. Device and server clocks must be synchronized. Updates more than 60 seconds old or over 5 seconds in the future are rejected. Subsequent updates for the same source must increase in time. Current readings become stale after 15 seconds.

`transportStartedAt` is the actual dispatch timestamp and cannot be later than the measurement. First robot ingestion discards the fictional demo dispatch time. If dispatch time is unknown, omit this field or send `null`; the app flags the transport timer as unknown and blocks normal receipt until a dispatch timestamp is supplied. Subsequent packets may omit it to retain the recorded real dispatch time. All other telemetry fields are required.

Unavailable sensor values must be `null`. A null temperature/impact/agitation/lock/battery is displayed as unavailable and creates an appropriate monitoring issue. Position may be `null`; the server retains last known coordinates but marks them stale. `agitationRpm: null` is expected for the demo red-cell profile. For platelets, agitation is checked separately from incidental impact. Impact is an adapter-defined gravity-compensated motion metric, not raw accelerometer magnitude; calibrate its definition and threshold against the actual sensor.

Allowed reported statuses: `preparing`, `in_transit`, `delayed`, `arrived`. `delivered` is set only by verified staff receipt. Delivery and robot IDs must match an existing configured pair. The initial pairs are RR-2048/RR-01, RR-2049/RR-02 and RR-2050/RR-03; edit `seed()` in `lib/store.js` for your demonstration setup before creating saved state.

When real telemetry is first accepted, simulation is disabled **for that delivery**, and its chart starts with real readings. Other demo deliveries continue to simulate. To disable the entire simulator, set `$env:SIMULATOR = 'off'` before starting the server.

### Indoor position

Use the robot's localization pose when available; GPS is not a requirement of this app. Convert the pose into normalized map coordinates: x increases left-to-right, y top-to-bottom, both 0–100. Both axis calibration and floor/map identity must correspond to your physical map. The included plan is an illustrative Level 4 map, not a surveyed hospital map. The interface declines to plot a robot on an unmatched floor/map. Replace the SVG in `floorMap()` in `public/app.js` with your mapped demonstration area and update the adapter's transform.

### Temperature

The UI reports **chamber air temperature**, not blood core temperature. Choose and calibrate a physical probe, then specify its placement. Do not relabel a chamber sensor as a direct measurement of the blood. The shipped ranges, motion limits, agitation range and journey timer are illustrative alert profiles, not validated clinical rules. Existing excursions remain recorded after recovery, and missing data cannot clear sensor excursions. This app never establishes suitability for transfusion.

### Forwarding measured readings

On the machine that can reach the local server:

```powershell
$env:TELEMETRY_TOKEN = 'your-development-token'
npm start
```

In a separate terminal with the same token:

```powershell
$env:TELEMETRY_TOKEN = 'your-development-token'
python scripts/telemetry_bridge.py
```

The bridge reads one complete measured JSON object per line from stdin. It can also be piped from your future ROS adapter. It preserves measurement timestamps and reports rejected updates on stderr. Failed measurements are not retried or given new timestamps; connection monitoring exposes missing data.

The server binds to `127.0.0.1`. For a separate TurtleBot computer, use an SSH port-forward or an institution-approved network gateway; do not expose this demo identity system to a hospital network. Production transport/authentication and hospital deployment require a separate integration effort.

## Persistence and reports

Local workflow state, alerts, audit events and up to 180 recent readings per delivery are saved to `data/state.json` (ignored by Git). Sessions are in memory and expire after eight hours; restart requires selecting a demo identity again. History timestamps use Singapore time in the interface; exported timestamps are ISO UTC.

Record saves are serialized and use atomic replacement with short retries for transient Windows/OneDrive locks. If saving still fails, the server reports the failure and retains the complete temporary snapshot for recovery rather than discarding it.

To start a fresh demonstration, stop the server, preserve any report you need, and rename `data/state.json` to a backup filename. Restart seeds fictional deliveries again. This also removes robot-source assignments from the active demo state. Do not reset state while a real adapter is transmitting. For long-term monitoring, replace bounded local JSON storage with an appropriate telemetry database and retention policy.

## Verification

```powershell
npm test
npm run check
```

Tests cover scope, telemetry validation and ordering, stale data, separate agitation/impact checks, alert acknowledgement/recovery, incident audit, receipt verification, simulator/robot isolation, configurable limits and the HTTP integration flow. The browser smoke test additionally checks desktop/mobile overflow, alert and receipt workflows, and search persistence during live refresh:

```powershell
# Optional browser verification only (not needed to run the app):
npm install --no-save playwright
npx playwright install chromium
node scripts/verify-browser.mjs
```

Browser verification runs an isolated in-memory server, leaving your saved demonstration data untouched. It writes screenshots under ignored `tmp/`. Default UI is system-font based and requires no external fonts, map APIs, cloud accounts or network services.
