import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTemplates } from "./server.mjs";
import { createOfficeRuntime, visualSnapshot } from "./runtime.mjs";

const templates = loadTemplates(path.join(path.dirname(fileURLToPath(import.meta.url)), "templates"));

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sse(text) {
  return new Response(
    `event: assistant.completed\ndata: ${JSON.stringify({ content: text, completed: true })}\n\nevent: run.completed\ndata: {"completed":true}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function liveFetch(calls, { profileStatus = 201, streamText = "我先把驗收條件列出來。" } = {}) {
  return async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body });
    if (url.endsWith("/health") && !url.includes("/p/")) return json(200, { status: "ok" });
    if (url.endsWith("/v1/capabilities")) return json(200, { features: { session_chat_streaming: true } });
    if (url.includes("/p/__ho_probe__/health")) return json(404, { error: "Unknown or unconfigured profile" });
    if (url.endsWith("/api/profiles")) return json(profileStatus, profileStatus === 201 ? { ok: true, name: "pm-lin" } : { detail: "Profile already exists" });
    if (url.endsWith("/api/sessions") && init.method === "POST") {
      return json(calls.filter((call) => call.url.endsWith("/api/sessions")).length > 1 ? 409 : 201, { detail: "Session already exists" });
    }
    if (url.endsWith("/chat/stream")) return sse(streamText);
    throw new Error(`unexpected ${init?.method} ${url}`);
  };
}

async function hirePm(runtime) {
  await runtime.postMessage({ text: "@HR PM", clientMessageId: "ask-pm" });
  return runtime.hireCandidate("pm-lin");
}

test("Mock mode hires and chats without calling Hermes", async () => {
  const calls = [];
  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: async () => {
      calls.push("network");
      throw new Error("offline");
    },
    loadSettings: () => ({}),
  });
  runtime.boot(null);
  const hired = await hirePm(runtime);
  assert.equal(hired.profile.createdBy, "mock-hermes");
  assert.equal(calls.length, 0);
  const replied = await runtime.postMessage({ text: "@PM 做一個像素 Office", clientMessageId: "draft-1" });
  assert.match(replied.session.office.messages.at(-1).text, /驗收條件/);
  const again = await runtime.postMessage({ text: "@PM 做一個像素 Office", clientMessageId: "draft-1" });
  assert.equal(again.duplicate, true);
  assert.equal(again.session.office.messages.filter((message) => message.from === "human").length, 2);
});

test("a live message is delivered to that bot session and the visual line is the reply", async () => {
  const calls = [];
  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: liveFetch(calls),
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", group: { name: "HarnessOffice" } }),
  });
  runtime.boot(null);
  const hired = await hirePm(runtime);
  assert.equal(hired.profile.hermes.sessionId, "ho-pm-lin");
  const replied = await runtime.postMessage({ text: "@PM 做一個像素 Office", clientMessageId: "live-1" });
  const last = replied.session.office.messages.at(-1);
  assert.equal(last.from, "PM");
  assert.equal(last.text, "我先把驗收條件列出來。");
  const shot = visualSnapshot(replied.session);
  assert.equal(shot.lines.at(-1).text, "我先把驗收條件列出來。");
  assert.equal(shot.roles.find((role) => role.role === "PM").text, "我先把驗收條件列出來。");
  const stream = calls.filter((call) => call.url.endsWith("/chat/stream"));
  assert.equal(stream.length, 1);
  assert.equal(stream[0].url, "https://hermes.example/p/pm-lin/api/sessions/ho-pm-lin/chat/stream");

  const saved = runtime.snapshot();
  const againCalls = [];
  const restarted = createOfficeRuntime({
    templates,
    fetchImpl: liveFetch(againCalls, { profileStatus: 400, streamText: "第二則只出現一次。" }),
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", group: { name: "HarnessOffice" } }),
  });
  restarted.boot(saved);
  await restarted.postMessage({ text: "@PM 再補一條驗收", clientMessageId: "live-2" });
  assert.equal(againCalls.filter((call) => call.url.endsWith("/api/sessions") && call.method === "POST").length, 0);
  assert.equal(againCalls.filter((call) => call.url.endsWith("/chat/stream")).length, 1);
  assert.equal(restarted.view().office.messages.filter((message) => message.text === "我先把驗收條件列出來。").length, 1);
  assert.equal(restarted.view().office.messages.filter((message) => message.text === "第二則只出現一次。").length, 1);
});

test("when multiplex is off, the hired Bot does not get a Mock script reply", async () => {
  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      if (url.endsWith("/v1/capabilities")) return json(200, {});
      if (url.includes("/p/__ho_probe__/health")) return json(200, { status: "ok" });
      if (url.endsWith("/api/profiles")) return json(201, { ok: true, name: "pm-lin" });
      throw new Error(url);
    },
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token" }),
  });
  runtime.boot(null);
  const hired = await hirePm(runtime);
  assert.equal(hired.profile.hermes.route, "unavailable");
  const replied = await runtime.postMessage({ text: "@PM 做一個像素 Office", clientMessageId: "no-mock" });
  assert.equal(replied.session.office.issue, null);
  assert.match(replied.session.office.messages.at(-1).text, /沒有改用 Mock/);
});

test("a pending Hermes turn is marked interrupted after restart and is not resent", async () => {
  const calls = [];
  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: liveFetch(calls),
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token" }),
  });
  runtime.boot(null);
  await hirePm(runtime);
  const saved = runtime.snapshot();
  saved.office.messages.push({ id: "m-pending", from: "system", text: "PM 正在透過 Hermes 回覆…", delivery: "pending" });
  const restarted = createOfficeRuntime({
    templates,
    fetchImpl: async () => {
      throw new Error("should not call");
    },
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token" }),
  });
  const view = restarted.boot(saved);
  assert.match(view.office.messages.at(-1).text, /沒有自動重送/);
  assert.equal(view.office.messages.at(-1).delivery, "interrupted");
});

test("cancelling a live turn does not keep a successful reply", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/health") && !url.includes("/p/")) return json(200, { status: "ok" });
      if (url.endsWith("/v1/capabilities")) return json(200, {});
      if (url.includes("/p/__ho_probe__/health")) return json(404, { error: "Unknown or unconfigured profile" });
      if (url.endsWith("/api/profiles")) return json(201, { ok: true, name: "pm-lin" });
      if (url.endsWith("/api/sessions")) return json(201, {});
      if (url.endsWith("/chat/stream")) {
        return new Promise((_resolve, reject) => {
          release();
          init.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      throw new Error(url);
    },
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token" }),
  });
  runtime.boot(null);
  await hirePm(runtime);
  const pending = runtime.postMessage({ text: "@PM 等一下", clientMessageId: "cancel-1" });
  await gate;
  const pendingId = runtime.view().office.messages.find((message) => message.delivery === "pending").id;
  await runtime.cancel(pendingId);
  const done = await pending;
  assert.match(done.session.office.messages.at(-1).text, /已取消/);
  assert.equal(done.session.office.messages.some((message) => message.from === "PM" && message.delivery === "done"), false);
});
