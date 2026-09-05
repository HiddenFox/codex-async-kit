# Task 03 Local Deployment and Live Callback E2E Report

Date: 2026-09-06
Repository: `D:\Workspace\code\codex-async-kit`
Installed Kit: `%USERPROFILE%\.heart-portal\kits\codex-async`
Tested version: `1.1.1`

## Deployment

The repository implementation was independently reviewed and `npm test` was rerun before deployment:

```text
tests 27
pass 27
fail 0
```

The installed Kit was upgraded from `1.1.0` to `1.1.1`. Product files were copied from the repository while preserving the private local `callback.env`, `grove.env`, `jobs`, and `logs`. SHA-256 checks confirmed both private env files were unchanged. A deployment backup was created at:

```text
C:\Users\feng.han\AppData\Local\Temp\codex-async-pre-1.1.1-20260906-013145
```

A post-deployment hash comparison confirmed every deployed product file matches the reviewed repository version.

## Installed Configuration Gate

A redacted configuration check against the installed Kit confirmed:

```text
version: 1.1.1
callback configured: true
protocol: https
host: echo.beings.town
path: /frank/api/callback
query keys: token only
authentication mode: query only
```

No credential value was printed or copied into this report.

## Live Job

A real short Codex job was started through the installed `1.1.1` server:

```text
job_id: codex-e0c793ee-706d-4d53-a2d1-11bd03421673
expected final message: TASK03_QUERY_CALLBACK_LIVE_OK
```

Persisted result after completion:

```text
job state: completed
exit code: 0
last message: TASK03_QUERY_CALLBACK_LIVE_OK
notification state: delivered
notification attempts: 1
HTTP status: 202
last error: null
```

This directly verifies that the previous Bearer-only HTTP 403 is resolved by the Heart Portal v0.8.0 query-token callback contract.

## Inbox Correlation

`inbox_read(source="codex-async")` returned one completion notification carrying the same fresh job ID:

```text
codex-async job completed: codex-e0c793ee-706d-4d53-a2d1-11bd03421673
```

This verifies authenticated callback acceptance and persistent inbox delivery for the installed `1.1.1` Kit.

## Credential Redaction

The real configured token was checked in memory against the fresh job record, job event log, and runtime logs. It was absent from all three. Product files in the installed Kit match the reviewed repository files.

## Boundary

HTTP 202 and the correlated inbox item prove callback acceptance and persistence. This run was initiated and inspected within an already active Heart turn, so it does not prove that `breathe_callback` independently started an immediate new turn. Receiver-side wake scheduling remains a separate issue.

TASK03_LOCAL_E2E_RESULT: PASS_QUERY_AUTH_AND_INBOX
