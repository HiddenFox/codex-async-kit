# Release notes

## 1.1.9

- `--skip-git-repo-check` is no longer hardcoded: Codex's git-repository check is back on by default, and `skip_git_check` is now an opt-in boolean parameter on both `run` and `resume` for jobs that must run in non-git working directories (forfeits git rollback protection). (Direction: Frank, 2026-10-08.)

## 1.1.8

- Fixed resumed sessions ignoring the requested sandbox mode: `-c sandbox_mode=...` placed before the `resume` subcommand token was parsed by the parent `exec` and silently dropped, so resumed jobs always ran under the default `workspace-write` sandbox. The setting is now passed as an option of the `resume` subcommand itself. (Bug report: Ripple, 2026-09-29.)
- Added `--skip-git-repo-check` to both `exec` and `resume` so the kit can run in non-git working directories (e.g. data-eval workspaces) instead of failing with "Not inside a trusted directory".

## 1.1.7

- Strengthened post-install guidance: configure the installer's own `GROVE_TOKEN` before using the kit so usage reporting is not silently omitted.

## 1.1.6

- Usage report skips now leave a stderr trace, and the configuration documentation explains the behavior.

## 1.1.5

- Callback delivery now also sends an `Authorization: Bearer <token>` header alongside the existing URL query token. The query token is retained because the current Heart callback endpoint authenticates from the query parameter only (verified 2026-09-18); once Heart accepts header authentication, a future release can drop the URL token and keep it out of proxy and server access logs.

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
