# Task 01 Live Heart Callback E2E Report

Date: 2026-09-06
Installed Kit: `codex-async` `1.1.0`
Implementation commit: `b02f4e2`
Prior installed E2E report: `docs/tasks/05-task01-installed-kit-e2e-report.md`

## Verdict

**BLOCKED_PRODUCTION_AUTH_CONTRACT_MISMATCH**

A private Frank Loom URL was installed in the Kit-local ignored `callback.env`. The URL itself authenticated successfully, but the production Loom 1.3.0 callback endpoint rejected the approved Bearer-only contract and accepted the same credential only as a query parameter. The Kit was not weakened to place credentials in callback URLs because the approved Task 01 security contract explicitly forbids that behavior.

## Secret handling

- The private Loom URL was written only to `%USERPROFILE%\.heart-portal\kits\codex-async\callback.env`.
- The file was restricted to the current Windows user.
- No URL query, token, Authorization value, or raw private configuration is present in this report, Git, job JSON, event JSONL, or callback error state.
- The Kit continued to remove query data and used `redirect: manual`.

## Normal completed job

- Job: `codex-b9fe3cc3-6685-4bdc-b3a5-3842f4bed7ab`
- Terminal state: `completed`, exit code `0`.
- Session: `01a0727c-7bb4-7300-99e3-9bdb5193ba28`.
- Final marker: `TASK01_CALLBACK_SUCCESS_20260906_005`.
- Callback result: `failed`, attempts `1`, HTTP `403`.

Observed authoritative event order:

```text
2026-09-05T16:52:55.013Z job.finished completed
2026-09-05T16:52:55.014Z notification.pending
2026-09-05T16:52:55.019Z notification.attempt attempt=1
2026-09-05T16:52:56.046Z notification.failed attempt=1 http_status=403 error_category=http
```

This separates Codex execution from callback authentication: the job completed normally before notification delivery failed.

## Natural failed job

- Job: `codex-48b186b7-9ce4-49c2-bb91-7ed4db2c56e3`
- Terminal state: `failed`, exit code `1`, caused by an unavailable explicitly selected model.
- Callback result: `failed`, attempts `2`, final HTTP `403`.
- The first attempt ended as a retryable connection failure; the second received the terminal `403`.

Observed authoritative event order:

```text
2026-09-05T16:12:23.819Z job.finished failed
2026-09-05T16:12:23.820Z notification.pending
2026-09-05T16:12:23.824Z notification.attempt attempt=1
2026-09-05T16:12:28.894Z notification.retry_scheduled attempt=1 retry_category=connection wait_ms=2000
2026-09-05T16:12:30.912Z notification.attempt attempt=2
2026-09-05T16:12:31.934Z notification.failed attempt=2 http_status=403 error_category=http
```

## Authentication isolation

The following probes used the same private credential without printing it:

| Probe | Result |
|---|---|
| Authenticated base Loom URL | HTTP `200`, Loom `1.3.0` |
| Callback endpoint with `Authorization: Bearer ...`, no query | HTTP `403`, `authentication required` |
| Callback endpoint with query-token compatibility, unique task id | HTTP `202`, `accepted=true`, `inbox_id=236` |
| Duplicate query-token delivery with identical `source + task_id` | HTTP `202`, same `inbox_id=236` |
| Heart `inbox_read(source=codex-async)` | One persisted matching callback item |

These results prove:

1. The supplied Loom credential is valid.
2. The callback endpoint exists and can persist a Heart inbox item.
3. Production currently does not accept the approved Bearer-only callback authentication.
4. Production does accept query-token authentication.
5. Callback deduplication by `source + task_id` is effective.
6. The Kit correctly refuses to report delivery on HTTP `403`.

## Remaining acceptance gap

A live Kit-originated `notification.delivered` event, immediate `breathe_callback`, and later SBS autonomous attention remain unverified. They require one of the following explicit resolutions:

1. Loom adds Bearer-token support to `/api/callback`, preserving the approved Kit security contract; or
2. The platform owner formally changes the callback contract and security decision, after which the Kit implementation, tests, README, and task specification must be revised together.

The evidence and question were posted to the Beings Town bonfire for `seam_walker` as sequence `650`. Until the platform owner responds, no production code change is justified.

TASK01_LIVE_CALLBACK_E2E_RESULT: BLOCKED_PRODUCTION_AUTH_CONTRACT_MISMATCH
