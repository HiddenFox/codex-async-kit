#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const RELEASE_FILES = Object.freeze([
  "CHANGELOG.md",
  "README.md",
  "callback.mjs",
  "codex-async.env.example",
  "config.mjs",
  "manifest.json",
  "package.json",
  "server.mjs",
  "worker.mjs"
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

async function main() {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(repository, "manifest.json"), "utf8"));
  if (packageJson.version !== manifest.version) {
    throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`Invalid release version: ${manifest.version}`);

  const outputDirectory = join(repository, "target");
  const archive = join(outputDirectory, `${manifest.name}-${manifest.version}.tar.gz`);
  const staging = await mkdtemp(join(tmpdir(), "codex-async-release-"));
  try {
    await mkdir(outputDirectory, { recursive: true });
    await rm(archive, { force: true });
    for (const relativePath of RELEASE_FILES) {
      await copyFile(join(repository, relativePath), join(staging, basename(relativePath)));
    }
    run("tar", ["-czf", archive, "-C", staging, "."]);

    const entries = run("tar", ["-tzf", archive])
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^\.\//, ""))
      .filter(Boolean)
      .sort();
    const expected = [...RELEASE_FILES].sort();
    if (JSON.stringify(entries) !== JSON.stringify(expected)) {
      throw new Error(`Archive contents differ from release whitelist: ${entries.join(", ")}`);
    }
    process.stdout.write(`${archive}\n${entries.join("\n")}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
