#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { CallbackConfigError, deliverCallback, loadCallbackConfig } from "./callback.mjs";

const DEFAULT_SANDBOX = "workspace-write";

function defaultKitHome() {
  return process.env.CODEX_ASYNC_KIT_HOME || join(homedir(), ".heart-portal", "kits", "codex-async");
}

function codexExecutable() {
  if (process.platform !== "win32") return "codex";
  return join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
}

export function codexArgs(job) {
  const profile = job.profile ? ["-p", job.profile] : [];
  const sandbox = job.sandbox || DEFAULT_SANDBOX;
  const sandboxConfig = ["-c", `sandbox_mode="${sandbox}"`];
  const skipGitCheck = job.skip_git_check ? ["--skip-git-repo-check"] : [];
  if (job.resumed_from) {
    // Fix (1.1.8): -c before the `resume` subcommand token is parsed by the parent
    // `exec` and silently dropped for resumed sessions, which then run under the
    // default workspace-write sandbox. sandbox_mode must be passed as an option of
    // the `resume` subcommand itself. (Bug report: Ripple, 2026-09-29.)
    return ["exec", ...profile, "resume", "--json", ...skipGitCheck, ...sandboxConfig, "-c", "approval_policy=never", ...(job.model ? ["--model", job.model] : []), job.resumed_from, job.prompt];
  }
  return ["exec", ...profile, "--json", ...skipGitCheck, "--cd", job.cwd, "--sandbox", sandbox, "-c", "approval_policy=never", ...(job.model ? ["--model", job.model] : []), job.prompt];
}

function updateFromCodexEvent(job, item) {
  if (item.type === "thread.started" && item.thread_id) job.session_id = item.thread_id;
  if (item.type === "item.completed" && item.item?.type === "agent_message") job.last_message = item.item.text;
  if (item.type === "turn.completed" && item.usage) job.usage = item.usage;
}

function initialNotification(requested, state = "pending", lastError = null) {
  return {
    requested,
    state,
    attempts: 0,
    last_attempt_at: null,
    delivered_at: null,
    http_status: null,
    last_error: lastError
  };
}

async function readOutcome(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function runWorker(jobId, options = {}) {
  if (!jobId || !/^[a-z0-9-]+$/i.test(jobId)) throw new Error("Worker needs a valid job ID");
  const kitHome = options.kitHome || defaultKitHome();
  const jobDir = join(kitHome, "jobs");
  const logDir = join(kitHome, "logs");
  const jobPath = join(jobDir, `${jobId}.json`);
  const eventsPath = join(jobDir, `${jobId}.events.jsonl`);
  const outcomePath = join(jobDir, `${jobId}.outcome`);

  async function atomicWrite(job) {
    await mkdir(jobDir, { recursive: true });
    const temporaryPath = `${jobPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await rename(temporaryPath, jobPath);
  }

  async function event(name, fields = {}) {
    await mkdir(logDir, { recursive: true });
    const entry = { at: new Date().toISOString(), event: name, ...fields };
    const runtimePath = join(logDir, `runtime-${entry.at.slice(0, 10)}.jsonl`);
    await Promise.all([
      appendFile(eventsPath, `${JSON.stringify(entry)}\n`, "utf8"),
      appendFile(runtimePath, `${JSON.stringify({ ...entry, job_id: jobId })}\n`, "utf8")
    ]);
  }

  const job = JSON.parse(await readFile(jobPath, "utf8"));
  if (job.state !== "queued" || await readOutcome(outcomePath) === "cancelled") return;
  const executable = options.codexExecutable || codexExecutable();
  const prefixArgs = options.codexArgsPrefix || [];
  const spawnImpl = options.spawnImpl || spawn;
  const child = spawnImpl(executable, [...prefixArgs, ...codexArgs(job)], {
    cwd: resolve(job.cwd),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  let spawnError = null;
  child.on("error", (error) => { spawnError = error; });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const closePromise = new Promise((resolveClose) => child.on("close", (exitCode, exitSignal) => resolveClose([exitCode, exitSignal])));
  job.pid = child.pid;
  job.state = "running";
  job.started_at = new Date().toISOString();
  job.updated_at = job.started_at;
  await atomicWrite(job);
  if (await readOutcome(outcomePath) === "cancelled") {
    child.kill();
    job.state = "cancelled";
    job.finished_at = new Date().toISOString();
    job.updated_at = job.finished_at;
    job.notification = initialNotification(job.notify !== false, "suppressed");
    await atomicWrite(job);
    return;
  }
  await event("job.started", { pid: job.pid });

  const lines = readline.createInterface({ input: child.stdout });
  for await (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      item = { type: "raw.stdout", text: line };
    }
    updateFromCodexEvent(job, item);
    job.events = [...(job.events || []), item].slice(-100);
    job.updated_at = new Date().toISOString();
    if (await readOutcome(outcomePath) !== "cancelled") await atomicWrite(job);
    await event("codex.event", { payload: item });
  }
  const [code, signal] = await closePromise;

  let outcome;
  try {
    await writeFile(outcomePath, "terminal\n", { encoding: "utf8", flag: "wx" });
    outcome = "terminal";
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    outcome = await readOutcome(outcomePath);
  }
  if (outcome !== "terminal") {
    job.state = "cancelled";
    job.finished_at = new Date().toISOString();
    job.updated_at = job.finished_at;
    job.notification = initialNotification(job.notify !== false, "suppressed");
    await atomicWrite(job);
    return;
  }

  job.state = code === 0 && !spawnError ? "completed" : "failed";
  job.exit_code = code;
  job.signal = signal || null;
  job.stderr = stderr.trim().slice(-12_000) || null;
  job.error = spawnError ? `Codex process failed to start (${spawnError.code || "unknown error"})` : null;
  job.finished_at = new Date().toISOString();
  job.updated_at = job.finished_at;
  const requested = job.notify !== false;
  job.notification = initialNotification(requested, requested ? "pending" : "suppressed");

  // The terminal result is authoritative and is persisted before any callback work begins.
  await atomicWrite(job);
  await event("job.finished", { state: job.state, exit_code: code, signal: job.signal, session_id: job.session_id });

  if (!requested) {
    await atomicWrite(job);
    await event("notification.suppressed", { terminal_state: job.state, reason: "caller_preference" });
    return;
  }

  await event("notification.pending", { terminal_state: job.state });

  let config;
  try {
    config = await loadCallbackConfig({ kitHome, env: options.env || process.env });
  } catch (error) {
    job.notification = initialNotification(true, "failed", "Callback configuration is invalid");
    await atomicWrite(job);
    await event("notification.failed", {
      terminal_state: job.state,
      attempts: 0,
      error_category: error instanceof CallbackConfigError ? "configuration" : "configuration_io"
    });
    return;
  }

  if (!config) {
    job.notification = initialNotification(true, "disabled", "Callback configuration is not configured");
    await atomicWrite(job);
    await event("notification.disabled", { terminal_state: job.state, reason: "not_configured" });
    return;
  }

  job.notification = await deliverCallback({
    job,
    config,
    notification: job.notification,
    ...options.deliveryOptions,
    onUpdate: async (notification) => {
      job.notification = notification;
      job.updated_at = new Date().toISOString();
      await atomicWrite(job);
    },
    onEvent: event
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const jobId = process.argv[2];
  runWorker(jobId).catch((error) => {
    const message = error?.message || String(error);
    process.stderr.write(`codex-async worker failed: ${message}\n`);
    process.exitCode = 1;
  });
}
