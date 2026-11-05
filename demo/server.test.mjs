import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer, demoBind } from "./server.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("demo listens on 0.0.0.0 unless HOST is set", () => {
  assert.equal(demoBind({}).host, "0.0.0.0");
  assert.equal(demoBind({ PORT: "4173" }).port, 4173);
  assert.equal(demoBind({ HOST: "127.0.0.1" }).host, "127.0.0.1");
});

test("demo serves the office and writes a hired Bot profile from the template", async () => {
  const iacDir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-iac-"));
  const before = fs.readFileSync(path.join(root, "templates", "fe.json"), "utf8");
  const server = createServer({ root, iac: { dir: iacDir, fallback: false } });
  const port = await listen(server);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Office/);
    assert.match(html, /群組對話/);
    assert.doesNotMatch(html, /吳像素/);

    const office = await fetch(`http://127.0.0.1:${port}/office.mjs`);
    assert.equal(office.status, 200);

    const hired = await fetch(`http://127.0.0.1:${port}/api/hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "FE", candidateId: "fe-wu", displayName: "吳像素" }),
    });
    assert.equal(hired.status, 201);
    const body = await hired.json();
    assert.equal(body.profile.runtime, "hermes");
    assert.equal(body.profile.openCode, false);
    assert.equal(body.profile.displayName, "吳像素");
    assert.equal(body.profile.createdBy, "mock-hermes");
    const saved = JSON.parse(fs.readFileSync(body.file, "utf8"));
    assert.equal(saved.candidateId, "fe-wu");
    assert.equal(fs.readFileSync(path.join(root, "templates", "fe.json"), "utf8"), before);

    const rejected = await fetch(`http://127.0.0.1:${port}/api/hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "HR", candidateId: "hr", displayName: "某人" }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pixel office events are forwarded and bad payloads are refused", async () => {
  const seen = [];
  const server = createServer({
    root,
    iac: { dir: fs.mkdtempSync(path.join(os.tmpdir(), "ho-iac-")), fallback: false },
    pixelOffice: {
      async send(event) {
        seen.push(event);
        return { httpOk: true, udpOk: true };
      },
      close() {},
    },
  });
  const port = await listen(server);
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/api/pixel-office/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{
          version: 1,
          provider: "harness-office",
          sessionId: "mock-office",
          agentId: "hr",
          projectId: "harness-office",
          projectLabel: "HarnessOffice",
          kind: "upsert",
          state: "idle",
          activity: "present",
          occurredAt: 1,
        }],
      }),
    });
    assert.equal(ok.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].state, "idle");

    const bad = await fetch(`http://127.0.0.1:${port}/api/pixel-office/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [{ version: 1, kind: "upsert", state: "coding" }] }),
    });
    const body = await bad.json();
    assert.equal(body.results[0].ok, false);
    assert.equal(seen.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
