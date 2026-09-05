# Codex Async Kit

Current release: `1.1.0`.

Codex Async Kit runs persistent Codex CLI jobs behind a small MCP server. `run` and `resume` return a fresh `job_id` immediately, while a detached worker runs Codex and persists progress. Use `status(job_id)` for the authoritative result.

## Process and data model

```text
Heart Portal
  └─ node server.mjs                  long-lived MCP server
       └─ node worker.mjs <job_id>    detached job worker
            └─ codex exec ...         one Codex execution
```

Each `run` or `resume` creates a new job. A `job_id` identifies one execution. A Codex `session_id` identifies resumable conversation context and can be passed to `resume` to create another job.

Job data is stored under `~/.heart-portal/kits/codex-async`:

- `jobs/<job_id>.json` is the authoritative current state.
- `jobs/<job_id>.events.jsonl` contains the job event stream.
- `logs/runtime-YYYY-MM-DD.jsonl` contains redacted lifecycle events.

The worker retains the most recent 100 Codex events in the job file. Logs and job files are local private data and may contain Codex output or local paths.

## MCP tools

| Tool | Required parameters | Optional parameters | Result |
|---|---|---|---|
| `run` | `prompt`, `cwd` | `model` or `profile`, `sandbox`, `notify` | Immediately returns a new `job_id`. |
| `resume` | `session_id`, `prompt`, `cwd` | `model` or `profile`, `sandbox`, `notify` | Immediately returns a new `job_id` for the resumed session. |
| `status` | `job_id` | None | Returns authoritative job and notification state. |
| `list` | None | `limit` | Returns recent jobs. |
| `cancel` | `job_id` | None | Cancels an active job and suppresses its completion notification. |

`notify` defaults to `true`, preserving compatibility for callers that omit it. Set `notify: false` to persist the result without making a completion callback. `profile` and `model` are mutually exclusive.

Typical flow:

```text
run(prompt, cwd) -> job_id
status(job_id) -> queued | running | completed | failed | cancelled
resume(session_id, follow_up_prompt, cwd) -> new job_id
status(new_job_id)
```

## Completion notifications

For a naturally `completed` or `failed` job, the worker:

1. Drains Codex output and atomically persists the terminal result.
2. Appends `job.finished` to the local event stream.
3. Posts one logical notification to the owning Heart, when configured.
4. Atomically persists the final notification state and a redacted notification event.

The callback is an attention signal, not a result channel. Its bounded preview can help the Being decide what to inspect, but `status(job_id)` remains authoritative. Retries reuse `source=codex-async` and `task_id=<job_id>` so Heart can deduplicate one logical completion.

Delivery uses at most three attempts, with 2-second and 4-second backoffs. Connection errors, timeouts, HTTP 429, and HTTP 5xx are retried. Other HTTP 4xx responses are not retried. Each request has a 30-second timeout. Callback failure never changes the Codex terminal state.

Notification states exposed by `status` are:

- `pending`: the terminal result is persisted and delivery has not been acknowledged.
- `delivering`: an HTTP attempt is active.
- `delivered`: Heart returned an HTTP 2xx response.
- `failed`: configuration was invalid, payload construction failed, or bounded delivery attempts were exhausted.
- `disabled`: callback configuration is absent.
- `suppressed`: the caller used `notify: false` or explicitly cancelled the job.

The metadata also reports `attempts`, `last_attempt_at`, `delivered_at`, `http_status`, and a bounded redacted `last_error`.

### SBS boundary

A successful callback means Heart acknowledged the completion signal. It does not prove that Side by Side (SBS) immediately woke the Being. When SBS is enabled, the signal is eligible to influence a later autonomous breath, with no fixed latency SLA. When SBS is disabled, Heart may retain the signal for a later human-triggered or scheduled breath. Continue using `status(job_id)` as the fallback in either case.

## Private callback setup

Copy `callback.env.example` to the Kit directory as `callback.env`:

- Windows: `%USERPROFILE%\.heart-portal\kits\codex-async\callback.env`
- macOS/Linux: `~/.heart-portal/kits/codex-async/callback.env`

Set your private Loom URL locally:

```env
CODEX_ASYNC_LOOM_URL=https://echo.beings.town/<being_id>/?token=<loom_token>
```

Restart Portal after changing the file. The worker derives `<loom-being-base>/api/callback`, removes the query string, and sends the token only in the `Authorization: Bearer` header. The Loom URL is a private key: never commit it, paste it into public channels, include it in logs, or reuse `GROVE_TOKEN` for callbacks. `callback.env` is ignored by Git.

For controlled deployments and localhost-only tests, `CODEX_ASYNC_LOOM_URL` can be supplied through the process environment when the file has no value. External callback URLs must use HTTPS. `localhost` and `127.*` use HTTP to support local test servers.

Missing callback configuration disables notification without affecting jobs. Invalid configuration records a redacted notification failure without changing a completed Codex job into a failed one.

## Grove usage reporting

Usage reporting remains optional and independent of Heart callbacks. Create `grove.env` in the Kit directory when reporting is desired:

```env
GROVE_TOKEN=<your own Grove Bearer token>
GROVE_KIT_ID=OteJGwtOzLqL7jmyZ2PfM
GROVE_API_BASE=https://beings.town
```

Use only the installer's Grove token. The server reads `grove.env` first and then the process environment. Without `GROVE_TOKEN`, jobs continue normally and usage reporting is disabled. A failed Grove heartbeat is logged locally and does not fail the MCP operation.

## Development and verification

Run the automated suite with:

```text
npm test
```

Tests use temporary directories, placeholder credentials, fake Codex processes, and localhost callback servers. They do not contact Heart or any other external callback endpoint.

No live callback or SBS acceptance test should run until an independent reviewer has verified credential handling, terminal ordering, cancellation suppression, callback identity, schemas, and version surfaces. Live acceptance must report callback delivery, Heart inbox persistence, immediate callback breath, and later SBS attention as separate observations.
