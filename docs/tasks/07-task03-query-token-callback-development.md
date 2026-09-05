# Task 03: Align Codex Async callback authentication with Heart Portal v0.8.0

Date: 2026-09-06
Owner: Developer
Repository: `D:\Workspace\code\codex-async-kit`
Target release: `1.1.1`

## Goal

Modify `codex-async-kit` so completion callbacks use the single authentication contract implemented by Heart Portal v0.8.0 (`b1c3adb`):

```text
POST /<being>/api/callback?token=<loom_token>
```

The callback request must not send `Authorization: Bearer <token>`.

This is a direct contract replacement. Do not add an authentication mode, compatibility switch, automatic fallback, dual-send behavior, or Bearer support for Heart callbacks.

## Evidence and scope

Observed production behavior and Heart Portal history establish the current contract:

- Bearer-only callback request: HTTP 403 `authentication required`.
- Query-token callback request: HTTP 202 and one persistent inbox item.
- Heart Portal v0.8.0 commit `b1c3adb`: `fix: use query param token for callback auth (Heart doesn't check Bearer header)`.

This task addresses authenticated callback delivery and inbox persistence only. HTTP 202 must not be described as proof that `breathe_callback` created an immediate Heart turn. Receiver-side wake scheduling is a separate unresolved issue.

## Required implementation

1. Update `deriveCallbackConfig()` in `callback.mjs`:
   - Continue parsing `CODEX_ASYNC_LOOM_URL` and validating scheme, host, credentials, path, and token.
   - Derive `/<being>/api/callback` from the Loom URL.
   - Preserve exactly the `token` authentication query parameter on the derived callback URL.
   - Remove unrelated query parameters and the fragment.
   - Use `URL` and `URLSearchParams`; do not concatenate or manually encode the token.
   - Keep external HTTPS and localhost/127.* behavior unchanged.

2. Update `deliverCallback()`:
   - POST to the query-authenticated callback URL.
   - Do not send an `Authorization` header.
   - Keep `Content-Type: application/json`.
   - Keep `redirect: "manual"`; redirects remain terminal failures and must not receive a second request.
   - Preserve existing retry, timeout, payload, idempotency, persistence, and redaction behavior.

3. Maintain credential safety under the production contract:
   - Never include the callback URL or token in notification state, event fields, persisted job output, error strings, or logs.
   - Tests may inspect placeholders in memory but must not print real credentials.
   - Keep `callback.env` ignored and examples placeholder-only.

4. Update active documentation and metadata:
   - Bump `package.json` and `manifest.json` from `1.1.0` to `1.1.1`.
   - Update current README and applicable current install/configuration text to state that Heart Portal v0.8.0 authenticates `/api/callback` with `?token=` and that no Bearer header is sent.
   - Do not rewrite historical task reports (`docs/tasks/01` through `06`); they are audit evidence of the old design and live failure.
   - Add an implementation report at `docs/tasks/08-task03-query-token-callback-implementation-report.md`.

## Required tests

Update or add automated tests proving all of the following:

1. A remote Loom URL containing `token` plus unrelated query parameters derives exactly:
   `https://echo.beings.town/<being>/api/callback?token=<URL-encoded-token>`.
2. Localhost and 127.* derivation still uses HTTP and retains only the encoded token query.
3. The callback server observes the token in the request query and observes no `authorization` header.
4. Tokens containing characters that require URL encoding round-trip through `URLSearchParams` without manual concatenation errors.
5. Redirects are not followed; the redirect target receives zero requests.
6. Success/failure notification state and event records remain redacted and contain neither the placeholder token nor the full callback URL.
7. Existing retry, timeout, stable `task_id`, payload bound, invalid protocol, malformed configuration, notify=false, and worker ordering tests remain green.
8. Version consistency checks cover `package.json` and `manifest.json` at `1.1.1`.

Run at minimum:

```text
npm test
```

Report the exact test count and result. Also run a repository search for stale active Bearer-only callback instructions, while preserving historical reports unchanged.

## Constraints

- Work only in `D:\Workspace\code\codex-async-kit`.
- Do not modify Heart Portal or Loom/Heart receiver code.
- Do not deploy into `%USERPROFILE%\.heart-portal\kits`.
- Do not run a real callback or use a real token.
- Do not commit or push.
- Do not amend, squash, reset, revert, or otherwise alter existing commits.
- Preserve all pre-existing changes and audit reports.

## Acceptance marker

End the implementation report and final response with exactly one of:

```text
DEVELOPER_TASK03_RESULT: PASS_READY_FOR_LOCAL_DEPLOY
DEVELOPER_TASK03_RESULT: BLOCKED
```
