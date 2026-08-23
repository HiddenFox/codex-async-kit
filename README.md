# 运行与排查说明

## 进程模型

- Portal 启动并保持 `node server.mjs`，它是常驻的 MCP wrapper。
- `run` 与 `resume` 都会新建一个 `codex exec` 子进程；MCP wrapper 本身由 Portal 常驻。
- `run` 返回这次执行的 `job_id`。任务启动后，调用 `status(job_id)` 可取得 Codex 原生 `session_id`。
- `resume(session_id, prompt, cwd)` 会新建一条异步执行，并让新进程恢复指定的 Codex 历史会话。`session_id` 是唯一的会话标识，不绑定“项目”或旧 `job_id`。
- `job_id` 只标识一次异步运行，用于 `status`、`cancel`、日志和排障。

## 接口契约

`manifest.json` 是机器可读的完整接口定义；Portal/MCP 客户端可通过 `tools/list` 发现它。README 说明调用语义与 ID 生命周期。

| 接口 | 必填参数 | 立即返回 | 用途 |
|---|---|---|---|
| `run` | `prompt`, `cwd` | `job_id` | 新建一次后台 Codex 执行。可选：`model`、`sandbox`。 |
| `status` | `job_id` | 该次运行的状态、事件摘要、最终结果、`session_id` | 轮询一次运行的进度，或在完成后取得可复用的 Codex 会话 ID。 |
| `resume` | `session_id`, `prompt`, `cwd` | 新 `job_id` | 新建一次后台执行，并恢复指定的 Codex 会话。可选：`model`、`sandbox`。 |
| `list` | 无 | 最近 job 列表 | 可选 `limit` 控制数量。 |
| `cancel` | `job_id` | 取消后的 job 状态 | 终止仍在运行中的这一次执行。 |

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

## 日志位置

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
