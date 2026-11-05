import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveIacDir, writeProfile } from "./iac.mjs";

test("prefers ~/harness-office-iac/bots when that directory is writable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ho-home-"));
  const resolved = resolveIacDir({ env: {}, home, cwd: "/unused" });
  assert.equal(resolved.fallback, false);
  assert.equal(resolved.dir, path.join(home, "harness-office-iac", "bots"));
  assert.equal(fs.existsSync(resolved.dir), true);
});

test("uses HARNESS_IAC_BOTS when it is set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-env-"));
  const target = path.join(dir, "bots");
  const resolved = resolveIacDir({ env: { HARNESS_IAC_BOTS: target }, home: "/nope", cwd: "/nope" });
  assert.equal(resolved.dir, target);
  assert.equal(resolved.fallback, false);
});

test("falls back to ./.iac-bots when the home path cannot be written", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ho-cwd-"));
  const resolved = resolveIacDir({
    env: {},
    home: "/home/operator",
    cwd,
    mkdirSync(dir) {
      if (String(dir).includes("harness-office-iac")) {
        const error = new Error("read-only");
        error.code = "EACCES";
        throw error;
      }
      fs.mkdirSync(dir, { recursive: true });
    },
  });
  assert.equal(resolved.fallback, true);
  assert.equal(resolved.dir, path.join(cwd, ".iac-bots"));
});

test("writeProfile stamps a file and does not require the template path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-bots-"));
  const file = writeProfile(dir, {
    role: "PM",
    runtime: "hermes",
    displayName: "林可",
    candidateId: "pm-lin",
    openCode: false,
  });
  assert.equal(file, path.join(dir, "pm-lin.json"));
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.displayName, "林可");
  assert.equal(saved.openCode, false);
});
