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

test("the chat page offers Hermes settings in zh-TW and empty settings stay Mock", async () => {
  const calls = [];
  const iacDir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-iac-"));
  const hermesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ho-hermes-")), "hermes.json");
  const server = createServer({
    root,
    iac: { dir: iacDir, fallback: false },
    hermesFile,
    hermesFetch: async () => {
      calls.push("network");
      throw new Error("network should not be called");
    },
  });
  const port = await listen(server);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.match(html, /Hermes 設定/);
    assert.match(html, /Mock mode：尚未設定 Hermes/);
    assert.match(html, /清空並回到 Mock mode/);

    const hired = await fetch(`http://127.0.0.1:${port}/api/hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "FE", candidateId: "fe-wu", displayName: "吳像素" }),
    });
    const body = await hired.json();
    assert.equal(hired.status, 201);
    assert.equal(body.mode, "mock");
    assert.equal(body.reason, "unconfigured");
    assert.equal(body.profile.createdBy, "mock-hermes");
    assert.equal(calls.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("configured Hire posts to Hermes, then writes the Bot profile", async () => {
  const calls = [];
  const iacDir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-iac-"));
  const hermesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ho-hermes-")), "hermes.json");
  const server = createServer({
    root,
    iac: { dir: iacDir, fallback: false },
    hermesFile,
    hermesFetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      if (url.endsWith("/health") && !url.includes("/p/")) {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/capabilities")) {
        return new Response(JSON.stringify({ features: { session_chat_streaming: true } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/p/__ho_probe__/health")) {
        return new Response(JSON.stringify({ error: "Unknown or unconfigured profile" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/profiles")) {
        return new Response(JSON.stringify({ ok: true, name: "fe-wu" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/env") && init.method === "PUT") {
        return new Response(JSON.stringify({ ok: true, key: "API_SERVER_KEY" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/sessions")) {
        return new Response(JSON.stringify({ object: "hermes.session" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response("no", { status: 500 });
    },
  });
  const port = await listen(server);
  try {
    const saved = await fetch(`http://127.0.0.1:${port}/api/hermes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiBase: "https://hermes.example",
        token: "desk-token",
        dashboardToken: "dash-explicit",
        bot: { cloneFrom: "default", provider: "", model: "local" },
        group: { name: "HarnessOffice" },
      }),
    });
    const visible = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(visible.configured, true);
    assert.equal(visible.tokenSet, true);
    assert.equal(Object.hasOwn(visible, "token"), false);
    assert.equal(visible.group.name, "HarnessOffice");

    const again = await fetch(`http://127.0.0.1:${port}/api/hermes`);
    const stored = await again.json();
    assert.equal(stored.apiBase, "https://hermes.example");
    assert.equal(stored.bot.model, "local");
    assert.equal(Object.hasOwn(stored, "token"), false);

    const hired = await fetch(`http://127.0.0.1:${port}/api/hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "FE", candidateId: "fe-wu", displayName: "吳像素" }),
    });
    const body = await hired.json();
    assert.equal(hired.status, 201);
    assert.equal(body.mode, "live");
    assert.equal(body.reason, "created");
    assert.equal(body.profile.createdBy, "hermes");
    assert.equal(body.profile.hermes.name, "fe-wu");
    assert.equal(body.profile.openCode, false);
    const onDisk = JSON.parse(fs.readFileSync(body.file, "utf8"));
    assert.equal(onDisk.createdBy, "hermes");
    assert.equal(onDisk.hermesGroup.name, "HarnessOffice");
    assert.equal(onDisk.hermes.sessionId, "ho-fe-wu");
    assert.equal(onDisk.hermes.route, "multiplex");
    assert.equal(JSON.stringify(onDisk).includes("desk-token"), false);
    const posts = calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 2);
    assert.equal(posts[0].url, "https://hermes.example/api/profiles");
    assert.equal(JSON.parse(posts[0].body).name, "fe-wu");
    assert.equal(posts[1].url, "https://hermes.example/p/fe-wu/api/sessions");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an unreachable Hermes endpoint still hires in Mock mode, and a refusal does not", async () => {
  const iacDir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-iac-"));
  const hermesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ho-hermes-")), "hermes.json");
  let failPost = false;
  const server = createServer({
    root,
    iac: { dir: iacDir, fallback: false },
    hermesFile,
    hermesFetch: async (_url, init) => {
      if (!failPost) throw new TypeError("fetch failed");
      if (init.method === "GET") return new Response("", { status: 200 });
      return new Response("no", { status: 500 });
    },
  });
  const port = await listen(server);
  try {
    await fetch(`http://127.0.0.1:${port}/api/hermes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "https://hermes.example/api/profiles" }),
    });
    const mocked = await fetch(`http://127.0.0.1:${port}/api/hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "BE", candidateId: "be-huang", displayName: "黃渠" }),
    });
    const mockBody = await mocked.json();
    assert.equal(mocked.status, 201);
    assert.equal(mockBody.mode, "mock");
    assert.equal(mockBody.reason, "unreachable");
    assert.equal(mockBody.profile.createdBy, "mock-hermes");
    assert.equal(fs.existsSync(mockBody.file), true);

    failPost = true;
    const before = fs.readdirSync(iacDir).length;
    const refused = await fetch(`http://127.0.0.1:${port}/api/hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "QA", candidateId: "qa-he", displayName: "何驗" }),
    });
    const refusedBody = await refused.json();
    assert.equal(refused.status, 502);
    assert.match(refusedBody.message, /沒有建立 Bot/);
    assert.equal(fs.readdirSync(iacDir).length, before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
