# Release notes

## 1.1.4

- Grove heartbeat now reports each terminal MCP tools/call as calls=1 plus explicit successful/failed counts (success: 1/0; failure: 0/1); heartbeat delivery remains best-effort and asynchronous Codex job terminal states are not double-counted.

## 1.1.3

- Clarified the Grove and README description of the durable async control plane and the distinction between Inbox notifications and authoritative job status.

## 1.1.2

- Unified Grove reporting and Heart callback settings in one private `codex-async.env` file.
- Added a whitelist-based release packaging script that emits a Grove-ready `tar.gz` without private, development, or runtime files.

## 1.1.1

- Updated Heart Portal v0.8.0 completion callbacks to authenticate with the Loom token query parameter and no Bearer header.

## 1.1.0

- Added optional, durable completion notifications for naturally completed and failed Codex jobs.
- Added per-job notification status, bounded retries, stable callback identity, and explicit suppression for caller opt-out and cancellation.
- Kept `run` and `resume` asynchronous; `status(job_id)` remains the authoritative result source and polling remains supported.
- Added local `callback.env` configuration without storing callback credentials in source, job data, or logs.
- Callback delivery does not prove an autonomous wake-up. Autonomous attention requires SBS, is best-effort, and has no fixed latency SLA.
