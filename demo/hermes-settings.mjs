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
    apiBase: normalized.apiBase,
    dashboardBase: normalized.dashboardBase,
    tokenSet: normalized.token !== "",
    dashboardTokenSet: normalized.dashboardToken !== "",
    bot: normalized.bot,
    group: normalized.group,
    ...extra,
  };
}

export function saveHermesSettings(file, update, deps = {}) {
  const previous = loadHermesSettings(file, deps);
  const draft = {
    apiBase: Object.hasOwn(update ?? {}, "apiBase")
      ? update.apiBase
      : Object.hasOwn(update ?? {}, "endpoint")
        ? update.endpoint
        : previous.apiBase,
    dashboardBase: Object.hasOwn(update ?? {}, "dashboardBase") ? update.dashboardBase : previous.dashboardBase,
    token: previous.token,
    dashboardToken: previous.dashboardToken,
    bot: { ...previous.bot, ...(update?.bot ?? {}) },
    group: { name: update?.group?.name ?? previous.group.name },
  };
  if (update?.clearToken) {
    draft.token = "";
    draft.dashboardToken = "";
  } else {
    if (typeof update?.token === "string" && update.token !== "") draft.token = update.token;
    if (typeof update?.dashboardToken === "string" && update.dashboardToken !== "") draft.dashboardToken = update.dashboardToken;
  }
  const next = normalizeSettings(draft);
  if (endpointError(next.apiBase) || endpointError(next.dashboardBase)) {
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
