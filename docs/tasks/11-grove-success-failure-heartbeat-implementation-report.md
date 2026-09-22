# Task 11 Implementation Report: Grove Successful/Failed Heartbeat

## Changes

- Updated `server.mjs` so `reportUsage` accepts explicit `calls`, `successful`, and `failed` counts. It validates non-negative integer values and requires exactly one represented tool call.
- A normal `tools/call` handler result reports `{ calls: 1, successful: 1, failed: 0, last_used_at }`.
- A handler error, including an unknown tool or invalid arguments, reports `{ calls: 1, successful: 0, failed: 1, last_used_at }` before preserving the existing JSON-RPC error response.
- Heartbeat HTTP and network failures remain best-effort. Failure logging is also guarded so it cannot alter an already determined MCP result.
- `initialize`, `tools/list`, and invalid JSON remain outside the heartbeat path. Worker and callback completion behavior was not changed, so job terminal states do not create another heartbeat.

## Test coverage

The server integration test mocks `fetch`; no request is sent to Town. It covers successful and unknown-tool calls, no-token behavior, non-2xx heartbeat responses for both success and failure, and the non-heartbeat `initialize` and `tools/list` methods. Every captured request asserts `calls === successful + failed === 1` and checks `last_used_at` and the Bearer header.

## Validation

Completed after the implementation:

- `npm test`: passed: 30 tests, 0 failures, 0 skipped, 0 cancelled; duration 337.246 ms.
- `node --check server.mjs`: passed with no output.
- `node --check test/server.integration.test.mjs`: passed with no output.
- `git diff --check`: passed with no output.

The test run included the new heartbeat integration coverage and the existing config, callback, server, and worker suites.

## Production and boundary confirmation

No production heartbeat was sent: tests replace `fetch` and use `https://grove.test` only. No dependency installation, packaging, deployment, publishing, commit, push, Portal restart, or change outside `codex-async-kit` was performed. The existing untracked `docs/tasks/10-portal-lifecycle-false-completion.md` was not read or modified. The implementation follows the task's verified `GET /api/grove/help` contract, which explicitly supports `calls`, `successful`, and `failed`; no conflict with the source baseline was found.
