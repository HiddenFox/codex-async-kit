# TEST TASK 11 — codex-async Grove heartbeat successful / failed：独立验收

## 范围与安全
在 `D:\Workspace\code\codex-async-kit` 独立验收已完成的 Task 11。绝不修改业务实现、现有测试、依赖、安装配置或全局 Portal 配置；不发送生产请求、不部署/安装/打包/发布/commit/push/重启。

允许仅新建：`docs/tasks/11-grove-success-failure-heartbeat-test-report.md`。

严禁进入或修改 `async-task-kit`，也不要读/改既有未跟踪文件 `docs/tasks/10-portal-lifecycle-false-completion.md`。

## 权威契约
线上 Town 的权威资料为 `GET https://beings.town/api/grove/help`：
`POST /api/grove/{name_or_id}/heartbeat` body 中 `calls` 必填增量，`successful` 和 `failed` 是可选的 Kit 质门计数。该文档要验证的语义是每一次已经进入 MCP `tools/call` 分发、并有 handler 成功或失败终态的调用，最多一次 heartbeat：成功 `{1,1,0}`，失败 `{1,0,1}`。它计 MCP 调用，不能按异步 Codex job completed/failed/cancelled 再计一次。

## 验收工作
1. 阅读 Task 11、implementation report、`server.mjs`、相关测试和 git diff。不要信任 Developer 声称。
2. 静态核验：
   - 成功、未知 tool、handler 抛错（含无效参数）路径是否都正确计数；
   - heartbeat 自身的 HTTP 非2xx、网络错误、日志写错是否不篡改既定 MCP result/error；
   - initialize/tools/list/无效 JSON 不计数；
   - worker/job 终态没有另一条 heartbeat 上报；
   - 无 token 无请求；
   - 单次调用无重复上报。
3. 只运行现有测试与只读验证。至少执行：`npm test`、`node --check server.mjs`、`node --check test/server.integration.test.mjs`、`git diff --check`。
4. 可写一个临时文件到 OS temp 目录运行额外黑箱 test，但必须删除；禁止改仓库源码或测试。任何 fetch 必须 mock 或指向本地/无网络，禁止真实 Town heartbeat。
5. 核对 git status：业务改动应仅为 `server.mjs` 和 `test/server.integration.test.mjs`；任务 11 文档为预期未跟踪文件；Task 10 不得被本任务动到。

## 输出
写 `docs/tasks/11-grove-success-failure-heartbeat-test-report.md`，开头必须为 `PASS` 或 `FAIL`。包含：逐条验收结论和一手证据（具体文件/行或命令输出）、实际命令及结果、发现的缺陷/风险、生产验证是否执行（应为否）和修改边界核验。

若发现任何 P0/P1 语义或测试缺口，写 `FAIL`，不要修代码，并在最终答复清楚说明阻断项。
