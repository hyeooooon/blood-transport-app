# Prototype verification

Verified locally on 12 October 2026 with Node.js 24 and headless Microsoft Edge via Playwright. Runtime minimum is Node 20.

- `npm test`: 16 tests covering telemetry, ward visibility, alert deduplication and recovery, receipt constraints, robot/simulator isolation, unknown dispatch time, separate agitation/impact, supervisor profile changes, HTTP/SSE scope and persisted workflow records after restart.
- `npm run check`: syntax checks for server, store and browser application.
- `python -m py_compile scripts/telemetry_bridge.py`: Python bridge syntax check.
- `node scripts/verify-browser.mjs`: desktop 1440px and phone 390px layouts without horizontal overflow; temperature alert/acknowledgement/recovery; connection loss; stale ETA removal; incident reporting/resolution; incorrect and correct receipt identifiers; search retained during refresh; profile controls restricted to supervisor. No unexpected browser console errors or JavaScript exceptions. Expected HTTP errors for unsigned-in access and an incorrect receipt code are excluded.

Independent read-only code review identified simulator-off enforcement, fictional dispatch-time inheritance and stale delivery-list ETAs. These were corrected and covered by regression checks. A follow-up review identified false duration-alert recovery when dispatch time becomes unknown; a regression test now preserves that alert.

Not verified: physical TurtleBot integration, sensor calibration, ROS topics, indoor localization accuracy, real hospital identity or patient-system integration, clinical suitability decisions, external notifications, physical navigation/stop/unlock commands. These need actual hardware and institutional requirements.
