# Task 01 Independent Remediation Retest Report

## Verdict

**PASS_READY_FOR_LIVE_E2E.** The remediation closes the prior FTP-loopback validation defect without introducing a detected regression in the original independent-verification gates.

The first audit record, `docs/tasks/03-task01-independent-test-report.md`, was preserved unchanged.

## Remediation inspected

I read the appended remediation in the architect report and inspected the complete visible diffs for `callback.mjs`, `test/callback.test.mjs`, and `test/worker.test.mjs`.

- [`callback.mjs`](../../callback.mjs:46) now allowlists only `http:` and `https:` before host classification.
- [`callback.mjs`](../../callback.mjs:51) still restricts non-loopback callbacks to HTTPS; loopback `localhost` and validated numeric `127.*` inputs normalize to HTTP for local tests.
- [`test/callback.test.mjs`](../../test/callback.test.mjs:55) adds `ftp:`, `javascript:`, and `file:` rejection coverage, and [`test/callback.test.mjs`](../../test/callback.test.mjs:167) covers manual redirect containment.
- [`test/worker.test.mjs`](../../test/worker.test.mjs:193) verifies an FTP loopback config produces a redacted failure, zero attempts, and zero localhost requests.

## Independent reproduction and protocol probes

An independent stdin-fed Node probe used only a temporary directory, fake Codex child, and a `127.0.0.1` HTTP server.

| Case | Result |
|---|---|
| Prior failure: `ftp://localhost/being/?token=placeholder` | Rejected with `CallbackConfigError`. |
| `javascript://localhost/...` | Rejected with `CallbackConfigError`. |
| `file://localhost/...` | Rejected with `CallbackConfigError`. |
| `http://example.com/...` | Rejected with `CallbackConfigError`. |
| `http://localhost/...` and `https://localhost/...` | Accepted and derived to `http://localhost/being/api/callback`. |
| `http://127.0.0.1/...` and `https://127.9.8.7/...` | Accepted and derived to their HTTP loopback callback paths. |
| FTP worker configuration at a running `127.0.0.1` port | `MALFORMED_CONFIG_ZERO_REQUEST_REDACTED_PASS`: zero server requests; job stayed `completed`; notification became `failed`, with `attempts: 0`, `last_error: "Callback configuration is invalid"`, and no placeholder token persisted. |

The same probe emitted `URL_PROTOCOL_MATRIX_PASS`.

## Commands and results

| Command/check | Result |
|---|---|
| Independent Node protocol-matrix and worker malformed-config probe | PASS — results above; localhost-only traffic. |
| `npm test` | PASS — 24 passed; 0 failed, skipped, cancelled, or todo. |
| `node --check server.mjs`; `node --check worker.mjs`; `node --check callback.mjs`; `node --check smoke-test.mjs` | PASS. |
| JSON parse of `package.json` and `manifest.json` | PASS — `JSON_PARSE_PASS`. |
| Independent runtime/manifest `run` and `resume.notify` plus version check | PASS — `VERSION_SCHEMA_PASS 1.1.0`. |
| `git diff --check` | PASS — no whitespace errors; only Git CRLF conversion warnings. |
| `git check-ignore -v -- callback.env grove.env` | PASS — both files are explicitly ignored. No ignored environment file contents were read. |
| Visible-worktree credential-pattern scan | No apparent real credential. Matches were reviewed and limited to test/report placeholder token-query literals. |
| Tracked diff credential-pattern scan | PASS — no matches. |

## Original gate regression review

- **Credential isolation and URL handling:** token remains in the Authorization header only; derived URLs remove query strings; malformed protocols now fail before callback configuration is accepted. The new redirect test and prior local redirect probe confirm `redirect: "manual"` prevents following a localhost redirect target.
- **Terminal authority and persistence:** the tested worker path persists terminal state before callback delivery, and callback failure leaves the Codex `completed`/`failed` result authoritative.
- **Cancellation and terminal races:** exclusive outcome claiming remains unchanged; tests cover cancellation before worker startup and cancellation winning during startup, with no callback.
- **Retry identity and bounds:** stable `source=codex-async` and `task_id=job_id`, three-attempt bounds, 500/429/connection/timeout retry behavior, and non-retry 4xx behavior remain covered.
- **Notification state consistency:** delivered, failed, disabled, and suppressed paths remain covered; the remediation-specific malformed path is redacted, has zero attempts, and makes no request.
- **Async run/resume, schema, version, and platform paths:** fake-worker integration retains immediate run/resume behavior and schema/version parity. Windows `taskkill` and POSIX signaling code paths were inspected but remain mock-only.

## Limitations

- `smoke-test.mjs` remains excluded from `npm test`. It was inspected and syntax-checked only, not run, because it launches real Codex jobs in another workspace and would exceed the no-live/external-callback authorization.
- Automated tests use fake worker/Codex processes. They do not provide live proof of detached production spawning, Windows `taskkill`, POSIX signal behavior, real Codex resume, Heart inbox persistence, callback breaths, or SBS attention.
- This result authorizes only the Task 01 independent-verification gate. Any live E2E still requires the user's separate authorization and must distinguish callback delivery, Heart persistence, immediate callback breathing, and later SBS attention.

TESTER_TASK01_RETEST_RESULT: PASS_READY_FOR_LIVE_E2E
