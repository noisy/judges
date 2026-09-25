---
id: one-call-per-connector
scope: ["src/connectors/**/*.py"]
severity: high
check: judge
model: small
budget: 30s, $0.10
---
Intent: a connector is a thin adapter to one external service.
Rule: one HTTP call per public function; no calls to other connector functions; no branching on domain data. A call that only works after another call belongs in a service function, and the service function gets the integration test.
Example: src/connectors/service_a.py::get_download_link
