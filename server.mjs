#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const KIT_HOME = join(homedir(), ".heart-portal", "kits", "codex-async");
const JOB_DIR = join(KIT_HOME, "jobs");
const LOG_DIR = join(KIT_HOME, "logs");
const DEFAULT_SANDBOX = "workspace-write";

async function ensureStorage() { await Promise.all([mkdir(JOB_DIR, { recursive: true }), mkdir(LOG_DIR, { recursive: true })]); }
function jobPath(jobId) { if (!/^[a-z0-9-]+$/i.test(jobId)) throw new Error("invalid job_id"); return join(JOB_DIR, `${jobId}.json`); }
function eventsPath(jobId) { return join(JOB_DIR, `${jobId}.events.jsonl`); }
async function writeJob(job) {
  await ensureStorage();
  const path = jobPath(job.job_id);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
async function loadJob(jobId) {
  try { return JSON.parse(await readFile(jobPath(jobId), "utf8")); }
  catch (error) { if (error.code === "ENOENT") throw new Error(`job not found: ${jobId}`); throw error; }
}
async function logEvent(jobId, event, fields = {}) {
  await ensureStorage();
  const entry = { at: new Date().toISOString(), event, ...fields };
  await appendFile(eventsPath(jobId), `${JSON.stringify(entry)}\n`, "utf8");
  await appendFile(join(LOG_DIR, `runtime-${entry.at.slice(0, 10)}.jsonl`), `${JSON.stringify({ ...entry, job_id: jobId })}\n`, "utf8");
}
function compactJob(job) {
  const { pid, events = [], ...safe } = job;
  return { ...safe, recent_events: events.slice(-8), event_count: events.length };
}
function validateCwd(cwd) {
  if (!cwd || typeof cwd !== "string") throw new Error("cwd is required");
  return resolve(cwd);
}
function workerPath() { return join(KIT_HOME, "worker.mjs"); }

async function startJob({ prompt, cwd, model, sandbox, sessionId = null, parentJobId = null }) {
  if (!prompt || typeof prompt !== "string") throw new Error("prompt is required");
  const job = {
    job_id: `codex-${randomUUID()}`, state: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    cwd: validateCwd(cwd), model: model || null, sandbox: sandbox || DEFAULT_SANDBOX, prompt,
    parent_job_id: parentJobId, resumed_from: sessionId, session_id: sessionId, last_message: null,
    error: null, exit_code: null, usage: null, events: []
  };
  await writeJob(job);
  await logEvent(job.job_id, "job.queued", { resumed_from: sessionId, parent_job_id: parentJobId });
  const worker = spawn(process.execPath, [workerPath(), job.job_id], { cwd: KIT_HOME, detached: true, windowsHide: true, stdio: "ignore" });
  worker.unref();
  job.worker_pid = worker.pid;
  job.updated_at = new Date().toISOString();
  await writeJob(job);
  await logEvent(job.job_id, "worker.spawned", { worker_pid: worker.pid });
  return compactJob(job);
}
async function resumeJob({ sessionId, prompt, cwd, model, sandbox }) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("resume requires a Codex session_id");
  return startJob({ prompt, cwd, model, sandbox, sessionId });
}
async function listJobs(limit = 20) {
  await ensureStorage();
  const files = (await readdir(JOB_DIR)).filter((name) => name.endsWith(".json"));
  const jobs = await Promise.all(files.map(async (name) => { try { return JSON.parse(await readFile(join(JOB_DIR, name), "utf8")); } catch { return null; } }));
  return jobs.filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.max(1, Math.min(Number(limit) || 20, 100))).map(compactJob);
}
async function cancelJob(jobId) {
  const job = await loadJob(jobId);
  if (!["running", "queued"].includes(job.state)) throw new Error(`job is not active: ${jobId}`);
  if (process.platform === "win32" && job.pid) await new Promise((resolve, reject) => execFile("taskkill.exe", ["/PID", String(job.pid), "/T", "/F"], (error) => error ? reject(error) : resolve()));
  else if (job.pid) process.kill(job.pid, "SIGTERM");
  job.state = "cancelled"; job.finished_at = new Date().toISOString(); job.updated_at = job.finished_at;
  await writeJob(job); await logEvent(jobId, "job.cancelled", { pid: job.pid || null });
  return compactJob(job);
}
const tools = [
  { name: "run", description: "Start a persistent Codex job in the background. Returns job_id immediately; use status to poll.", inputSchema: { type: "object", properties: { prompt: { type: "string" }, cwd: { type: "string" }, model: { type: "string" }, sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"] } }, required: ["prompt", "cwd"] } },
  { name: "resume", description: "Start a new background job that continues a Codex session. Returns job_id immediately; use status to poll.", inputSchema: { type: "object", properties: { session_id: { type: "string", description: "Codex session_id returned in a prior job status" }, prompt: { type: "string" }, cwd: { type: "string" }, model: { type: "string" }, sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"] } }, required: ["session_id", "prompt", "cwd"] } },
  { name: "status", description: "Read current status for a Codex job.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "list", description: "List recent Codex jobs.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "cancel", description: "Stop an active Codex job.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } }
];
function response(id, result) { return JSON.stringify({ jsonrpc: "2.0", id, result }); }
function errorResponse(id, error) { return JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: error.message || String(error) } }); }
let buffered = "";
process.stdin.on("data", async (chunk) => {
  buffered += chunk.toString(); const lines = buffered.split("\n"); buffered = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let request; try { request = JSON.parse(line); } catch { continue; }
    try {
      if (request.method === "initialize") process.stdout.write(`${response(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codex-async", version: "0.2.0" } })}\n`);
      else if (request.method === "tools/list") process.stdout.write(`${response(request.id, { tools })}\n`);
      else if (request.method === "tools/call") {
        const { name, arguments: args = {} } = request.params;
        let result;
        if (name === "run") result = await startJob(args);
        else if (name === "resume") result = await resumeJob({ sessionId: args.session_id, prompt: args.prompt, cwd: args.cwd, model: args.model, sandbox: args.sandbox });
        else if (name === "status") result = compactJob(await loadJob(args.job_id));
        else if (name === "list") result = await listJobs(args.limit);
        else if (name === "cancel") result = await cancelJob(args.job_id);
        else throw new Error(`unknown tool: ${name}`);
        process.stdout.write(`${response(request.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] })}\n`);
      }
    } catch (error) { process.stdout.write(`${errorResponse(request.id, error)}\n`); }
  }
});
