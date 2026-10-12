# RedRoute implementation plan

1. Write behavior tests for telemetry, alert lifecycle, visibility and handovers. Run them failing, then implement the store.
2. Implement local HTTP server, scoped SSE, demo sessions, bearer-authenticated ingest, persistence and simulation. Test real HTTP requests.
3. Build the cream/red responsive dashboard, map, condition charts, delivery list, alerts, history, demo session selector and verified receipt dialog.
4. Document startup, demo workflows, telemetry schema, sensor/map assumptions and hospital integration boundaries.
5. Run test suite, syntax checks, HTTP and browser checks; launch the prototype locally for review.
