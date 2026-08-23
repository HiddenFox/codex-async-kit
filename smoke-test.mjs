import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "inherit"]
});
let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});
let id = 0;
function call(method, params = {}) {
  const requestId = ++id;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
  return new Promise((resolve) => pending.set(requestId, resolve));
}

console.log(JSON.stringify(await call("initialize", { protocolVersion: "2024-11-05" })));
console.log(JSON.stringify(await call("tools/list")));
const started = await call("tools/call", {
  name: "run",
  arguments: {
    cwd: "D:\\Workspace\\code\\Beings-Town",
    sandbox: "read-only",
    prompt: "Reply with exactly: CODEX_ASYNC_OK. Do not run commands."
  }
});
console.log(JSON.stringify(started));
const jobId = JSON.parse(started.result.content[0].text).job_id;
let initialJob = null;
for (let i = 0; i < 24; i++) {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const status = await call("tools/call", { name: "status", arguments: { job_id: jobId } });
  const job = JSON.parse(status.result.content[0].text);
  console.log(JSON.stringify(job));
  initialJob = job;
  if (["completed", "failed", "cancelled"].includes(job.state)) break;
}
if (!initialJob.session_id) throw new Error("smoke job did not produce a Codex session_id");
const resumed = await call("tools/call", {
  name: "resume",
  arguments: {
    job_id: jobId,
    prompt: "Reply with exactly: CODEX_RESUME_OK. Do not run commands."
  }
});
console.log(JSON.stringify(resumed));
const resumedJobId = JSON.parse(resumed.result.content[0].text).job_id;
for (let i = 0; i < 24; i++) {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const status = await call("tools/call", { name: "status", arguments: { job_id: resumedJobId } });
  const job = JSON.parse(status.result.content[0].text);
  console.log(JSON.stringify(job));
  if (["completed", "failed", "cancelled"].includes(job.state)) {
    if (job.parent_job_id !== jobId) throw new Error("resumed job did not retain parent_job_id");
    break;
  }
}
child.kill();
