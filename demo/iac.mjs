import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveIacDir({
  env = process.env,
  home = os.homedir(),
  cwd = process.cwd(),
  mkdirSync = fs.mkdirSync,
  accessSync = fs.accessSync,
} = {}) {
  if (env.HARNESS_IAC_BOTS) {
    mkdirSync(env.HARNESS_IAC_BOTS, { recursive: true });
    return { dir: env.HARNESS_IAC_BOTS, fallback: false };
  }

  const preferred = path.join(home, "harness-office-iac", "bots");
  try {
    mkdirSync(preferred, { recursive: true });
    accessSync(preferred, fs.constants.W_OK);
    return { dir: preferred, fallback: false };
  } catch {
    const fallback = path.resolve(cwd, ".iac-bots");
    mkdirSync(fallback, { recursive: true });
    return { dir: fallback, fallback: true };
  }
}

export function profileFileName(profile) {
  const id = String(profile.candidateId ?? profile.role ?? "bot")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${id || "bot"}.json`;
}

export function writeProfile(dir, profile, { writeFileSync = fs.writeFileSync, mkdirSync = fs.mkdirSync } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, profileFileName(profile));
  writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
  return file;
}
