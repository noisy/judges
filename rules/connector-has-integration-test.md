---
id: connector-has-integration-test
mode: agent
scope: ["src/connectors/**/*.py"]
severity: medium
model: small
budget: 90s, $0.25
---
Intent: every connector has an integration test.
Rule: a connector module `src/connectors/<name>.py` is covered when a test under `tests/integration/` imports it or calls its functions. Look for the tests; do not assume they are missing. Report one finding per connector without an integration test, on line 1 of the connector file.
