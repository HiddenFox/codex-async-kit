# Codex Async Kit 使用说明

## Release

Current release: `1.0.0`.

## 进程模型

### 角色与生命周期

这里有两个不同的 MCP 概念：

- `node server.mjs` 是 **codex-async Kit 自己的 MCP server**。Portal 按 `manifest.json` 的 `eager: true` 配置启动它，并通过 stdio 与它通信；它通常存活到 Portal 关闭、Kit 重载或该 MCP stdio 会话断开为止。
- Kit **不会启动或调用 `codex mcp-server`**。它使用的是 Codex CLI 的一次性命令 `codex exec ...`，而不是让 Codex 作为 MCP server 常驻。

一次 `run` 或 `resume` 的进程关系为：

```text
Portal
  └─ node server.mjs                 Kit 的常驻 MCP server
       └─ node worker.mjs <job_id>   本次后台任务
            └─ codex exec ...        本次 Codex CLI 执行
```

任务执行期间，`worker.mjs` 与 `codex exec` 存活；任务完成、失败或取消后，两者退出。因此无任务时，任务管理器中找不到 `codex.exe` 是预期行为，不代表历史任务或可恢复会话丢失。

- `run` 与 `resume` 都会新建一个 `codex exec` 子进程；MCP wrapper 本身由 Portal 常驻。
- `run` 返回这次执行的 `job_id`。任务启动后，调用 `status(job_id)` 可取得 Codex 原生 `session_id`。
- `resume(session_id, prompt, cwd)` 会新建一条异步执行，并让新进程恢复指定的 Codex 历史会话。`session_id` 是唯一的会话标识，不绑定“项目”或旧 `job_id`。
- `job_id` 只标识一次异步运行，用于 `status`、`cancel`、日志和排障。

## 接口契约

`manifest.json` 是机器可读的完整接口定义；Portal/MCP 客户端可通过 `tools/list` 发现它。README 说明调用语义与 ID 生命周期。

| 接口 | 必填参数 | 立即返回 | 用途 |
|---|---|---|---|
| `run` | `prompt`, `cwd` | `job_id` | 新建一次后台 Codex 执行。可选：`profile` 或 `model`（二选一）、`sandbox`。 |
| `status` | `job_id` | 该次运行的状态、事件摘要、最终结果、`session_id` | 轮询一次运行的进度，或在完成后取得可复用的 Codex 会话 ID。 |
| `resume` | `session_id`, `prompt`, `cwd` | 新 `job_id` | 新建一次后台执行，并恢复指定的 Codex 会话。可选：`profile` 或 `model`（二选一）、`sandbox`。 |
| `list` | 无 | 最近 job 列表 | 可选 `limit` 控制数量。 |
| `cancel` | `job_id` | 取消后的 job 状态 | 终止仍在运行中的这一次执行。 |

## 执行配置

### Codex Profile（可选）

Kit 可以把 Codex 原生 profile 传给每次后台执行。profile 是调用者本机的 Codex 配置预设，用于固定模型、推理强度或其他适合团队工作流的 Codex 设置；它不启动常驻 Agent，也不会修改全局默认配置。

使用前，请由各使用者自行完成以下检查：

1. 在本机 Codex 配置目录中创建并验证所需的 profile。profile 的文件位置、支持字段和认证要求应以本机 `codex` 版本及官方文档为准。
2. 先在终端使用同一个 profile 成功执行一次简单的 `codex exec`，确认该 profile 可用且当前账号有权使用其中指定的模型。
3. 调用 Kit 时传入 profile 名称，例如 `profile="review"`。Kit 会将其传为 `codex exec -p review`。
4. 为每个任务在 prompt 中明确工作范围、禁止事项和验收标准；profile 只提供执行配置，不替代任务边界。

`profile` 与 `model` 只能二选一。`profile` 适合复用已经验证的本机配置；`model` 适合没有 profile 的临时调用或需要明确覆盖模型的实验。两者同时传入会被拒绝，避免任务记录与实际执行配置不一致。

profile 名称、模型选择、角色划分和 sandbox 策略由各团队自行决定。对于会修改代码的任务，建议先在 prompt 中限定允许写入的文件范围，并把“代码已实现”“本地测试通过”和“真实环境验证”作为独立结论记录。

### 两个 ID

- `session_id`：Codex 原生会话标识。它代表对话/工作上下文；调用者可自行保存、传递，并直接用于 `resume(session_id, ...)`。Kit 不引入 `project_id`，也不要求通过旧 `job_id` 才能续接。
- `job_id`：Kit 为一次后台进程生成的运行句柄。它不代表会话，只用于查询 `status(job_id)`、调用 `cancel(job_id)` 和查找本次运行的日志。一次 `resume` 会产生新的 `job_id`，但继续同一个 `session_id`。

### 最短调用流程

```text
1. run(prompt, cwd) -> job_id
2. status(job_id) -> running | completed | failed | cancelled，以及 session_id
3. resume(session_id, follow_up_prompt, cwd) -> 新 job_id
4. status(新 job_id)
```

`run` 的 `session_id` 初始为空；Codex 开始输出会话事件后，Kit 将其持久化到该 job 的状态中。应在 `status(job_id)` 返回 `session_id` 后再调用 `resume`。

## 长任务

`run` 只负责：创建 job 状态文件、启动子进程、返回 `job_id`。它不等待 Codex 完成，因此调用本身不会因几十分钟的任务而占用 MCP 请求。

长任务的观察由调用方决定：调用 `status(job_id)` 读取状态。推荐轮询间隔：

- 前 2 分钟：每 20–30 秒。
- 之后：每 60 秒。
- 有明确长操作（测试、构建、批处理）时：每 2–5 分钟。

Kit 不在内部定时向 Portal 推送结果，也不自行“卡住等待”。因为 MCP stdio 通道不能可靠保证调用方持续连接；任务状态和日志落盘后，即使调用方断开，也可在恢复后继续读取。

## Grove usage reporting

Usage reporting is optional and uses the installer's own Grove credentials. The public package does not contain a token. On Portal installs, configure `GROVE_TOKEN` in the kit-local `grove.env` file; the server reads that file first and falls back to the process environment. `GROVE_KIT_ID` and `GROVE_API_BASE` are optional overrides.

Each installer must create or obtain their own Grove Bearer token. Do not copy the publisher's token into another installation.

The server reports one incremental usage call to Grove after each successful tool call. Heartbeat failures are logged locally and do not fail the Codex operation.


- `jobs/<job_id>.json`：任务当前摘要，包括 Codex 原生 `session_id`、状态、PID、最终答复、退出码与最后 100 条 stdout 事件。先用 `status(job_id)` 取得 `session_id`，后续可独立调用 `resume(session_id, prompt, cwd)`。
- `jobs/<job_id>.events.jsonl`：该任务完整事件流。每行一个 JSON，包含 Codex stdout JSON 事件、stderr 块和生命周期事件。
- `logs/runtime-YYYY-MM-DD.jsonl`：Kit 级运行日志，记录 job 创建、启动、取消、进程启动失败和结束状态。

JSONL 是一行一条记录，适合按时间流式检索。Windows 示例：

```powershell
Get-Content "$env:USERPROFILE\.heart-portal\kits\codex-async\logs\runtime-2026-08-23.jsonl"
Get-Content "$env:USERPROFILE\.heart-portal\kits\codex-async\jobs\<job_id>.events.jsonl" -Tail 100
```

日志保留策略当前未自动清理；确认稳定后应增加按天数或总容量清理，避免长期运行占满磁盘。

## 现阶段限制

- `running` 是 wrapper 内存中的 PID 映射。若 wrapper 本身重启，旧 job 的状态文件仍可读取，但 `cancel` 无法再控制该旧进程。
- 若要做到 wrapper 重启后仍可取消、判定旧进程是否活着，需要在 `status` 中检查 PID，并在启动时恢复存活 job；这是下一层可靠性增强，不是本次异步机制的必需部分。
- MCP 标准的 Tasks 扩展同样采用“立即返回句柄、后续查询”的模型；当前 Portal 还未暴露该扩展，所以 Kit 用兼容所有 MCP client 的 `run/status` 工具对实现相同语义。
