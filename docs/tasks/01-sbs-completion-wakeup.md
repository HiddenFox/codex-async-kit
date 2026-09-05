# Task 01: Codex async completion notification and SBS wake-up

> Status: Implemented and independently verified - live E2E pending
> Repository: `codex-async-kit`
> Proposed release: `1.1.0`
> Created: 2026-09-05
> Implementation authorization: **granted by Frank on 2026-09-05**

## 1. Goal

When a `codex-async` job reaches a natural terminal state, persist the job result first, then deliver a durable completion signal to the owning Being through Heart's callback endpoint.

If Side by Side (SBS) is enabled, Heart can use that signal during an autonomous breath so the Being can inspect the job, judge the result, and continue the workflow without waiting for a new human message or manual `status(job_id)` polling.

This feature must preserve the existing asynchronous contract:

```text
run/resume -> immediately returns job_id
Codex runs in the detached worker
worker persists the terminal job state
worker posts one logical completion notification
Heart stores the callback signal
SBS / Heart scheduling gives the Being a later opportunity to act
Being calls status(job_id) for the authoritative result
```

The callback is an attention signal, not the source of truth. `jobs/<job_id>.json` remains authoritative.

## 2. Authoritative facts and current gap

### 2.1 Confirmed platform facts

1. seam_walker announced SBS at Bonfire seq 645 on 2026-09-05. With SBS enabled, a Being may wake during human silence, evaluate signals such as reminders, surfaced memories, and messages, and either act or remain quiet. SBS is not a fixed timer and does not promise a fixed wake-up latency.
2. The approved Heart Portal PRD defines `POST <loom-being-base>/api/callback` with `Authorization: Bearer <loom_token>`. The callback writes a persistent Heart inbox item and is intended to trigger `breathe_callback`.
3. The installed Portal is `heart-portal 0.8.0`. Its source implements callback delivery for processes started by `portal_exec(background=true)`.
4. Portal injects only `PORTAL_KIT_NAME`, `PORTAL_KIT_DIR`, and `PATH` into a Kit process. It does not currently pass its callback URL or a scoped callback credential to Kits.
5. `codex-async-kit` does not use Portal's `ProcessManager`. Its `server.mjs` starts a detached `worker.mjs`, and the worker starts `codex exec`. Portal therefore sees the MCP `run` call finish immediately and cannot observe the later Codex process exit.
6. The current Kit (`1.0.1`) only persists terminal status and supports caller polling. It has no callback, inbox, or wake-up implementation.

### 2.2 Honest wake-up boundary

The implementation may guarantee that a valid callback is delivered and acknowledged by Heart. It must not claim that SBS itself was directly invoked, because no public "trigger SBS now" API is documented.

The product contract is:

- **Delivery contract:** completion notification is posted to Heart and persisted/deduplicated according to Heart's callback contract.
- **Attention contract:** when SBS is enabled, the completion signal is eligible to influence an autonomous breath. Immediate wake-up is best-effort until independently demonstrated in live E2E.
- **SBS disabled:** the callback may still be stored, but the Kit must not promise an autonomous turn. The Being can process it on a later human-triggered or scheduled breath.

Live acceptance must report separately whether callback delivery, inbox persistence, immediate `breathe_callback`, and later SBS attention were observed. One must not be inferred from another.

## 3. Scope

### 3.1 In scope

- Notify Heart after a job naturally reaches `completed` or `failed`.
- Keep `run` and `resume` non-blocking.
- Add optional local callback configuration without committing credentials.
- Derive the callback endpoint from a Loom URL using the Portal 0.8.0 rule.
- Use a stable callback identity so retries do not create duplicate logical completions.
- Persist notification state on the job for diagnosis.
- Retry transient delivery failures with bounded backoff.
- Suppress notifications for explicit cancellation.
- Add unit/integration tests with a local mock callback server.
- Perform a real Heart + SBS E2E only after implementation and independent code verification pass.
- Update user documentation and align all Kit version surfaces to `1.1.0`.

### 3.2 Out of scope

- Changing Heart, Portal, Loom, or SBS code.
- Enabling or disabling SBS from the Kit.
- Reading the Portal parent process command line to steal `--connect` credentials.
- Reusing `GROVE_TOKEN` as a Heart callback credential.
- Publishing a Loom token in `manifest.json`, source files, logs, job JSON, test fixtures, or Git history.
- Sending completion messages to Bonfire, Lark, or other public channels.
- Streaming intermediate Codex events to Heart.
- Automatically deciding whether development output is correct; the Being remains responsible for judging the result.
- Removing the `status(job_id)` interface or existing polling support.
- Claiming a fixed completion-to-wake latency.

## 4. Proposed configuration contract

### 4.1 Current release path

Add an optional Kit-local file:

- Windows: `%USERPROFILE%\\.heart-portal\\kits\\codex-async\\callback.env`
- macOS/Linux: `~/.heart-portal/kits/codex-async/callback.env`

Contents:

```env
CODEX_ASYNC_LOOM_URL=https://echo.beings.town/<being_id>/?token=<loom_token>
```

Rules:

1. Read `callback.env` first and optionally fall back to process environment variable `CODEX_ASYNC_LOOM_URL` for controlled test/deployment environments.
2. Parse the URL; do not perform string concatenation on unvalidated input.
3. Derive the callback URL exactly as Portal 0.8.0 does:

```text
https://echo.beings.town/alice/?token=abc
-> https://echo.beings.town/alice/api/callback
```

4. Preserve the Loom scheme, except `localhost` and `127.*` use `http` for tests.
5. Send the token only in `Authorization: Bearer ...`; remove it from the request URL.
6. Never persist or log the Loom URL, token, Authorization header, or query string.
7. Missing configuration disables notification without breaking job execution. The terminal job must expose `notification.state = "disabled"` with a non-secret reason.
8. Malformed configuration must not crash the worker or change a successful Codex result into a failed job. Record a redacted notification error.
9. Provide `callback.env.example` with placeholders only. Keep the real `callback.env` ignored by Git.
10. Document that the Loom URL is a private key and must never be sent to Bonfire or committed.

### 4.2 Preferred future migration

The long-term design should let Portal inject a short-lived or scoped callback capability into each Kit process. Once Portal exposes that contract, migrate away from duplicate Loom URL storage. This future integration is not part of Task 01 and must not be invented inside the Kit.

## 5. Job API contract

Add an optional field to both `run` and `resume`:

```json
{
  "notify": true
}
```

- Default: `true`.
- `notify: false`: persist the terminal job normally and set `notification.state = "suppressed"`; do not make a callback request.
- Existing callers that omit `notify` remain compatible.
- `cancel(job_id)` always suppresses notification, matching Portal's rule that an intentional kill must not create a false completion wake-up.

Update both the runtime `tools` schema in `server.mjs` and the published schema in `manifest.json`.

## 6. Terminal ordering and authority

For a natural `completed` or `failed` exit, the worker must use this order:

1. Drain stdout/stderr and determine the natural terminal state.
2. Set `state`, `exit_code`, `signal`, `finished_at`, `updated_at`, `session_id`, `last_message`, and error fields.
3. Initialize non-secret notification metadata.
4. Atomically persist the terminal `job.json`.
5. Append `job.finished` to the job event stream/runtime log.
6. Attempt callback delivery.
7. Atomically persist the final notification delivery metadata.
8. Append a redacted `notification.delivered`, `notification.failed`, `notification.disabled`, or `notification.suppressed` event.
9. Exit the worker.

Consequences:

- A callback failure never changes `completed` to `failed`.
- Heart receiving the callback never becomes evidence that the Codex result is correct.
- The callback payload points back to `job_id`; the Being must call `status(job_id)` for authoritative, current details.
- Notification metadata must not overwrite terminal job fields or lose recent Codex events.

## 7. Callback payload

Use the Heart callback shape already established by Portal:

```json
{
  "source": "codex-async",
  "task_id": "codex-<uuid>",
  "summary": "codex-async job completed: codex-<uuid>",
  "result": {
    "schema_version": 1,
    "job_id": "codex-<uuid>",
    "state": "completed",
    "session_id": "<codex-session-id-or-null>",
    "exit_code": 0,
    "finished_at": "2026-09-05T15:00:00.000Z",
    "cwd": "D:\\Workspace\\code\\project",
    "last_message_preview": "<bounded preview>",
    "preview_truncated": false,
    "next_action": "Call codex_async_status with this job_id, inspect the authoritative result, then decide whether to report, verify, resume, or stay quiet."
  }
}
```

Payload rules:

- `source` is exactly `codex-async`.
- `task_id` is exactly `job_id`; retries reuse it. Heart's callback deduplication must collapse retries into one logical inbox item.
- Use `failed` in the summary for failed jobs.
- Do not include the original prompt, full event history, full stdout, or full stderr.
- Limit `last_message_preview` by UTF-8 bytes (proposed maximum: 16 KiB), preserving valid UTF-8 and recording `preview_truncated`.
- If no final agent message exists, include a short redacted failure summary; do not dump arbitrary stderr.
- Keep the serialized payload well below Heart's 256 KiB callback limit.
- Treat local paths and final agent output as private Being data. They may be sent to the owning Heart, but never written to public telemetry.

## 8. Notification state model

Persist a non-secret object on each job:

```json
{
  "notification": {
    "requested": true,
    "state": "pending",
    "attempts": 0,
    "last_attempt_at": null,
    "delivered_at": null,
    "http_status": null,
    "last_error": null
  }
}
```

Allowed states:

- `pending`: terminal job persisted, delivery not yet acknowledged.
- `delivering`: an HTTP attempt is active.
- `delivered`: Heart returned 2xx.
- `failed`: bounded attempts exhausted or configuration is invalid.
- `disabled`: no callback configuration exists.
- `suppressed`: caller set `notify:false` or the job was explicitly cancelled.

`last_error` must contain only a bounded, redacted category/message. It must never contain a request URL with query parameters, token, Authorization header, payload body, or raw response body.

## 9. Delivery and retry policy

Match Portal's approved baseline unless tests demonstrate a required compatibility adjustment:

- HTTP client timeout: 30 seconds.
- Attempts: 3 total.
- Backoff before attempts 2 and 3: 2 seconds, then 4 seconds.
- Retry: connection errors, timeout, HTTP 5xx, and HTTP 429 (respect bounded `Retry-After` when practical).
- Do not retry: other HTTP 4xx, malformed local configuration, or payload construction errors.
- Any HTTP 2xx counts as delivered.
- Delivery runs only after terminal persistence and may extend worker lifetime, but must never delay the original `run`/`resume` MCP response.
- The worker must have a bounded total exit time; it must not retry forever.

Task 01 does not promise recovery after all attempts have failed. Because failure is persisted, `status(job_id)` remains the recovery path. A separate task may add a durable outbox/replay policy after real failure data exists.

## 10. Module boundaries

Preferred implementation shape:

- Add a small `callback.mjs` module responsible for configuration parsing, URL derivation, payload construction, redaction, UTF-8-safe truncation, retry classification, and delivery.
- Keep Codex process lifecycle and terminal state authority in `worker.mjs`.
- Keep MCP request validation and job creation in `server.mjs`.
- Pass only the non-secret per-job `notify` preference through `job.json`.
- Let the worker read callback credentials at delivery time; never write credentials into a job file.

Do not duplicate callback parsing/delivery logic between `server.mjs` and `worker.mjs`.

## 11. Logging and observability

Add structured, redacted events:

```text
notification.pending
notification.attempt
notification.retry_scheduled
notification.delivered
notification.failed
notification.disabled
notification.suppressed
```

Each event may include:

- `job_id`
- attempt number
- terminal job state
- HTTP status
- elapsed milliseconds
- retry category
- redacted error category

Each event must exclude:

- Loom URL
- callback URL query
- token or Authorization header
- original prompt
- request payload body
- unbounded response body

`status(job_id)` must expose notification state so the Being can distinguish:

- job still running,
- job finished and callback delivered,
- job finished but notification disabled/suppressed,
- job finished but callback delivery failed.

## 12. Required automated tests

Use Node's built-in test runner and local temporary directories/mock HTTP servers. No real credentials or live Heart calls in automated tests.

### 12.1 Configuration and security

- Valid HTTPS Loom URL derives the expected callback URL.
- `localhost` and `127.*` derive an HTTP callback URL.
- Token appears only in the Authorization header.
- Derived URL and all logs contain no token or query string.
- Missing configuration produces `disabled`.
- Malformed configuration produces a redacted `failed` notification without changing job terminal state.
- `callback.env.example` contains placeholders only; real `callback.env` is ignored.

### 12.2 Payload and identity

- `source` is `codex-async`.
- `task_id` equals `job_id` and is stable across retries.
- Completed and failed summaries are distinct.
- Prompt, full events, and full stderr are absent.
- Long Unicode final messages are truncated by bytes without invalid UTF-8.
- Payload remains below the configured size ceiling.

### 12.3 Ordering and state

- The mock callback cannot receive a request before terminal `job.json` exists.
- Callback failure does not change `completed`/`failed` terminal state.
- Successful delivery ends at `notification.state = delivered`.
- Exhausted retry ends at `notification.state = failed` with the expected attempt count.
- `notify:false` makes zero HTTP requests and records `suppressed`.
- Explicit cancellation makes zero HTTP requests and records `suppressed`.

### 12.4 Retry behavior

- Connection error, timeout, 500, and 429 retry according to policy.
- 400, 401, 403, and 413 do not retry.
- A later successful retry produces one logical `task_id`.
- All retries are bounded and the worker exits.

### 12.5 Regression

- Existing `run`, `resume`, `status`, `list`, and `cancel` behavior remains compatible.
- `run` and `resume` still return before Codex completion.
- Jobs remain inspectable when callback is disabled or unavailable.
- Grove usage reporting behavior and credentials remain independent.

## 13. Independent verification gate

After implementation, a separate tester must attempt to disprove the developer's conclusions before live E2E. The tester must review at least:

1. Whether any credential can enter Git, logs, job JSON, callback URL, error text, or Grove telemetry.
2. Whether callback delivery can happen before authoritative terminal persistence.
3. Whether cancellation or Portal/Kit shutdown can create a false completion notification.
4. Whether retries reuse the same `source + task_id` identity.
5. Whether a callback failure silently changes or hides the real Codex terminal result.
6. Whether the runtime schema and `manifest.json` schema agree.
7. Whether every version surface reports `1.1.0`.
8. Whether automated tests prove behavior rather than only matching source strings.

No live callback request is authorized until this independent gate passes.

## 14. Live E2E acceptance

Prerequisites:

- Frank explicitly authorizes live E2E.
- A release candidate has passed implementation tests and independent verification.
- Portal 0.8.0 or later is connected to the same Being.
- `callback.env` contains Frank's own private Loom URL locally.
- SBS is enabled separately in Loom or through Being attunement.
- The E2E prompt is harmless, produces no repository modification, and contains a unique marker.

Run two jobs while Frank sends no follow-up message:

1. A short successful Codex job.
2. A controlled natural failure job that does not expose secrets or damage files.

For each job, capture separate evidence for:

- `run` returned immediately with a fresh `job_id`.
- Terminal `job.json` was persisted before notification delivery.
- Exactly one logical callback identity used `source=codex-async` and `task_id=<job_id>`.
- Heart accepted/persisted the callback.
- Whether an immediate callback breath occurred.
- Whether a later SBS autonomous breath occurred.
- The Being received the exact fresh `job_id`, called `status(job_id)`, and distinguished the success/failure correctly.
- No human message was the actual wake trigger.
- No duplicate human-visible report was produced after callback retries.

Allowed outcomes must remain factually separate:

- `DELIVERY_PASS_WAKE_PASS`
- `DELIVERY_PASS_WAKE_NOT_OBSERVED`
- `DELIVERY_FAIL`
- `INCONCLUSIVE_TRIGGER_CAUSALITY`

Do not report a wake-up pass merely because the callback endpoint returned 2xx. Do not report a delivery failure merely because the Being chose to remain quiet under SBS.

## 15. Documentation and release requirements

Update after implementation:

- `README.md`: completion notification flow, SBS boundary, setup, security, status fields, fallback polling.
- `manifest.json`: `notify` parameter, release version, and provisioning instructions without secrets.
- `package.json`: version `1.1.0` and test script.
- MCP `serverInfo.version`: `1.1.0`.
- `callback.env.example` and `.gitignore`.
- Release notes: explicitly state that callback delivery is implemented, while autonomous attention requires SBS and has no fixed latency SLA.

Before packaging, verify no real URL token appears anywhere in tracked files or generated artifacts.

## 16. Acceptance criteria

Task 01 is complete only when all of the following are true:

- [ ] `run` and `resume` remain asynchronous and backward compatible.
- [ ] Natural `completed` and `failed` jobs persist terminal state before any callback attempt.
- [ ] Configured jobs send one deduplicable logical completion notification to Heart.
- [ ] Missing/invalid callback configuration never breaks Codex job completion.
- [ ] Explicit cancellation does not notify.
- [ ] Notification retry, state, and errors are bounded, persisted, and redacted.
- [ ] Credentials never enter source, manifest, logs, jobs, telemetry, test evidence, or Git history.
- [ ] The callback tells the Being to inspect authoritative `status(job_id)` rather than trusting a preview.
- [ ] Automated tests cover security, ordering, retries, suppression, payload bounds, and regressions.
- [ ] Independent verification passes before live E2E.
- [ ] Live E2E distinguishes delivery, inbox persistence, immediate callback wake, and SBS attention with evidence.
- [ ] All version surfaces and documentation agree on `1.1.0`.
- [ ] No code is committed without Frank's separate approval.

## 17. Decisions requiring Frank's confirmation

Before implementation, confirm these product choices:

1. Use a separate private `callback.env` containing `CODEX_ASYNC_LOOM_URL` as the current integration path.
2. Notify on both natural `completed` and natural `failed` jobs.
3. Suppress notification for explicit `cancel`.
4. Add per-job `notify` with default `true` when callback configuration exists.
5. Include only a 16 KiB final-message preview and require `status(job_id)` for the authoritative result.
6. Use three bounded delivery attempts (2s/4s backoff), with no durable replay after exhaustion in Task 01.
7. Release this backward-compatible feature as `1.1.0`.
8. Treat immediate callback wake and later SBS autonomous attention as separate live acceptance observations, with no fixed latency promise.

## 18. Sources

- SBS announcement: Beings Town Bonfire seq 645, seam_walker, 2026-09-05.
- First SBS field report: Bonfire seq 646, Alice, 2026-09-05.
- Approved Portal callback design: <https://github.com/d5z/heart-portal/blob/main/docs/async-callback-prd.md>
- Portal callback implementation: `portal/src/process_manager.rs` and `portal/src/main.rs` in `d5z/heart-portal` main.
- Current Kit implementation: `server.mjs`, `worker.mjs`, `manifest.json`, and `README.md` in this repository.
