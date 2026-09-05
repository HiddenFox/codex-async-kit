# Task 01 Independent Tester Report

## Verdict

**BLOCKED**. The local test suite and static checks pass, but callback URL validation accepts a non-HTTP(S) loopback Loom URL and silently converts it to HTTP. This violates the documented configuration contract and leaves malformed configuration classified as usable.

## Scope and method

I read Task 01 and the architect report, inspected the complete visible working-tree change set (modified files and every new source/test/document file), and reviewed all added tests. I did not edit product code, tests, configuration, versions, existing documentation, or any ignored environment file. No process command line or real credential was read. All executed callback traffic was confined to `127.0.0.1` mock servers.

## Blocking finding

### Medium — non-HTTP(S) loopback URLs are accepted and downgraded to HTTP

- Evidence: [`callback.mjs`](../../callback.mjs:50) only enforces `https:` when the host is not loopback, then [`callback.mjs`](../../callback.mjs:53) sets *any* loopback protocol to `http:`. Therefore `ftp://localhost/test-being/?token=placeholder` is accepted rather than rejected.
- Reproduction command:

  ```text
  node -e "import('./callback.mjs').then(({deriveCallbackConfig}) => console.log(deriveCallbackConfig('ftp://localhost/test-being/?token=placeholder').callbackUrl))"
  ```

  Result: `http://localhost/test-being/api/callback`.
- Required contract: Task 01 §4.1 requires validated URL parsing and permits HTTP only for `localhost`/`127.*` testing; it does not permit `ftp:`, `javascript:`, or any other scheme to become HTTP. A malformed local configuration should reach the redacted `failed` state, not make a callback request.
- Test gap: [`test/callback.test.mjs`](../../test/callback.test.mjs:47) covers HTTPS, HTTP on remote hosts, and a non-loopback lookalike, but not non-HTTP(S) schemes on loopback hosts. The current tests therefore do not prove the claimed malformed-configuration behavior for this input class.

## Checks executed

| Command | Result |
|---|---|
| `npm test` | PASS — 22 tests passed; 0 failed, skipped, cancelled, or todo. Local temporary directories, fake processes, and localhost servers only. |
| `node --check server.mjs`; `node --check worker.mjs`; `node --check callback.mjs` | PASS. |
| `node --check smoke-test.mjs` | PASS (syntax only). |
| `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('JSON_PARSE_PASS')"` | PASS — `JSON_PARSE_PASS`. |
| Independent PowerShell version/schema parity check for `package.json`, `manifest.json`, `serverInfo`, and `run`/`resume.notify` | PASS — `VERSION_SCHEMA_PASS 1.1.0`. |
| `git diff --check` | PASS — no whitespace errors (Git emitted only CRLF conversion warnings). |
| `git check-ignore -v -- callback.env grove.env` | PASS — both are ignored by the explicit `.gitignore` entries. |
| Visible-file credential-pattern scan over `git ls-files --cached --others --exclude-standard` | No apparent real credential. Matches were only deliberately named test placeholders and token-query test fixtures in `test/callback.test.mjs` and `test/worker.test.mjs`; each was reviewed. |
| Local redirect containment probe using `deliverCallback` with a `127.0.0.1` server returning `302 /sink` | PASS — `LOCAL_REDIRECT_CONTAINMENT_PASS`: first request carried the placeholder Authorization header, redirect target received zero requests, final state was one-attempt `failed`. |
| Non-HTTP(S) loopback configuration reproduction above | FAIL — demonstrated the blocking validation defect. |

## Review observations

- Terminal-before-callback ordering is substantively covered: the worker persists a terminal job before the mock callback reads it, and the observed persisted notification state is `delivering`. Callback failure does not overwrite the failed Codex result.
- Notification identity is stable in the payload (`source=codex-async`, `task_id=job_id`) across retries. Retry count and backoffs are bounded in implementation and exercised for 500, 429, connection error, and timeout.
- Explicit cancellation uses an exclusive outcome file before signaling the child; reviewed tests cover cancellation before worker startup and during startup. The worker does not notify after cancellation wins.
- `notify:false`, absent configuration, invalid configuration, payload failure, response-body redaction, UTF-8 truncation, runtime/manifest parity, and immediate run/resume returns are covered by the added suite.
- Redirect handling is defensively set to `manual` and independently verified against a localhost redirect; the added suite itself has no redirect-specific test.
- No live Heart, Loom, SBS, Grove, or external callback result was inferred from the mock checks.

## Observed limitations

- `smoke-test.mjs` is not included by `npm test`. I inspected it and separately syntax-checked it, but did **not** execute it: it launches real `codex` jobs in `D:\Workspace\code\Beings-Town` with a configured profile and would exceed the no-live/external-callback and localhost-only authorization. Thus real detached-process/Codex integration, live Heart persistence, immediate callback breath, and SBS attention remain unverified.
- The automated suite injects fake worker/Codex process implementations for server and worker behavior. It is strong for state transitions but does not prove production detached spawning, Windows `taskkill`, POSIX signals, or real Codex resume behavior end-to-end.
- The suite does not test malformed loopback protocols, which allowed the blocking condition above to escape.

TESTER_TASK01_RESULT: BLOCKED
