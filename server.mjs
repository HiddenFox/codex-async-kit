#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_HOME = process.env.CODEX_ASYNC_KIT_HOME || join(homedir(), ".heart-portal", "kits", "codex-async");
const JOB_DIR = join(KIT_HOME, "jobs");
const LOG_DIR = join(KIT_HOME, "logs");
const DEFAULT_SANDBOX = "workspace-write";
const GROVE_KIT_ID = process.env.GROVE_KIT_ID || "OteJGwtOzLqL7jmyZ2PfM";
const GROVE_API_BASE = process.env.GROVE_API_BASE || "https://beings.town";

async function readLocalEnvValue(name) {
  try {
    const content = await readFile(join(KIT_HOME, "grove.env"), "utf8");
    const line = content.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : "";
  } catch {
    return "";
  }
}

const GROVE_TOKEN = await readLocalEnvValue("GROVE_TOKEN") || process.env.GROVE_TOKEN || process.env.BEINGS_TOWN_GROVE_TOKEN;

async function reportUsage() {
  if (!GROVE_TOKEN) return;
  try {
    const response = await fetch(`${GROVE_API_BASE}/api/grove/${GROVE_KIT_ID}/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GROVE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ calls: 1, last_used_at: new Date().toISOString() })
    });
    if (!response.ok) throw new Error(`heartbeat HTTP ${response.status}`);
  } catch (error) {
    await ensureStorage();
    const entry = { at: new Date().toISOString(), event: "grove.heartbeat_failed", error: error.message || String(error) };
    await appendFile(join(LOG_DIR, `runtime-${entry.at.slice(0, 10)}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8").catch(() => {});
  }
}

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
function workerPath() { return join(dirname(fileURLToPath(import.meta.url)), "worker.mjs"); }

function initialNotification(requested, state) {
  return { requested, state, attempts: 0, last_attempt_at: null, delivered_at: null, http_status: null, last_error: null };
}

export async function startJob({ prompt, cwd, model, profile, sandbox, notify = true, sessionId = null, parentJobId = null }, options = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("prompt is required");
  if (typeof notify !== "boolean") throw new Error("notify must be a boolean");
  if (model && profile) throw new Error("model and profile are mutually exclusive");
  if (profile && (!/^[a-z0-9_-]+$/i.test(profile))) throw new Error("profile must contain only letters, numbers, underscores, or hyphens");
  const job = {
    job_id: `codex-${randomUUID()}`, state: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    cwd: validateCwd(cwd), model: model || null, profile: profile || null, sandbox: sandbox || DEFAULT_SANDBOX, prompt, notify,
    parent_job_id: parentJobId, resumed_from: sessionId, session_id: sessionId, last_message: null,
    error: null, exit_code: null, usage: null, events: []
  };
  await writeJob(job);
  await logEvent(job.job_id, "job.queued", { resumed_from: sessionId, parent_job_id: parentJobId });
  const spawnImpl = options.spawnImpl || spawn;
  const worker = spawnImpl(process.execPath, [workerPath(), job.job_id], { cwd: KIT_HOME, detached: true, windowsHide: true, stdio: "ignore" });
  worker.unref();
  job.worker_pid = worker.pid;
  job.updated_at = new Date().toISOString();
  await writeJob(job);
  await logEvent(job.job_id, "worker.spawned", { worker_pid: worker.pid });
  return compactJob(job);
}
export async function resumeJob({ sessionId, prompt, cwd, model, profile, sandbox, notify = true }, options = {}) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("resume requires a Codex session_id");
  return startJob({ prompt, cwd, model, profile, sandbox, notify, sessionId }, options);
}
export async function listJobs(limit = 20) {
  await ensureStorage();
  const files = (await readdir(JOB_DIR)).filter((name) => name.endsWith(".json"));
  const jobs = await Promise.all(files.map(async (name) => { try { return JSON.parse(await readFile(join(JOB_DIR, name), "utf8")); } catch { return null; } }));
  return jobs.filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Math.max(1, Math.min(Number(limit) || 20, 100))).map(compactJob);
}
export async function cancelJob(jobId) {
  const job = await loadJob(jobId);
  if (!["running", "queued"].includes(job.state)) throw new Error(`job is not active: ${jobId}`);
  await ensureStorage();
  try {
    await writeFile(join(JOB_DIR, `${jobId}.outcome`), "cancelled\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`job is no longer cancellable: ${jobId}`);
    throw error;
  }
  job.state = "cancelled"; job.finished_at = new Date().toISOString(); job.updated_at = job.finished_at;
  job.notification = initialNotification(job.notify !== false, "suppressed");
  await writeJob(job);
  await logEvent(jobId, "job.cancelled", { pid: job.pid || null });
  await logEvent(jobId, "notification.suppressed", { reason: "explicit_cancellation" });
  try {
    if (process.platform === "win32" && job.pid) await new Promise((resolveKill, reject) => execFile("taskkill.exe", ["/PID", String(job.pid), "/T", "/F"], (error) => error ? reject(error) : resolveKill()));
    else if (job.pid) process.kill(job.pid, "SIGTERM");
  } catch (error) {
    await logEvent(jobId, "job.cancel_signal_failed", { error: error.code || "unknown_error" });
  }
  return compactJob(job);
}
export const tools = [
  { name: "run", description: "Start a persistent Codex job in the background. Returns job_id immediately; use status for the authoritative result.", inputSchema: { type: "object", properties: { prompt: { type: "string" }, cwd: { type: "string" }, model: { type: "string", description: "Optional Codex model; mutually exclusive with profile" }, profile: { type: "string", description: "Optional Codex profile; mutually exclusive with model" }, sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"] }, notify: { type: "boolean", default: true, description: "Send a completion notification when configured" } }, required: ["prompt", "cwd"] } },
  { name: "resume", description: "Start a new background job that continues a Codex session. Returns job_id immediately; use status for the authoritative result.", inputSchema: { type: "object", properties: { session_id: { type: "string", description: "Codex session_id returned in a prior job status" }, prompt: { type: "string" }, cwd: { type: "string" }, model: { type: "string", description: "Optional Codex model; mutually exclusive with profile" }, profile: { type: "string", description: "Optional Codex profile; mutually exclusive with model" }, sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"] }, notify: { type: "boolean", default: true, description: "Send a completion notification when configured" } }, required: ["session_id", "prompt", "cwd"] } },
  { name: "status", description: "Read current status for a Codex job.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "list", description: "List recent Codex jobs.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "cancel", description: "Stop an active Codex job.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } }
];
function response(id, result) { return JSON.stringify({ jsonrpc: "2.0", id, result }); }
function errorResponse(id, error) { return JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: error.message || String(error) } }); }
let buffered = "";
export function startServer(input = process.stdin, output = process.stdout) {
  input.on("data", async (chunk) => {
    buffered += chunk.toString(); const lines = buffered.split("\n"); buffered = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let request; try { request = JSON.parse(line); } catch { continue; }
      try {
        if (request.method === "initialize") output.write(`${response(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "codex-async", version: "1.1.1" } })}\n`);
        else if (request.method === "tools/list") output.write(`${response(request.id, { tools })}\n`);
        else if (request.method === "tools/call") {
          const { name, arguments: args = {} } = request.params;
          let result;
          if (name === "run") result = await startJob(args);
          else if (name === "resume") result = await resumeJob({ sessionId: args.session_id, prompt: args.prompt, cwd: args.cwd, model: args.model, profile: args.profile, sandbox: args.sandbox, notify: args.notify });
          else if (name === "status") result = compactJob(await loadJob(args.job_id));
          else if (name === "list") result = await listJobs(args.limit);
          else if (name === "cancel") result = await cancelJob(args.job_id);
          else throw new Error(`unknown tool: ${name}`);
          await reportUsage();
          output.write(`${response(request.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] })}\n`);
        }
      } catch (error) {
        output.write(`${errorResponse(request.id, error)}\n`);
      }
    }
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) startServer();
