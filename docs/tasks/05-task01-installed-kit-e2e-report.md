# Task 01 Installed Kit E2E Report

Date: 2026-09-05
Installed path: `%USERPROFILE%\.heart-portal\kits\codex-async`
Release: `1.1.0`
Implementation commit: `b02f4e2`

## Verdict

**PARTIAL_PASS_CALLBACK_BLOCKED_BY_MISSING_CONFIGURATION**

The installed Kit passed real MCP initialize/schema, fresh run, session resume, controlled natural failure, persistence, and terminal event-order checks. A live Heart callback and SBS wake-up could not be exercised because neither the supported Kit-local `callback.env` file nor the controlled `CODEX_ASYNC_LOOM_URL` environment variable was present. No credential was inferred from process command lines or another service.

## Deployment gate

- Installed `manifest.json`, `package.json`, `server.mjs`, `worker.mjs`, and `callback.mjs` SHA-256 hashes matched the committed repository files.
- Installed manifest and package versions were both `1.1.0`.
- Installed MCP `initialize` returned `serverInfo.name=codex-async` and `serverInfo.version=1.1.0`.
- Installed `run` and `resume` schemas exposed `notify` with default `true`.
- Existing `grove.env`, `jobs/`, and `logs/` were preserved.
- SBS was enabled through Heart attunement before the E2E.

## Successful run

- Job: `codex-0a9485a6-b2c5-4f55-9dd5-a613f26d3d54`
- Prompt requested the exact harmless marker `CODEX_ASYNC_OK` and prohibited commands.
- `run` returned a fresh queued job immediately.
- Terminal state: `completed`, exit code `0`.
- Session: `01a07248-59d5-79c2-b903-a9ec5a1ae2d8`.
- Final message: `CODEX_ASYNC_OK`.
- Notification: `disabled`, attempts `0`, reason `not_configured`.

Observed authoritative event order:

```text
2026-09-05T15:56:07.846Z job.finished completed
2026-09-05T15:56:07.847Z notification.pending
2026-09-05T15:56:07.851Z notification.disabled not_configured
```

## Resume

- Job: `codex-be8db6ba-f2a7-4cb3-8e44-404d51a2647d`
- `resume` returned a new queued job immediately.
- Terminal state: `completed`, exit code `0`.
- `resumed_from` and final `session_id` both matched `01a07248-59d5-79c2-b903-a9ec5a1ae2d8`.
- Final message: `CODEX_RESUME_OK.`
- Notification: `disabled`, attempts `0`, reason `not_configured`.

Observed authoritative event order:

```text
2026-09-05T15:56:31.329Z job.finished completed
2026-09-05T15:56:31.330Z notification.pending
2026-09-05T15:56:31.333Z notification.disabled not_configured
```

## Controlled natural failure

- Job: `codex-6ee323e9-2f47-4fed-9513-85b15e64e24f`
- The job used an intentionally invalid model name and read-only sandbox, with no repository mutation requested.
- Terminal state: `failed`, exit code `1`.
- Notification: `disabled`, attempts `0`, reason `not_configured`.

Observed authoritative event order:

```text
2026-09-05T15:59:20.769Z job.finished failed
2026-09-05T15:59:20.770Z notification.pending
2026-09-05T15:59:20.773Z notification.disabled not_configured
```

## Unverified live acceptance items

The following Task 01 acceptance items remain unverified and must not be inferred from this report:

- HTTP callback delivery to Heart.
- Heart inbox persistence and deduplication of `source=codex-async` plus `task_id=job_id`.
- Immediate `breathe_callback` behavior.
- Later SBS autonomous attention.
- Causal proof that no human message or ordinary heartbeat triggered the observing turn.

To run that final gate, create the private untracked file `%USERPROFILE%\.heart-portal\kits\codex-async\callback.env` with Frank's own `CODEX_ASYNC_LOOM_URL`, restart Portal so the installed Kit is reloaded, and repeat the success and natural-failure jobs while Frank sends no follow-up message. The URL/token must not be added to this report or Git.

TASK01_INSTALLED_E2E_RESULT: PARTIAL_PASS_CALLBACK_BLOCKED_BY_MISSING_CONFIGURATION
