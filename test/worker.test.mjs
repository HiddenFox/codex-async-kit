import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runWorker } from "../worker.mjs";

const PLACEHOLDER_TOKEN = "worker-placeholder-token";

function fakeSpawn({ exitCode = 0, delay = 0 } = {}) {
  return () => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false;
    const close = (code, signal = null) => {
      if (closed) return;
      closed = true;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit("close", code, signal));
    };
    child.kill = () => {
      close(null, "SIGTERM");
      return true;
    };
    setImmediate(() => {
      if (closed) return;
      child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "session-test" })}\n`);
      child.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Test final message" } })}\n`);
      child.stdout.write(`${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } })}\n`);
      setTimeout(() => close(exitCode), delay);
    });
    return child;
  };
}

async function makeFixture({ notify = true, exitCode = 0, delay = 0, callbackUrl = null } = {}) {
  const kitHome = await mkdtemp(join(tmpdir(), "codex-worker-"));
  const jobs = join(kitHome, "jobs");
  await mkdir(jobs, { recursive: true });
  const jobId = `codex-${crypto.randomUUID()}`;
  const job = {
    job_id: jobId,
    state: "queued",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    cwd: kitHome,
    model: null,
    profile: null,
    sandbox: "workspace-write",
    prompt: "private test prompt",
    notify,
    resumed_from: null,
    session_id: null,
    last_message: null,
    error: null,
    exit_code: null,
    usage: null,
    events: []
  };
  await writeFile(join(jobs, `${jobId}.json`), `${JSON.stringify(job, null, 2)}\n`);
  if (callbackUrl) await writeFile(join(kitHome, "codex-async.env"), `CODEX_ASYNC_LOOM_URL=${callbackUrl}\n`);
  return {
    kitHome,
    jobId,
    jobPath: join(jobs, `${jobId}.json`),
    eventsPath: join(jobs, `${jobId}.events.jsonl`),
    spawnImpl: fakeSpawn({ exitCode, delay }),
    cleanup: () => rm(kitHome, { recursive: true, force: true })
  };
}

async function callbackServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/worker-being/?token=${PLACEHOLDER_TOKEN}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose))
  };
}

test("persists terminal state before callback and records delivered metadata", async () => {
  let received;
  let fixture;
  const server = await callbackServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const persisted = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    received = { request, payload: JSON.parse(body), persisted };
    response.writeHead(202).end();
  });
  fixture = await makeFixture({ callbackUrl: server.url });
  try {
    await runWorker(fixture.jobId, {
      kitHome: fixture.kitHome,
      codexExecutable: "fake-codex",
      spawnImpl: fixture.spawnImpl
    });
    const job = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    const events = await readFile(fixture.eventsPath, "utf8");
    assert.equal(received.persisted.state, "completed");
    assert.equal(received.persisted.notification.state, "delivering");
    assert.equal(received.payload.task_id, fixture.jobId);
    const callbackUrl = new URL(received.request.url, "http://127.0.0.1");
    assert.equal(callbackUrl.pathname, "/worker-being/api/callback");
    assert.equal(callbackUrl.searchParams.get("token"), PLACEHOLDER_TOKEN);
    assert.equal(callbackUrl.searchParams.size, 1);
    assert.equal(received.request.headers.authorization, `Bearer ${PLACEHOLDER_TOKEN}`);
    assert.equal(job.state, "completed");
    assert.equal(job.notification.state, "delivered");
    assert.equal(job.notification.attempts, 1);
    assert.ok(events.indexOf("job.finished") < events.indexOf("notification.attempt"));
    assert.ok(!JSON.stringify(job).includes(PLACEHOLDER_TOKEN));
    assert.ok(!events.includes(PLACEHOLDER_TOKEN));
  } finally {
    await fixture.cleanup();
    await server.close();
  }
});

test("callback exhaustion does not alter a failed Codex result", async () => {
  let requests = 0;
  const server = await callbackServer((_request, response) => {
    requests += 1;
    response.writeHead(500).end("private response body");
  });
  const fixture = await makeFixture({ callbackUrl: server.url, exitCode: 7 });
  try {
    await runWorker(fixture.jobId, {
      kitHome: fixture.kitHome,
      codexExecutable: "fake-codex",
      spawnImpl: fixture.spawnImpl,
      deliveryOptions: { sleep: async () => {}, backoffMs: [0, 0] }
    });
    const job = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    assert.equal(job.state, "failed");
    assert.equal(job.exit_code, 7);
    assert.equal(job.notification.state, "failed");
    assert.equal(job.notification.attempts, 3);
    assert.equal(requests, 3);
    assert.ok(!JSON.stringify(job).includes("private response body"));
  } finally {
    await fixture.cleanup();
    await server.close();
  }
});

test("missing and malformed configuration preserve completed jobs", async (context) => {
  await context.test("missing configuration is disabled", async () => {
    const fixture = await makeFixture();
    try {
      await runWorker(fixture.jobId, {
        kitHome: fixture.kitHome,
        codexExecutable: "fake-codex",
        spawnImpl: fixture.spawnImpl,
        env: {}
      });
      const job = JSON.parse(await readFile(fixture.jobPath, "utf8"));
      assert.equal(job.state, "completed");
      assert.equal(job.notification.state, "disabled");
      assert.match(job.notification.last_error, /not configured/);
    } finally {
      await fixture.cleanup();
    }
  });

  await context.test("malformed configuration is a redacted notification failure", async () => {
    const fixture = await makeFixture();
    const hidden = "malformed-placeholder-secret";
    try {
      await writeFile(join(fixture.kitHome, "codex-async.env"), `CODEX_ASYNC_LOOM_URL=not-a-url-${hidden}\n`);
      await runWorker(fixture.jobId, {
        kitHome: fixture.kitHome,
        codexExecutable: "fake-codex",
        spawnImpl: fixture.spawnImpl
      });
      const jobText = await readFile(fixture.jobPath, "utf8");
      const events = await readFile(fixture.eventsPath, "utf8");
      const job = JSON.parse(jobText);
      assert.equal(job.state, "completed");
      assert.equal(job.notification.state, "failed");
      assert.equal(job.notification.attempts, 0);
      assert.ok(!jobText.includes(hidden));
      assert.ok(!events.includes(hidden));
    } finally {
      await fixture.cleanup();
    }
  });

  await context.test("non-HTTP(S) loopback configuration is redacted and makes no request", async () => {
    let requests = 0;
    const server = await callbackServer((_request, response) => {
      requests += 1;
      response.writeHead(200).end();
    });
    const fixture = await makeFixture({ callbackUrl: server.url.replace("http:", "ftp:") });
    try {
      await runWorker(fixture.jobId, {
        kitHome: fixture.kitHome,
        codexExecutable: "fake-codex",
        spawnImpl: fixture.spawnImpl
      });
      const job = JSON.parse(await readFile(fixture.jobPath, "utf8"));
      assert.equal(job.state, "completed");
      assert.equal(job.notification.state, "failed");
      assert.equal(job.notification.attempts, 0);
      assert.equal(job.notification.last_error, "Callback configuration is invalid");
      assert.equal(requests, 0);
    } finally {
      await fixture.cleanup();
      await server.close();
    }
  });
});

test("notify false records suppression and makes no callback request", async () => {
  let requests = 0;
  const server = await callbackServer((_request, response) => {
    requests += 1;
    response.end();
  });
  const fixture = await makeFixture({ notify: false, callbackUrl: server.url });
  try {
    await runWorker(fixture.jobId, {
      kitHome: fixture.kitHome,
      codexExecutable: "fake-codex",
      spawnImpl: fixture.spawnImpl
    });
    const job = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    assert.equal(job.state, "completed");
    assert.equal(job.notification.state, "suppressed");
    assert.equal(job.notification.requested, false);
    assert.equal(requests, 0);
  } finally {
    await fixture.cleanup();
    await server.close();
  }
});

test("an explicit cancellation outcome prevents a worker callback", async () => {
  let requests = 0;
  const server = await callbackServer((_request, response) => {
    requests += 1;
    response.end();
  });
  const fixture = await makeFixture({ callbackUrl: server.url });
  try {
    const cancelled = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    cancelled.state = "cancelled";
    cancelled.finished_at = new Date().toISOString();
    cancelled.notification = {
      requested: true,
      state: "suppressed",
      attempts: 0,
      last_attempt_at: null,
      delivered_at: null,
      http_status: null,
      last_error: null
    };
    await writeFile(fixture.jobPath, `${JSON.stringify(cancelled, null, 2)}\n`);
    await writeFile(join(fixture.kitHome, "jobs", `${fixture.jobId}.outcome`), "cancelled\n");
    await runWorker(fixture.jobId, {
      kitHome: fixture.kitHome,
      codexExecutable: "fake-codex",
      spawnImpl: () => { throw new Error("Cancelled worker must not spawn Codex"); }
    });
    const final = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    assert.equal(final.state, "cancelled");
    assert.equal(final.notification.state, "suppressed");
    assert.equal(requests, 0);
  } finally {
    await fixture.cleanup();
    await server.close();
  }
});

test("cancellation that wins during process startup remains suppressed", async () => {
  let requests = 0;
  const server = await callbackServer((_request, response) => {
    requests += 1;
    response.end();
  });
  const fixture = await makeFixture({ callbackUrl: server.url, delay: 10 });
  const spawnChild = fixture.spawnImpl;
  try {
    await runWorker(fixture.jobId, {
      kitHome: fixture.kitHome,
      codexExecutable: "fake-codex",
      spawnImpl: (...args) => {
        writeFileSync(join(fixture.kitHome, "jobs", `${fixture.jobId}.outcome`), "cancelled\n", { flag: "wx" });
        return spawnChild(...args);
      }
    });
    const final = JSON.parse(await readFile(fixture.jobPath, "utf8"));
    assert.equal(final.state, "cancelled");
    assert.equal(final.notification.state, "suppressed");
    assert.equal(requests, 0);
  } finally {
    await fixture.cleanup();
    await server.close();
  }
});
