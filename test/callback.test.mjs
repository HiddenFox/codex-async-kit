import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CallbackConfigError,
  PREVIEW_MAX_BYTES,
  PAYLOAD_MAX_BYTES,
  buildCallbackPayload,
  deliverCallback,
  deriveCallbackConfig,
  loadCallbackConfig,
  truncateUtf8
} from "../callback.mjs";

const PLACEHOLDER_TOKEN = "test-placeholder-token";

function sampleJob(overrides = {}) {
  return {
    job_id: "codex-11111111-1111-4111-8111-111111111111",
    state: "completed",
    session_id: "session-placeholder",
    exit_code: 0,
    finished_at: "2026-09-05T15:00:00.000Z",
    cwd: "D:\\Workspace\\project",
    last_message: "Done",
    prompt: "private prompt that must not appear",
    stderr: "private stderr that must not appear",
    events: [{ private: "event that must not appear" }],
    ...overrides
  };
}

async function localServer(handler, token = PLACEHOLDER_TOKEN) {
  const server = http.createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  const loom = new URL(`http://127.0.0.1:${port}/test-being/?ignored=value`);
  loom.searchParams.set("token", token);
  return {
    server,
    loomUrl: loom.toString(),
    close: () => new Promise((resolveClose) => server.close(resolveClose))
  };
}

test("derives query-authenticated callback URLs and removes unrelated query parameters", () => {
  const remoteToken = "remote token+value";
  const remoteLoom = new URL("https://echo.beings.town/alice/?ignored=value#fragment");
  remoteLoom.searchParams.set("token", remoteToken);
  const remote = deriveCallbackConfig(remoteLoom.toString());
  assert.equal(remote.callbackUrl, `https://echo.beings.town/alice/api/callback?${new URLSearchParams({ token: remoteToken }).toString()}`);
  assert.equal(remote.token, remoteToken);
  assert.equal(deriveCallbackConfig("https://localhost:8443/alice/?token=placeholder&ignored=value").callbackUrl, "http://localhost:8443/alice/api/callback?token=placeholder");
  assert.equal(deriveCallbackConfig("https://127.9.8.7/alice/?token=placeholder&ignored=value").callbackUrl, "http://127.9.8.7/alice/api/callback?token=placeholder");
  assert.throws(() => deriveCallbackConfig("http://example.com/alice/?token=secret"), CallbackConfigError);
  assert.throws(() => deriveCallbackConfig("http://127.example.com/alice/?token=secret"), CallbackConfigError);
  for (const protocol of ["ftp", "javascript", "file"]) {
    assert.throws(
      () => deriveCallbackConfig(`${protocol}://localhost/test-being/?token=placeholder`),
      CallbackConfigError,
      `${protocol} loopback URL must be rejected`
    );
  }
  assert.throws(() => deriveCallbackConfig("not a URL containing secret"), CallbackConfigError);
});

test("round-trips URLSearchParams token encoding without manual concatenation", () => {
  const token = "spaces + ampersand & slash / equals = question ?";
  const source = new URL("https://echo.beings.town/alice/?ignored=value");
  source.searchParams.set("token", token);
  const config = deriveCallbackConfig(source.toString());
  const callback = new URL(config.callbackUrl);
  assert.equal(callback.searchParams.get("token"), token);
  assert.equal(callback.searchParams.size, 1);
  assert.equal(callback.search, `?${new URLSearchParams({ token }).toString()}`);
});

test("delivers URLSearchParams-encoded tokens with an authorization header", async () => {
  const token = "space + ampersand & slash / equals = question ?";
  let received;
  const local = await localServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    received = { token: requestUrl.searchParams.get("token"), authorization: request.headers.authorization };
    response.writeHead(204).end();
  }, token);
  try {
    await deliverCallback({
      job: sampleJob(),
      config: deriveCallbackConfig(local.loomUrl),
      notification: { requested: true, state: "pending", attempts: 0 }
    });
    assert.deepEqual(received, { token, authorization: `Bearer ${token}` });
  } finally {
    await local.close();
  }
});

test("loads codex-async.env first, falls back to the environment, and disables when absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-callback-config-"));
  try {
    assert.equal(await loadCallbackConfig({ kitHome: directory, env: {} }), null);
    const fallback = await loadCallbackConfig({
      kitHome: directory,
      env: { CODEX_ASYNC_LOOM_URL: "https://echo.beings.town/env-being/?token=env-placeholder" }
    });
    assert.equal(fallback.callbackUrl, "https://echo.beings.town/env-being/api/callback?token=env-placeholder");
    await writeFile(join(directory, "codex-async.env"), "CODEX_ASYNC_LOOM_URL=https://echo.beings.town/file-being/?token=file-placeholder\n");
    const file = await loadCallbackConfig({
      kitHome: directory,
      env: { CODEX_ASYNC_LOOM_URL: "https://echo.beings.town/env-being/?token=env-placeholder" }
    });
    assert.equal(file.callbackUrl, "https://echo.beings.town/file-being/api/callback?token=file-placeholder");
    assert.equal(file.token, "file-placeholder");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("builds bounded payloads with stable identity and UTF-8-safe previews", () => {
  const unicode = "\u754c\u{1F642}".repeat(10_000);
  const preview = truncateUtf8(unicode);
  assert.equal(preview.truncated, true);
  assert.ok(Buffer.byteLength(preview.text, "utf8") <= PREVIEW_MAX_BYTES);
  assert.ok(!preview.text.includes("\uFFFD"));

  const completed = buildCallbackPayload(sampleJob({ last_message: unicode }));
  assert.equal(completed.payload.source, "codex-async");
  assert.equal(completed.payload.task_id, completed.payload.result.job_id);
  assert.match(completed.payload.summary, /job completed/);
  assert.equal(completed.payload.result.preview_truncated, true);
  assert.ok(Buffer.byteLength(completed.body, "utf8") < PAYLOAD_MAX_BYTES);
  assert.ok(!completed.body.includes("private prompt"));
  assert.ok(!completed.body.includes("private stderr"));
  assert.ok(!completed.body.includes("event that must not appear"));

  const failed = buildCallbackPayload(sampleJob({ state: "failed", exit_code: 7, last_message: null }));
  assert.match(failed.payload.summary, /job failed/);
  assert.match(failed.payload.result.last_message_preview, /inspect status/);
});

test("sends the token in the query with an authorization header and persists a redacted success", async () => {
  let requestRecord;
  const local = await localServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requestRecord = { url: request.url, authorization: request.headers.authorization, body };
    response.writeHead(204).end();
  });
  const events = [];
  try {
    const config = deriveCallbackConfig(local.loomUrl);
    const result = await deliverCallback({
      job: sampleJob(),
      config,
      notification: { requested: true, state: "pending", attempts: 0 },
      onEvent: async (name, fields) => events.push({ name, fields })
    });
    assert.equal(result.state, "delivered");
    assert.equal(result.attempts, 1);
    const requestUrl = new URL(requestRecord.url, "http://127.0.0.1");
    assert.equal(requestUrl.pathname, "/test-being/api/callback");
    assert.equal(requestUrl.searchParams.get("token"), PLACEHOLDER_TOKEN);
    assert.equal(requestUrl.searchParams.size, 1);
    assert.equal(requestRecord.authorization, `Bearer ${PLACEHOLDER_TOKEN}`);
    assert.equal(JSON.parse(requestRecord.body).task_id, sampleJob().job_id);
    assert.ok(!JSON.stringify({ result, events }).includes(PLACEHOLDER_TOKEN));
    assert.ok(!JSON.stringify({ result, events }).includes(config.callbackUrl));
  } finally {
    await local.close();
  }
});

test("retries 500 and 429 with one stable logical task ID", async () => {
  const receivedIds = [];
  let requests = 0;
  const local = await localServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    receivedIds.push(JSON.parse(body).task_id);
    requests += 1;
    if (requests === 1) response.writeHead(500).end();
    else if (requests === 2) response.writeHead(429, { "Retry-After": "0" }).end();
    else response.writeHead(200).end();
  });
  try {
    const waits = [];
    const result = await deliverCallback({
      job: sampleJob(),
      config: deriveCallbackConfig(local.loomUrl),
      notification: { requested: true, state: "pending", attempts: 0 },
      sleep: async (milliseconds) => waits.push(milliseconds),
      backoffMs: [1, 2]
    });
    assert.equal(result.state, "delivered");
    assert.equal(result.attempts, 3);
    assert.deepEqual(new Set(receivedIds), new Set([sampleJob().job_id]));
    assert.deepEqual(waits, [1, 0]);
  } finally {
    await local.close();
  }
});

test("contains localhost redirects without following the target", async () => {
  let callbackRequests = 0;
  let sinkRequests = 0;
  let authorization = null;
  const events = [];
  const local = await localServer((request, response) => {
    if (new URL(request.url, "http://127.0.0.1").pathname === "/test-being/api/callback") {
      callbackRequests += 1;
      authorization = request.headers.authorization;
      response.writeHead(302, { Location: "/sink" }).end();
      return;
    }
    if (request.url === "/sink") sinkRequests += 1;
    response.writeHead(200).end();
  });
  try {
    const result = await deliverCallback({
      job: sampleJob(),
      config: deriveCallbackConfig(local.loomUrl),
      notification: { requested: true, state: "pending", attempts: 0 },
      onEvent: async (name, fields) => events.push({ name, fields }),
      sleep: async () => {}
    });
    assert.equal(callbackRequests, 1);
    assert.equal(sinkRequests, 0);
    assert.equal(authorization, `Bearer ${PLACEHOLDER_TOKEN}`);
    assert.equal(result.state, "failed");
    assert.equal(result.attempts, 1);
    assert.equal(result.http_status, 302);
    assert.ok(!JSON.stringify({ result, events }).includes(PLACEHOLDER_TOKEN));
    assert.ok(!JSON.stringify({ result, events }).includes(deriveCallbackConfig(local.loomUrl).callbackUrl));
  } finally {
    await local.close();
  }
});

test("version metadata is consistent at 1.1.7", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifestJson = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(packageJson.version, "1.1.7");
  assert.equal(manifestJson.version, "1.1.7");
});

for (const status of [400, 401, 403, 413]) {
  test(`does not retry HTTP ${status}`, async () => {
    let requests = 0;
    const local = await localServer((_request, response) => {
      requests += 1;
      response.writeHead(status).end("response body must not be persisted");
    });
    try {
      const result = await deliverCallback({
        job: sampleJob(),
        config: deriveCallbackConfig(local.loomUrl),
        notification: { requested: true, state: "pending", attempts: 0 },
        sleep: async () => {}
      });
      assert.equal(requests, 1);
      assert.equal(result.state, "failed");
      assert.equal(result.last_error, `HTTP ${status} response`);
      assert.ok(!JSON.stringify(result).includes("response body"));
    } finally {
      await local.close();
    }
  });
}

test("retries connection failures and exhausts a bounded attempt count", async () => {
  const probe = await localServer((_request, response) => response.end());
  const config = deriveCallbackConfig(probe.loomUrl);
  await probe.close();
  const result = await deliverCallback({
    job: sampleJob(),
    config,
    notification: { requested: true, state: "pending", attempts: 0 },
    sleep: async () => {},
    timeoutMs: 100
  });
  assert.equal(result.state, "failed");
  assert.equal(result.attempts, 3);
  assert.equal(result.last_error, "Callback connection failed");
});

test("retries timeouts without exceeding the attempt limit", async () => {
  let calls = 0;
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    calls += 1;
    signal.addEventListener("abort", () => reject(Object.assign(new Error("hidden details"), { name: "AbortError" })));
  });
  const result = await deliverCallback({
    job: sampleJob(),
    config: { callbackUrl: "http://127.0.0.1/test-being/api/callback", token: PLACEHOLDER_TOKEN },
    notification: { requested: true, state: "pending", attempts: 0 },
    fetchImpl,
    sleep: async () => {},
    timeoutMs: 5
  });
  assert.equal(calls, 3);
  assert.equal(result.state, "failed");
  assert.equal(result.last_error, "Callback request timed out");
});

test("payload construction failures do not attempt delivery", async () => {
  let calls = 0;
  const events = [];
  const result = await deliverCallback({
    job: sampleJob({ state: "running" }),
    config: { callbackUrl: "http://127.0.0.1/test-being/api/callback", token: PLACEHOLDER_TOKEN },
    notification: { requested: true, state: "pending", attempts: 0 },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not run");
    },
    onEvent: async (name, fields) => events.push({ name, fields })
  });
  assert.equal(calls, 0);
  assert.equal(result.state, "failed");
  assert.equal(result.attempts, 0);
  assert.equal(events[0].fields.error_category, "payload");
});

test("the unified config example contains placeholders and private config is ignored", async () => {
  const example = await readFile(new URL("../codex-async.env.example", import.meta.url), "utf8");
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(example, /\{\{YOUR_GROVE_TOKEN\}\}/);
  assert.match(example, /\{\{YOUR_BEING_ID\}\}/);
  assert.match(example, /\{\{YOUR_LOOM_TOKEN\}\}/);
  assert.match(ignore, /^codex-async\.env$/m);
  assert.ok(!example.includes(PLACEHOLDER_TOKEN));
});
