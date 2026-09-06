import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const KIT_CONFIG_FILENAME = "codex-async.env";

export function parseKitConfig(content) {
  const values = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

export async function loadKitConfig(kitHome) {
  try {
    return parseKitConfig(await readFile(join(kitHome, KIT_CONFIG_FILENAME), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function resolveConfigValue(fileConfig, environment, ...names) {
  for (const name of names) {
    const fileValue = fileConfig[name];
    if (typeof fileValue === "string" && fileValue.trim()) return fileValue.trim();
  }
  for (const name of names) {
    const environmentValue = environment[name];
    if (typeof environmentValue === "string" && environmentValue.trim()) return environmentValue.trim();
  }
  return "";
}
