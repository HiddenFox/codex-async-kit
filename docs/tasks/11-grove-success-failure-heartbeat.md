# TASK 11 — codex-async：Grove heartbeat 上报 successful / failed

## 0. 正确归属与当前基线
本任务只在 `D:\Workspace\code\codex-async-kit` 开发和测试。不要改 `async-task-kit`；不要改已存在的未跟踪文件 `docs/tasks/10-portal-lifecycle-false-completion.md`。

线上 Town 的权威接口为 `GET https://beings.town/api/grove/help`：

- `POST /api/grove/{name_or_id}/heartbeat`
- body：`calls` 必填、为本次增量；`successful` / `failed` 可选，代表 Kit 质门的成功/失败次数；`last_used_at` 可选。
- 推荐成功请求：`{calls: 5, successful: 5, failed: 0}`；失败混合例：`{calls:5, successful:4, failed:1}`。

现有 `server.mjs` 的 `reportUsage()` 在每个成功的 MCP `tools/call` 后发送 `{calls:1}`，从不报告 `successful`/`failed`，且 tool 异常路径完全不计数。这是此次改造对象。

## 1. 目标/语义
令每一次**已进入 `tools/call` 分发并得到终态**的请求尝试，最多产生一次 best-effort Grove heartbeat：

| MCP tools/call 终态 | heartbeat body |
|---|---|
| handler 返回正常结果 | `{ calls: 1, successful: 1, failed: 0, last_used_at }` |
| handler 抛错、包括未知 tool、参数/作业错误 | `{ calls: 1, successful: 0, failed: 1, last_used_at }` |
| JSON 解析失败、initialize、tools/list | 不上报 |

这测量的是 **codex-async 对外工具调用是否成功**，不是后台 Codex job 最终 state。`run` 成功创建 job 后即为一次成功调用；job 后续 completed/failed/cancelled 不得再额外上报，否则一个请求会双计数。

## 2. 实现要求
1. 将 `reportUsage` 改为显式接收结果计数/结果类型，只允许非负整数，调用时保证 `calls === successful + failed === 1`。
2. 成功和失败 MCP 路径均调用一次；无 Grove token 时静默跳过，保持现有可选配置语义。
3. heartbeat 本身依然 best-effort：不得改变已经形成的 MCP 业务结果或 JSON-RPC error；heartbeat 非 2xx / 网络错误只写 runtime log，不得造成重复上报。
4. 保留 Bearer header、`GROVE_KIT_ID` / `GROVE_API_BASE` 覆盖与 `last_used_at`。
5. 不新增依赖，不碰 callback/worker 的完成回调语义，不发真实生产 heartbeat，不安装、打包、发布、commit、push 或重启 Portal。
6. 如发现任务书和源码存在冲突，以 `GET /api/grove/help` 的正式字段为准，在报告说明。

## 3. 测试要求
扩展或新建现有 Node 测试，必须 mock fetch / 使用本地 HTTP test server，且至少覆盖：

- 成功 `tools/call` 发送唯一一次请求，body 有 `calls:1, successful:1, failed:0`；
- handler error / unknown tool 发送唯一一次请求，body 有 `calls:1, successful:0, failed:1`，且 JSON-RPC 仍是原本 error；
- 无 token 不发请求；
- heartbeat HTTP 非 2xx 不改变成功或失败 MCP 响应；
- `initialize` 与 `tools/list` 不发请求；
- 断言所有 body 满足 `calls === successful + failed`。

运行完整 `npm test`、相关 Node syntax/import 检查、`git diff --check`，将真实输出摘要写入实现报告。

## 4. 允许改动与交付
允许改：实现、相应测试、README/CHANGELOG（如确有面向使用者的行为变更）。

写报告：`docs/tasks/11-grove-success-failure-heartbeat-implementation-report.md`，列变更、语义、测试命令和结果、未做的生产验证及原因、明确边界确认。

不要自行部署到 `C:\Users\feng.han\.heart-portal\kits\codex-async`；独立 Tester 会在开发完成后再派。

## 5. 验收
- 所有要求测试通过；
- 正常与异常 tools/call 都可产生正确三计数；
- 不双计数 job 终态；
- Grove 不可用不伤害工具调用；
- 只触及 codex-async-kit，且无安装/发布/commit/push。
