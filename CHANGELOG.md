# Release notes

## 1.1.0

- Added optional, durable completion notifications for naturally completed and failed Codex jobs.
- Added per-job notification status, bounded retries, stable callback identity, and explicit suppression for caller opt-out and cancellation.
- Kept `run` and `resume` asynchronous; `status(job_id)` remains the authoritative result source and polling remains supported.
- Added local `callback.env` configuration without storing callback credentials in source, job data, or logs.
- Callback delivery does not prove an autonomous wake-up. Autonomous attention requires SBS, is best-effort, and has no fixed latency SLA.
