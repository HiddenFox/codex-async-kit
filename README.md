# 运行与排查说明

## 进程模型

- Portal 启动并保持 `node server.mjs`，它是常驻的 MCP wrapper。
- `run` 与 `resume` 都会新建一个 `codex exec` 子进程；MCP wrapper 本身由 Portal 常驻。
- `run` 返回这次执行的 `job_id`。任务启动后，调用 `status(job_id)` 可取得 Codex 原生 `session_id`。
- `resume(session_id, prompt, cwd)` 会新建一条异步执行，并让新进程恢复指定的 Codex 历史会话。`session_id` 是唯一的会话标识，不绑定“项目”或旧 `job_id`。
- `job_id` 只标识一次异步运行，用于 `status`、`cancel`、日志和排障。

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
