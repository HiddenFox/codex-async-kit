#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";

const KIT_HOME = join(homedir(), ".heart-portal", "kits", "codex-async");
const JOB_DIR = join(KIT_HOME, "jobs");
const LOG_DIR = join(KIT_HOME, "logs");
const DEFAULT_SANDBOX = "workspace-write";
const jobId = process.argv[2];
if (!jobId || !/^[a-z0-9-]+$/i.test(jobId)) throw new Error("worker needs a valid job id");
const jobPath = join(JOB_DIR, `${jobId}.json`);
const eventsPath = join(JOB_DIR, `${jobId}.events.jsonl`);
const runtimePath = join(LOG_DIR, `runtime-${new Date().toISOString().slice(0, 10)}.jsonl`);

async function atomicWrite(job) {
  await mkdir(JOB_DIR, { recursive: true });
  const tmp = `${jobPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await rename(tmp, jobPath);
}
async function event(event, fields = {}) {
  await mkdir(LOG_DIR, { recursive: true });
  const entry = { at: new Date().toISOString(), event, ...fields };
  await Promise.all([
    appendFile(eventsPath, `${JSON.stringify(entry)}\n`, "utf8"),
    appendFile(runtimePath, `${JSON.stringify({ ...entry, job_id: jobId })}\n`, "utf8")
  ]);
}
function codexCommand() {
  if (process.platform !== "win32") return "codex";
  return join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
}
function args(job) {
  const profile = job.profile ? ["-p", job.profile] : [];
  const sandbox = job.sandbox || DEFAULT_SANDBOX;
  const sandboxConfig = ["-c", `sandbox_mode="${sandbox}"`];
  if (job.resumed_from) return ["exec", ...profile, ...sandboxConfig, "resume", "--json", "-c", "approval_policy=never", ...(job.model ? ["--model", job.model] : []), job.resumed_from, job.prompt];
  return ["exec", ...profile, "--json", "--cd", job.cwd, "--sandbox", sandbox, "-c", "approval_policy=never", ...(job.model ? ["--model", job.model] : []), job.prompt];
}
function update(job, item) {
  if (item.type === "thread.started" && item.thread_id) job.session_id = item.thread_id;
  if (item.type === "item.completed" && item.item?.type === "agent_message") job.last_message = item.item.text;
  if (item.type === "turn.completed" && item.usage) job.usage = item.usage;
}
const job = JSON.parse(await readFile(jobPath, "utf8"));
if (job.state !== "queued") process.exit(0);
const child = spawn(codexCommand(), args(job), { cwd: resolve(job.cwd), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
job.pid = child.pid;
job.state = "running";
job.started_at = new Date().toISOString();
job.updated_at = job.started_at;
await atomicWrite(job);
await event("job.started", { pid: job.pid });
let stderr = "";
const lines = readline.createInterface({ input: child.stdout });
for await (const line of lines) {
  let item;
  try { item = JSON.parse(line); } catch { item = { type: "raw.stdout", text: line }; }
  update(job, item);
  job.events = [...(job.events || []), item].slice(-100);
  job.updated_at = new Date().toISOString();
  await atomicWrite(job);
  await event("codex.event", { payload: item });
}
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const [code, signal] = await new Promise((resolve) => child.on("close", (c, s) => resolve([c, s])));
job.state = code === 0 ? "completed" : "failed";
job.exit_code = code;
job.signal = signal || null;
job.stderr = stderr.trim().slice(-12000) || null;
job.finished_at = new Date().toISOString();
job.updated_at = job.finished_at;
await atomicWrite(job);
await event("job.finished", { state: job.state, exit_code: code, signal: job.signal, session_id: job.session_id });
