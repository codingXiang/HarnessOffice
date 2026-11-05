import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadHermesSettings,
  publicHermesSettings,
  resolveHermesSettingsFile,
  saveHermesSettings,
} from "./hermes-settings.mjs";

test("a missing settings file is Mock mode", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ho-hermes-")), "hermes.json");
  const loaded = loadHermesSettings(file);
  assert.equal(loaded.endpoint, "");
  assert.equal(publicHermesSettings(loaded).configured, false);
  assert.equal(publicHermesSettings(loaded).tokenSet, false);
  assert.equal(Object.hasOwn(publicHermesSettings(loaded), "token"), false);
});

test("saved endpoint, bot, and group settings survive a reread, and a blank token does not wipe the old one", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ho-hermes-")), "hermes.json");
  saveHermesSettings(file, {
    endpoint: "https://hermes.example/api/profiles",
    token: "desk-token",
    bot: { cloneFrom: "default", provider: "openrouter", model: "local" },
    group: { name: "HarnessOffice", roomId: "room-7" },
  });
  const again = saveHermesSettings(file, {
    endpoint: "https://hermes.example/api/profiles",
    token: "",
    bot: { cloneFrom: "hr", provider: "", model: "local" },
    group: { name: "專案群", roomId: "" },
  });
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(onDisk.token, "desk-token");
  assert.equal(again.bot.cloneFrom, "hr");
  assert.equal(again.group.name, "專案群");
  assert.equal(publicHermesSettings(again).tokenSet, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const cleared = saveHermesSettings(file, { endpoint: "", clearToken: true });
  assert.equal(cleared.endpoint, "");
  assert.equal(cleared.token, "");
  assert.equal(publicHermesSettings(cleared).configured, false);
});

test("an endpoint that is not http(s) is refused", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ho-hermes-")), "hermes.json");
  assert.throws(
    () => saveHermesSettings(file, { endpoint: "file:///tmp/hermes" }),
    /bad-endpoint/,
  );
  assert.equal(fs.existsSync(file), false);
});

test("settings prefer the operator file under the home IaC directory", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ho-home-"));
  const resolved = resolveHermesSettingsFile({
    env: {},
    home,
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), "ho-cwd-")),
  });
  assert.equal(resolved.fallback, false);
  assert.equal(resolved.file, path.join(home, "harness-office-iac", "hermes.json"));
});
