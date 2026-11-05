import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptySettings, endpointError, isConfigured, normalizeSettings } from "./hermes.mjs";

export function resolveHermesSettingsFile({
  env = process.env,
  home = os.homedir(),
  cwd = process.cwd(),
  mkdirSync = fs.mkdirSync,
  accessSync = fs.accessSync,
} = {}) {
  if (env.HARNESS_HERMES_SETTINGS) {
    const file = env.HARNESS_HERMES_SETTINGS;
    mkdirSync(path.dirname(file), { recursive: true });
    return { file, fallback: false };
  }
  const preferredDir = path.join(home, "harness-office-iac");
  try {
    mkdirSync(preferredDir, { recursive: true });
    accessSync(preferredDir, fs.constants.W_OK);
    return { file: path.join(preferredDir, "hermes.json"), fallback: false };
  } catch {
    return { file: path.resolve(cwd, ".hermes-settings.json"), fallback: true };
  }
}

export function loadHermesSettings(file, { readFileSync = fs.readFileSync } = {}) {
  if (!file) return emptySettings();
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptySettings();
    throw error;
  }
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    const error = new Error("unreadable");
    error.code = "unreadable";
    throw error;
  }
}

export function publicHermesSettings(settings, extra = {}) {
  const normalized = normalizeSettings(settings);
  return {
    configured: isConfigured(normalized),
    endpoint: normalized.endpoint,
    tokenSet: normalized.token !== "",
    bot: normalized.bot,
    group: normalized.group,
    ...extra,
  };
}

export function saveHermesSettings(file, update, deps = {}) {
  const previous = loadHermesSettings(file, deps);
  const draft = {
    endpoint: Object.hasOwn(update ?? {}, "endpoint") ? update.endpoint : previous.endpoint,
    token: previous.token,
    bot: { ...previous.bot, ...(update?.bot ?? {}) },
    group: { ...previous.group, ...(update?.group ?? {}) },
  };
  if (update?.clearToken) draft.token = "";
  else if (typeof update?.token === "string" && update.token !== "") draft.token = update.token;
  const next = normalizeSettings(draft);
  if (endpointError(next.endpoint)) {
    const error = new Error("bad-endpoint");
    error.code = "bad-endpoint";
    throw error;
  }
  const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  const renameSync = deps.renameSync ?? fs.renameSync;
  const chmodSync = deps.chmodSync ?? fs.chmodSync;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return next;
}
