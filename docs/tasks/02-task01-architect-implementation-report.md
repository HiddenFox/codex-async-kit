# Task 01 Architect Implementation Report

## Outcome

Task 01 is implemented as a release candidate for `codex-async-kit` version `1.1.0`. Natural `completed` and `failed` jobs now persist their authoritative terminal result before making an optional Heart callback. The callback is a bounded attention signal with stable identity; `status(job_id)` remains the authoritative result interface.

No Git commit was created. No live Heart callback or SBS test was run. Automated callback tests used only `localhost`/`127.*`, temporary directories, fake child processes, and placeholder tokens.

Independent verification and separately authorized live E2E remain intentionally outside this architect implementation pass.

## Exact implementation changes

### Callback module

Added `callback.mjs` with the following responsibilities:

- Reads `CODEX_ASYNC_LOOM_URL` from kit-local `callback.env` first and falls back to the process environment.
- Parses the Loom URL with `URL`, requires HTTPS for non-loopback hosts, restricts HTTP test support to `localhost` and numeric `127.*` IPv4 addresses, rejects credentials/control characters, removes query and fragment data, and derives `<loom-being-base>/api/callback`.
- Keeps the token only in memory and sends it only as `Authorization: Bearer ...`; callback requests use manual redirect handling so credentials and payloads are not forwarded through redirects.
- Builds the Portal-compatible payload with `source=codex-async`, `task_id=job_id`, distinct completed/failed summaries, the authoritative job ID, and the required next action.
- Excludes prompts, event history, stdout, and stderr from the payload.
- Truncates the final-message preview to 16 KiB at valid UTF-8 boundaries and enforces a 64 KiB serialized payload ceiling.
- Implements three attempts, 30-second request timeouts, 2-second/4-second backoffs, bounded `Retry-After` handling, retries for connection errors/timeouts/429/5xx, and no retries for other 4xx or payload errors.
- Returns only bounded, fixed-category error text and never consumes or persists response bodies.

### Worker lifecycle and persistence

Updated `worker.mjs` to:

- Preserve Codex lifecycle ownership in the worker while delegating callback mechanics to `callback.mjs`.
- Persist all terminal Codex fields and an initial notification object atomically before `job.finished` and before callback configuration or network work.
- Persist notification transitions before emitting the corresponding redacted lifecycle events.
- Emit `notification.pending`, `notification.attempt`, `notification.retry_scheduled`, `notification.delivered`, `notification.failed`, `notification.disabled`, and `notification.suppressed` as applicable.
- Keep callback failures independent from the job's `completed` or `failed` state.
- Record `disabled` for missing configuration, redacted `failed` for malformed configuration, and `suppressed` for `notify:false`.
- Re-check durable cancellation state throughout process startup/event handling and before terminal completion.
- Use a single exclusive per-job outcome claim (`cancelled` or `terminal`) to close cancellation/terminal write races. A cancellation that wins the claim cannot generate a completion callback; a natural terminal claim prevents a stale concurrent cancel from replacing it.
- Export the worker operation and support dependency injection for deterministic process tests without changing the CLI entry behavior.

### MCP server and job API

Updated `server.mjs` to:

- Add `notify` to `run` and `resume`, default it to `true`, validate it as a Boolean, and persist only that non-secret preference.
- Preserve immediate detached-worker returns for `run` and `resume`.
- Mark explicit cancellation as `notification.state=suppressed` and acquire the exclusive cancellation outcome before signalling the Codex process.
- Keep cancellation signal errors redacted and non-fatal after durable cancellation is recorded.
- Expose the notification object through the existing `status` and `list` job representations.
- Report MCP server version `1.1.0`.
- Export server operations and isolate stdio startup behind the direct-entry guard for integration testing.
- Resolve `worker.mjs` relative to the installed server module and allow an explicit kit-home override for isolated tests/deployments.

### Schemas, versioning, setup, and documentation

- Updated `manifest.json` to version `1.1.0`, added matching `notify` schemas for `run` and `resume`, documented optional private callback configuration, and retained independent Grove settings.
- Updated `package.json` to version `1.1.0` and added the automated `npm test` command.
- Added `callback.env.example` with placeholders only.
- Added an explicit `callback.env` ignore rule to `.gitignore`; the existing broad environment-file rules remain.
- Replaced the previously corrupted/non-English `README.md` content with an English `1.1.0` guide covering asynchronous behavior, setup, security, notification states, retry policy, authoritative polling, and the honest SBS boundary.
- Added `CHANGELOG.md` release notes that distinguish callback delivery from best-effort SBS attention with no fixed latency SLA.

### Automated tests

Added:

- `test/callback.test.mjs` for URL derivation, loopback restrictions, file/environment configuration precedence, missing configuration, credential placement, redacted events, payload identity/content/bounds, Unicode truncation, retry classifications, stable IDs, bounded timeout/connection exhaustion, non-retry 4xx responses, and payload-construction failure.
- `test/worker.test.mjs` for terminal-before-callback ordering, delivered/failed/disabled/suppressed states, callback failure independence, malformed-configuration redaction, explicit cancellation, and cancellation during process startup.
- `test/server.integration.test.mjs` for version/schema agreement, immediate run/resume returns, list compatibility, Boolean validation, and durable cancellation state.
- `test/run-tests.mjs` as a Node built-in test-runner entry that works without nested test-process isolation. Process doubles are injected because the managed Windows test sandbox rejects nested child process creation; HTTP behavior still uses local mock servers.

## Verification results

Final verification was run on 2026-09-05 in the repository workspace.

### Automated suite

Command: `npm test`

Result: PASS

- Tests: 22
- Passed: 22
- Failed: 0
- Cancelled/skipped/todo: 0
- External callbacks: 0

### Coverage run

Command: `node --experimental-test-coverage test/run-tests.mjs`

Result: PASS

| Scope | Line coverage | Branch coverage | Function coverage |
|---|---:|---:|---:|
| `callback.mjs` | 98.33% | 80.85% | 93.75% |
| `server.mjs` | 78.49% | 51.72% | 84.00% |
| `worker.mjs` | 85.98% | 73.44% | 66.67% |
| Overall | 88.64% | 70.83% | 82.14% |

### Static and repository checks

- `node --check server.mjs`: PASS
- `node --check worker.mjs`: PASS
- `node --check callback.mjs`: PASS
- JSON parse checks for `package.json` and `manifest.json`: PASS
- Runtime/manifest `run` and `resume` property parity: PASS in automated tests
- Version surfaces (`package.json`, `manifest.json`, MCP `serverInfo`, README): `1.1.0`
- `git diff --check`: PASS
- Working tree: intentionally modified/untracked implementation files; no commit created

### Secret and callback-safety checks

- Confirmed `callback.env` and `grove.env` are ignored by Git.
- Scanned tracked and intended untracked files for common API key, private key, Bearer credential, and token-query shapes: zero credential-shaped values found.
- Scanned Git patch history for the same credential shapes while excluding private environment-file paths: zero matches.
- Tests assert that placeholder callback tokens do not appear in job JSON, derived callback URLs, or event logs.
- Tests assert that raw callback response bodies are not persisted.
- No ignored environment file contents or real credentials were read.
- No request was sent to a live Heart, Loom, Grove, or other external callback endpoint.

## Remaining gate

The release candidate is ready for the required independent reviewer to attempt to disprove credential isolation, terminal ordering, cancellation suppression, retry identity, result authority, schema parity, version alignment, and behavioral test quality. Live Heart/SBS acceptance remains prohibited until that review passes and the human separately authorizes live callback activity.

## 2026-09-05 Independent Test Remediation

The independent tester reported that `deriveCallbackConfig` accepted `ftp://localhost/...` and rewrote it to HTTP. This remediation changes the parser before host classification: it now accepts only `http:` or `https:`. HTTP remains allowed only for `localhost` and valid numeric `127.x.x.x` IPv4 loopback addresses; all non-loopback callback URLs remain HTTPS-only. Any other protocol is rejected with the existing `CallbackConfigError`, so the worker persists the existing redacted `notification.state = "failed"`, `attempts = 0`, and `last_error = "Callback configuration is invalid"` without performing a request.

Added focused automated evidence:

- `ftp://localhost/...`, `javascript://localhost/...`, and `file://localhost/...` each throw `CallbackConfigError` in configuration derivation.
- A worker job configured with an `ftp://127.0.0.1:<port>/...` Loom URL completes normally, records the redacted invalid-configuration notification failure, makes zero requests to a localhost mock callback server, and has zero delivery attempts.
- Added a localhost redirect-containment regression: a `302 /sink` response leaves the initial request at one, sends zero requests to `/sink`, keeps the placeholder Authorization header only on the initial request, and ends as a one-attempt HTTP 302 notification failure. This verifies the existing `redirect: "manual"` safeguard.

Verification after remediation:

- `npm test`: PASS — 24 passed, 0 failed, skipped, cancelled, or todo; all callback traffic remained localhost-only.
- `node --experimental-test-coverage test/run-tests.mjs`: PASS — 90.89% overall line coverage; `callback.mjs` 98.33% line coverage and 81.25% branch coverage.
- `node --check server.mjs`, `worker.mjs`, `callback.mjs`, and `smoke-test.mjs`: PASS.
- JSON parsing for `package.json` and `manifest.json`: PASS.
- `git diff --check`: PASS (only Git CRLF conversion warnings were emitted).
- Trailing-whitespace and source-ASCII scans: PASS.
- Current visible-worktree credential-pattern scan: PASS — 17 tracked or intended-untracked files, zero credential-shaped values. Ignored `callback.env` and `grove.env` were not read and are both confirmed ignored.
- Git-history credential-pattern scan, excluding private environment-file paths: PASS — zero matches.
- No Tester report was edited and no live test was run.

ARCHITECT_TASK01_RESULT: READY_FOR_INDEPENDENT_TEST
