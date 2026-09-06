import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { KIT_CONFIG_FILENAME, loadKitConfig, parseKitConfig, resolveConfigValue } from "../config.mjs";

const PLACEHOLDER_TOKEN = "placeholder-token-never-private";

test("parses the unified config file and preserves values containing equals signs", () => {
  const parsed = parseKitConfig(`
# one private file
GROVE_TOKEN='${PLACEHOLDER_TOKEN}'
CODEX_ASYNC_LOOM_URL="https://echo.beings.town/test/?token=a=b=c"
INVALID LINE
`);
  assert.equal(parsed.GROVE_TOKEN, PLACEHOLDER_TOKEN);
  assert.equal(parsed.CODEX_ASYNC_LOOM_URL, "https://echo.beings.town/test/?token=a=b=c");
  assert.equal(parsed.INVALID, undefined);
});

test("loads only codex-async.env and lets file values override environment values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-async-config-"));
  try {
    await writeFile(join(directory, "grove.env"), "GROVE_TOKEN=legacy-grove\n");
    await writeFile(join(directory, "callback.env"), "CODEX_ASYNC_LOOM_URL=https://echo.beings.town/legacy/?token=legacy\n");
    assert.deepEqual(await loadKitConfig(directory), {});

    await writeFile(join(directory, KIT_CONFIG_FILENAME), `GROVE_TOKEN=${PLACEHOLDER_TOKEN}\nGROVE_API_BASE=https://example.test\n`);
    const fileConfig = await loadKitConfig(directory);
    assert.equal(resolveConfigValue(fileConfig, { GROVE_TOKEN: "environment-token" }, "GROVE_TOKEN"), PLACEHOLDER_TOKEN);
    assert.equal(resolveConfigValue(fileConfig, { GROVE_KIT_ID: "environment-kit" }, "GROVE_KIT_ID"), "environment-kit");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
