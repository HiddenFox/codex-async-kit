import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const PREVIEW_MAX_BYTES = 16 * 1024;
export const PAYLOAD_MAX_BYTES = 64 * 1024;
export const DELIVERY_ATTEMPTS = 3;
export const DELIVERY_BACKOFF_MS = [2_000, 4_000];
export const DELIVERY_TIMEOUT_MS = 30_000;

export class CallbackConfigError extends Error {
  constructor(message = "Callback configuration is invalid") {
    super(message);
    this.name = "CallbackConfigError";
  }
}

export class CallbackPayloadError extends Error {
  constructor(message = "Callback payload could not be constructed") {
    super(message);
    this.name = "CallbackPayloadError";
  }
}

function parseEnvValue(content, name) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0 || line.slice(0, separator).trim() !== name) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

export function deriveCallbackConfig(loomUrl) {
  let parsed;
  try {
    parsed = new URL(loomUrl);
  } catch {
    throw new CallbackConfigError();
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new CallbackConfigError();
  const hostname = parsed.hostname.toLowerCase();
  const loopbackParts = hostname.split(".").map(Number);
  const ipv4Loopback = /^127(?:\.\d{1,3}){3}$/.test(hostname) && loopbackParts.every((part) => part >= 0 && part <= 255);
  const local = hostname === "localhost" || ipv4Loopback;
  if (!parsed.hostname || parsed.username || parsed.password || (!local && parsed.protocol !== "https:")) {
    throw new CallbackConfigError();
  }
  if (local) parsed.protocol = "http:";
  const token = parsed.searchParams.get("token");
  if (!token || /[\u0000-\u001f\u007f]/.test(token)) throw new CallbackConfigError();
  const basePath = parsed.pathname.replace(/\/+$/, "");
  if (!basePath) throw new CallbackConfigError();
  parsed.pathname = `${basePath}/api/callback`;
  parsed.search = new URLSearchParams({ token }).toString();
  parsed.hash = "";
  return { callbackUrl: parsed.toString(), token };
}

export async function loadCallbackConfig({ kitHome, env = process.env } = {}) {
  let fileValue = "";
  try {
    fileValue = parseEnvValue(await readFile(join(kitHome, "callback.env"), "utf8"), "CODEX_ASYNC_LOOM_URL");
  } catch (error) {
    if (error.code !== "ENOENT") throw new CallbackConfigError();
  }
  const loomUrl = fileValue || env.CODEX_ASYNC_LOOM_URL || "";
  if (!loomUrl) return null;
  return deriveCallbackConfig(loomUrl);
}

export function truncateUtf8(value, maximumBytes = PREVIEW_MAX_BYTES) {
  const text = String(value ?? "");
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maximumBytes) return { text, truncated: false };
  let end = maximumBytes;
  while (end > 0) {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(encoded.subarray(0, end)), truncated: true };
    } catch {
      end -= 1;
    }
  }
  return { text: "", truncated: true };
}

export function buildCallbackPayload(job) {
  if (!job || !["completed", "failed"].includes(job.state) || !job.job_id || !job.finished_at) {
    throw new CallbackPayloadError();
  }
  const fallback = job.state === "failed"
    ? "Codex job failed without a final agent message; inspect status for the authoritative error."
    : "Codex job completed without a final agent message; inspect status for the authoritative result.";
  const preview = truncateUtf8(job.last_message || fallback);
  const payload = {
    source: "codex-async",
    task_id: job.job_id,
    summary: `codex-async job ${job.state}: ${job.job_id}`,
    result: {
      schema_version: 1,
      job_id: job.job_id,
      state: job.state,
      session_id: job.session_id || null,
      exit_code: job.exit_code ?? null,
      finished_at: job.finished_at,
      cwd: job.cwd,
      last_message_preview: preview.text,
      preview_truncated: preview.truncated,
      next_action: "Call codex_async_status with this job_id, inspect the authoritative result, then decide whether to report, verify, resume, or stay quiet."
    }
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > PAYLOAD_MAX_BYTES) throw new CallbackPayloadError();
  return { payload, body };
}

function retryAfterMilliseconds(value, now, maximum) {
  if (!value) return null;
  const seconds = Number(value);
  const proposed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now();
  if (!Number.isFinite(proposed) || proposed < 0) return null;
  return Math.min(proposed, maximum);
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function safeFailure(status, category) {
  if (status !== null) return `HTTP ${status} response`;
  if (category === "timeout") return "Callback request timed out";
  return "Callback connection failed";
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function deliverCallback({
  job,
  config,
  notification,
  onUpdate = async () => {},
  onEvent = async () => {},
  fetchImpl = globalThis.fetch,
  sleep = delay,
  now = Date.now,
  attempts = DELIVERY_ATTEMPTS,
  backoffMs = DELIVERY_BACKOFF_MS,
  timeoutMs = DELIVERY_TIMEOUT_MS,
  maxRetryAfterMs = 30_000
}) {
  let built;
  try {
    built = buildCallbackPayload(job);
  } catch {
    const failed = { ...notification, state: "failed", last_error: "Callback payload is invalid" };
    await onUpdate(failed);
    await onEvent("notification.failed", { attempts: failed.attempts, error_category: "payload" });
    return failed;
  }

  let current = { ...notification };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = now();
    current = {
      ...current,
      state: "delivering",
      attempts: attempt,
      last_attempt_at: new Date(started).toISOString(),
      http_status: null,
      last_error: null
    };
    await onUpdate(current);
    await onEvent("notification.attempt", { attempt, terminal_state: job.state });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    let category = null;
    try {
      response = await fetchImpl(config.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: built.body,
        redirect: "manual",
        signal: controller.signal
      });
    } catch (error) {
      category = controller.signal.aborted || error?.name === "AbortError" ? "timeout" : "connection";
    } finally {
      clearTimeout(timeout);
    }
    const elapsed_ms = Math.max(0, now() - started);
    if (response?.ok) {
      current = {
        ...current,
        state: "delivered",
        delivered_at: new Date(now()).toISOString(),
        http_status: response.status,
        last_error: null
      };
      await onUpdate(current);
      await onEvent("notification.delivered", { attempt, terminal_state: job.state, http_status: response.status, elapsed_ms });
      return current;
    }
    const status = response?.status ?? null;
    const retryable = category !== null || isRetryableStatus(status);
    current = { ...current, http_status: status, last_error: safeFailure(status, category) };
    if (!retryable || attempt === attempts) {
      current.state = "failed";
      await onUpdate(current);
      await onEvent("notification.failed", {
        attempt,
        terminal_state: job.state,
        http_status: status,
        elapsed_ms,
        error_category: category || "http"
      });
      return current;
    }
    await onUpdate(current);
    const retryAfter = status === 429
      ? retryAfterMilliseconds(response.headers.get("retry-after"), now, maxRetryAfterMs)
      : null;
    const wait_ms = retryAfter ?? backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
    await onEvent("notification.retry_scheduled", {
      attempt,
      terminal_state: job.state,
      http_status: status,
      elapsed_ms,
      retry_category: category || `http_${status}`,
      wait_ms
    });
    await sleep(wait_ms);
  }
  return current;
}
