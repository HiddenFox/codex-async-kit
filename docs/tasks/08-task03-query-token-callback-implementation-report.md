# Task 03 Query-Token Callback Implementation Report

Date: 2026-09-06
Target release: 1.1.1

## Implemented contract

Completion callbacks now use the Heart Portal v0.8.0 contract:

```text
POST /<being>/api/callback?token=<loom_token>
```

`deriveCallbackConfig()` parses the Loom URL with `URL`, validates the existing scheme, host, credentials, path, and token rules, converts loopback URLs to HTTP as before, and derives the callback endpoint. It rebuilds the query with `URLSearchParams` so only the token parameter remains; unrelated parameters and fragments are removed.

`deliverCallback()` sends that query-authenticated URL with `Content-Type: application/json` and no `Authorization` header. Manual redirect handling, retry behavior, timeout behavior, payload construction, stable task identity, persistence, and redaction behavior are unchanged.

## Verification

`npm test` passed: 27 tests passed; 0 failed, cancelled, skipped, or todo.

The automated coverage includes remote, localhost, and `127.*` URL derivation; URLSearchParams encoding round trips; mock-server query-token delivery with no authorization header; redirect containment; notification/event redaction; retry and timeout behavior; stable task identity; payload limits; invalid configuration; `notify: false`; worker ordering; and version consistency for `package.json` and `manifest.json` at `1.1.1`.

No real callback was sent. Tests used localhost mock servers and placeholder credentials only.

## Documentation and audit preservation

Current README and manifest configuration text state the Heart Portal v0.8.0 query-token contract and explicitly state that no Bearer header is sent. `callback.env.example` remains placeholder-only and `callback.env` remains ignored.

A repository search for active Bearer-only Heart callback instructions found none outside the preserved historical Task 01 through 06 audit documents. Those reports were not modified. Existing Grove Bearer-token documentation remains unrelated to Heart callback authentication.

HTTP 202 remains evidence of callback acceptance and inbox persistence only; it is not evidence that `breathe_callback` created an immediate Heart turn. Receiver-side wake scheduling remains separate.

DEVELOPER_TASK03_RESULT: PASS_READY_FOR_LOCAL_DEPLOY
