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
    assert.equal(initialized.result.serverInfo.version, "1.1.0");

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
