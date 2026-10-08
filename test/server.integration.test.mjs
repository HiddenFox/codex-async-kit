import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

function fakeWorkerSpawn() {
  return { pid: 31337, unref() {} };
}

function sendProtocolRequest(startServer, request) {
  const input = new PassThrough();
  const output = new PassThrough();
  startServer(input, output);
  return new Promise((resolveResponse, rejectResponse) => {
    const timer = setTimeout(() => rejectResponse(new Error("Protocol response timed out")), 1_000);
    output.once("data", (chunk) => {
      clearTimeout(timer);
      resolveResponse(JSON.parse(chunk.toString()));
    });
    input.write(`${JSON.stringify(request)}\n`);
  });
}

function heartbeatRequest(id, name, args = {}) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

async function importServerForHeartbeatTest(kitHome, token) {
  process.env.CODEX_ASYNC_KIT_HOME = kitHome;
  process.env.GROVE_TOKEN = token;
  process.env.BEINGS_TOWN_GROVE_TOKEN = "";
  process.env.GROVE_API_BASE = "https://grove.test";
  process.env.GROVE_KIT_ID = "test-kit";
  return import(`../server.mjs?heartbeat-test=${Date.now()}-${Math.random()}`);
}

test("server run/resume remain immediate, schemas agree, and cancellation is durable", async () => {
  const kitHome = await mkdtemp(join(tmpdir(), "codex-server-"));
  const previousKitHome = process.env.CODEX_ASYNC_KIT_HOME;
  const previousGroveToken = process.env.GROVE_TOKEN;
  const previousLegacyGroveToken = process.env.BEINGS_TOWN_GROVE_TOKEN;
  process.env.CODEX_ASYNC_KIT_HOME = kitHome;
  process.env.GROVE_TOKEN = "";
  process.env.BEINGS_TOWN_GROVE_TOKEN = "";
  try {
    const server = await import(`../server.mjs?test=${Date.now()}`);
    const initialized = await sendProtocolRequest(server.startServer, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" }
    });
    assert.equal(initialized.result.serverInfo.version, "1.1.8");

    const manifest = JSON.parse(await readFile(resolve("manifest.json"), "utf8"));
    for (const name of ["run", "resume"]) {
      const runtimeProperties = Object.keys(server.tools.find((tool) => tool.name === name).inputSchema.properties).sort();
      const manifestProperties = Object.keys(manifest.tools.find((tool) => tool.name === name).params.properties).sort();
      assert.deepEqual(runtimeProperties, manifestProperties);
      assert.equal(server.tools.find((tool) => tool.name === name).inputSchema.properties.notify.default, true);
    }

    const startedAt = Date.now();
    const started = await server.startJob(
      { cwd: kitHome, prompt: "Test run", notify: true },
      { spawnImpl: fakeWorkerSpawn }
    );
    assert.ok(Date.now() - startedAt < 500);
    assert.equal(started.state, "queued");
    assert.equal(started.notify, true);
    const statusResponse = await sendProtocolRequest(server.startServer, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "status", arguments: { job_id: started.job_id } }
    });
    const status = JSON.parse(statusResponse.result.content[0].text);
    assert.equal(status.job_id, started.job_id);
    assert.equal(status.state, "queued");

    const resumedAt = Date.now();
    const resumed = await server.resumeJob(
      { sessionId: "session-placeholder", cwd: kitHome, prompt: "Test resume", notify: false },
      { spawnImpl: fakeWorkerSpawn }
    );
    assert.ok(Date.now() - resumedAt < 500);
    assert.equal(resumed.resumed_from, "session-placeholder");
    assert.equal(resumed.notify, false);

    const jobs = await server.listJobs(10);
    assert.ok(jobs.some((job) => job.job_id === started.job_id));
    assert.ok(jobs.some((job) => job.job_id === resumed.job_id));

    const cancelled = await server.cancelJob(started.job_id);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.notification.state, "suppressed");
    assert.equal(cancelled.notification.requested, true);
    const outcome = await readFile(join(kitHome, "jobs", `${started.job_id}.outcome`), "utf8");
    assert.equal(outcome.trim(), "cancelled");

    await assert.rejects(
      server.startJob({ cwd: kitHome, prompt: "Invalid notify", notify: "yes" }, { spawnImpl: fakeWorkerSpawn }),
      /notify must be a boolean/
    );
  } finally {
    if (previousKitHome === undefined) delete process.env.CODEX_ASYNC_KIT_HOME;
    else process.env.CODEX_ASYNC_KIT_HOME = previousKitHome;
    if (previousGroveToken === undefined) delete process.env.GROVE_TOKEN;
    else process.env.GROVE_TOKEN = previousGroveToken;
    if (previousLegacyGroveToken === undefined) delete process.env.BEINGS_TOWN_GROVE_TOKEN;
    else process.env.BEINGS_TOWN_GROVE_TOKEN = previousLegacyGroveToken;
    await rm(kitHome, { recursive: true, force: true });
  }
});

test("tools/call heartbeats report one successful or failed result without affecting protocol responses", async () => {
  const kitHome = await mkdtemp(join(tmpdir(), "codex-heartbeat-"));
  const environment = Object.fromEntries(["CODEX_ASYNC_KIT_HOME", "GROVE_TOKEN", "BEINGS_TOWN_GROVE_TOKEN", "GROVE_API_BASE", "GROVE_KIT_ID"].map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalStderrWrite = process.stderr.write;
  const requests = [];
  const diagnostics = [];
  let responseOk = true;
  let networkFailure = false;
  process.stderr.write = (chunk) => {
    diagnostics.push(String(chunk));
    return true;
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (networkFailure) throw new Error("mock network failure");
    return { ok: responseOk, status: responseOk ? 200 : 503 };
  };
  try {
    const server = await importServerForHeartbeatTest(kitHome, "test-token");

    const successful = await sendProtocolRequest(server.startServer, heartbeatRequest(1, "list"));
    assert.ok(successful.result);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.calls, 1);
    assert.deepEqual(requests[0].body.successful, 1);
    assert.deepEqual(requests[0].body.failed, 0);
    assert.equal(requests[0].url, "https://grove.test/api/grove/test-kit/heartbeat");
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");

    const unknownTool = await sendProtocolRequest(server.startServer, heartbeatRequest(2, "not-a-tool"));
    assert.equal(unknownTool.error.code, -32000);
    assert.match(unknownTool.error.message, /unknown tool: not-a-tool/);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].body.calls, 1);
    assert.deepEqual(requests[1].body.successful, 0);
    assert.deepEqual(requests[1].body.failed, 1);

    responseOk = false;
    const successfulWithRejectedHeartbeat = await sendProtocolRequest(server.startServer, heartbeatRequest(3, "list"));
    assert.ok(successfulWithRejectedHeartbeat.result);
    const failedWithRejectedHeartbeat = await sendProtocolRequest(server.startServer, heartbeatRequest(4, "still-not-a-tool"));
    assert.equal(failedWithRejectedHeartbeat.error.code, -32000);
    assert.equal(requests.length, 4);
    assert.ok(diagnostics.some((message) => message.includes("usage report failed: heartbeat HTTP 503")));

    responseOk = true;
    networkFailure = true;
    const successfulWithNetworkFailure = await sendProtocolRequest(server.startServer, heartbeatRequest(5, "list"));
    assert.ok(successfulWithNetworkFailure.result);
    assert.equal(requests.length, 5);
    assert.ok(diagnostics.some((message) => message.includes("usage report failed: network error")));

    const initialized = await sendProtocolRequest(server.startServer, { jsonrpc: "2.0", id: 6, method: "initialize", params: {} });
    const listed = await sendProtocolRequest(server.startServer, { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} });
    assert.ok(initialized.result);
    assert.ok(listed.result);
    assert.equal(requests.length, 5);

    for (const request of requests) {
      assert.equal(request.body.calls, request.body.successful + request.body.failed);
      assert.equal(request.body.calls, 1);
      assert.match(request.body.last_used_at, /^\d{4}-\d{2}-\d{2}T/);
    }

    const noTokenServer = await importServerForHeartbeatTest(kitHome, "");
    const withoutToken = await sendProtocolRequest(noTokenServer.startServer, heartbeatRequest(8, "list"));
    assert.ok(withoutToken.result);
    assert.equal(requests.length, 5);
    assert.ok(diagnostics.some((message) => message.includes("usage report skipped: GROVE_TOKEN not configured")));
  } finally {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(kitHome, { recursive: true, force: true });
  }
});
