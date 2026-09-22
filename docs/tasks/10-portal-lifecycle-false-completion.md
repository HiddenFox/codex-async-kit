# Task 10: Prevent Portal lifecycle events from becoming false Codex results

> Status: Planned only - do not implement or execute without a new explicit authorization from Frank.
> Repository: `codex-async-kit`
> Created: 2026-09-09
> Implementation authorization: **not granted**

## 1. Problem

During the Windows restart around 2026-09-09 03:20 +08:00, Heart received an inbox item displayed as:

```text
[portal] unknown: portal_exec completed: ... node.exe server.mjs
```

`node.exe server.mjs` is the MCP server process for the installed `codex-async` Kit. It is a child of `heart-portal-windows-x86_64.exe`, not a `codex_async_run` or `codex_async_resume` job.

The machine restart terminated that process. The Portal lifecycle event was then represented as a `portal_exec completed` inbox notification without an attributable sender. That notification was incorrectly interpreted downstream as a completed `codex-async` Release Manager task, causing an unsupported user-facing completion message.

This task is to identify and correct the ownership/classification boundary that permits an internal Portal/Kit process lifecycle event to appear as a user tool completion. It is not a change to job-result callback delivery.

## 2. Verified observations

The following facts were observed locally on `D5-NJ-LT-0448`:

1. Windows recorded shutdown/restart activity beginning around 03:20, with the final boot at approximately 03:24 +08:00.
2. The suspicious inbox item was timestamped 03:20:49 and identified its source as `[portal] unknown`.
3. `codex-async` job JSON files and its runtime JSONL contained no job start, terminal transition, or callback delivery in the 03:00-03:30 window.
4. The installed Kit process topology after reconnect was:

```text
explorer.exe
  -> cmd.exe /c start-portal.bat
    -> heart-portal-windows-x86_64.exe --connect ...
      -> node.exe server.mjs
```

5. `start-portal.bat` starts `heart-portal-windows-x86_64.exe`; it does not invoke `node.exe server.mjs` directly.
6. The active `node.exe server.mjs` is therefore an MCP Kit service managed by Portal, rather than a detached Codex worker.
7. There was no evidence of a scheduled task, service, or `codex-async` job that launched a Release Manager task at 03:20.

## 3. Non-conclusions

Do not treat the following as established until source-level evidence is collected:

- The exact Portal component that emitted the inbox event.
- Whether the event was emitted immediately during shutdown, retained locally, or replayed after reconnection.
- Whether the classification bug is in Portal, Heart, the transport protocol, or more than one layer.
- Whether all Kit MCP service exits are affected, or only `codex-async`.
- Whether a normal intentional Portal shutdown currently produces the same event.

The only confirmed conclusion is that the inbox item was not evidence of a `codex-async` job result.

## 4. Goal

Ensure that internal MCP Kit service lifecycle events cannot be surfaced to Heart as `portal_exec completed` results and cannot be confused with a `codex-async` terminal job notification.

A legitimate `codex-async` completion must remain distinguishable by durable job evidence, including a real `job_id` and the persisted terminal record returned by `codex_async_status(job_id)`.

## 5. Scope

### In scope

- Trace the source and serialized payload of the observed `[portal] unknown` event.
- Inspect how Portal starts, supervises, and reports Kit MCP server processes.
- Inspect how Heart maps Portal events into inbox items.
- Define a typed event contract separating:
  - interactive `portal_exec` tool execution;
  - Portal process lifecycle events;
  - Kit MCP server lifecycle events;
  - detached `codex-async` job completion callbacks.
- Implement the smallest compatible correction in the owning layer once ownership is proven.
- Add regression tests for process exit caused by shutdown/disconnect and ordinary restart.
- Update relevant operator documentation and release notes.

### Out of scope

- Changing the existing `codex-async` terminal job persistence contract.
- Treating a Portal lifecycle event as an alternate source of truth for a job.
- Inferring or fabricating a task name, role, result, or completion state from a process command line.
- Starting or restarting Portal, changing production configuration, or deploying any fix without separate authorization.
- Reworking SBS wake-up behavior unless the evidence shows an explicit dependency.

## 6. Required investigation sequence

1. Preserve available evidence before reproducing:
   - exact inbox item payload and timestamp;
   - Portal/Heart transport logs, if retained;
   - Windows shutdown/restart events;
   - `codex-async` jobs directory and runtime JSONL showing the absence of a matching job.
2. Locate the Portal code path that launches Kit MCP services and handles their child-process exit.
3. Locate the code path that labels an event as `portal_exec completed` and sends it over the Portal connection.
4. Locate the Heart receiver and inbox persistence code for Portal-originated events.
5. Establish whether a lifecycle event needs to be sent at all. If yes, give it an explicit non-tool event type and ensure it cannot enter the tool-result inbox path.
6. Reproduce in an isolated environment using a deliberate Kit service stop and a simulated Portal disconnect/restart. Do not use a real Windows reboot until lower-risk reproduction is exhausted.
7. Implement only after the owning layer and expected contract are documented and reviewed.

## 7. Candidate contract requirements

These are requirements for the eventual design, not a preselected implementation:

1. A `portal_exec completed` event must correspond to a Portal tool invocation with a durable invocation identity.
2. A managed Kit MCP server exit must not inherit the identity or presentation of an unrelated tool invocation.
3. A lifecycle event, if exposed, must carry an explicit type such as `kit_service_exited`, a kit identifier, an exit classification, and no invented user task semantics.
4. Shutdown, disconnect, cancellation, and normal process exit must be distinguishable where the operating system provides enough evidence; unknown cause must remain unknown.
5. Heart must not turn an event without a valid tool invocation/job identity into a completion message that invites result handling.
6. `codex-async` completion handling continues to use the persisted job JSON plus `codex_async_status(job_id)` as the authority.
7. No token, Loom URL, command-line secret, or private process environment may be written into inbox content or logs.

## 8. Acceptance criteria

The task is complete only when all of the following are demonstrated:

1. Source-level evidence identifies the producing and consuming components for the original event class.
2. A controlled exit of `node.exe server.mjs` produces no inbox item labeled `portal_exec completed`.
3. A Portal restart/disconnect produces no false `codex-async` task result and no invented task semantics.
4. A real `portal_exec` invocation still produces its correct completion event.
5. A real `codex_async_run(..., notify:true)` completion still persists its job terminal state and, when configured, delivers its normal callback with the correct `job_id`.
6. Regression tests cover the false-classification path and pass in the owning repository.
7. The change is independently reviewed before deployment.

## 9. Operational rule until fixed

Treat an inbox event as a `codex-async` job completion only when it identifies a real `job_id` and that job's persisted record/status confirms a terminal state. A `[portal] unknown` item, a process command line, or an exit code alone is not a task result and must not be converted into a user-facing completion claim.

## 10. Handoff note

Frank asked for this task to be written down before a planned disconnect. No implementation, test execution, process restart, configuration change, commit, or deployment is authorized by this document.
\r\n## 11. Investigation result (2026-09-09)\r\n\r\nImplementation task: `codex-657ac358-2527-40bb-b704-3369401af472` (completed, exit code 0). No repository source change was appropriate.\r\n\r\nSource-level findings in `D:\Workspace\code\heart-portal`:\r\n\r\n- `portal_exec(background=true)` alone enters `ProcessManager::spawn` through `portal/src/tools/exec.rs:45`.\r\n- `portal_exec completed` callback payloads are built and sent only by `portal/src/process_manager.rs:243` and `portal/src/process_manager.rs:480`; they use generated `sess_...` invocation identities.\r\n- Kit MCP services instead follow `KitManager -> McpConnection::spawn` through `portal/src/kits/manager.rs:423` and `portal/src/mcp/connection.rs:41`, bypassing `ProcessManager`. EOF marks the MCP connection unavailable; shutdown terminates/waits/logs the child. Neither path posts a callback.\r\n- This checkout contains no production `/api/callback` receiver or inbox persistence path. Its only callback receiver is a test-only Axum route at `portal/src/process_manager.rs:972`.\r\n\r\nTests run:\r\n\r\n- `cargo test --manifest-path portal/Cargo.toml kits::manager::tests -- --nocapture`: passed, 16/16.\r\n- `cargo test --manifest-path portal/Cargo.toml process_manager::tests -- --nocapture`: 14/15 passed; existing kill/shutdown callback-suppression tests passed.\r\n- The remaining failure, `callback_posted_on_process_exit`, is a pre-existing test/implementation mismatch: the test expects `Authorization: Bearer`, while the committed delivery code deliberately uses the `?token=` query parameter. It was not changed because it is outside this task.\r\n\r\nConclusion: the observed false completion must be classified in the external Heart receiver/inbox/transport layer, or it came from a Portal build not represented by this source checkout. A controlled Kit-exit/Portal-disconnect integration test needs that receiver source or an authorized runtime harness; this task has not demonstrated acceptance criteria 2-7.\r\n