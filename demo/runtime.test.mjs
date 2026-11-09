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
    if (url.endsWith("/api/env") && init.method === "PUT") return json(200, { ok: true, key: "API_SERVER_KEY" });
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
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit", group: { name: "HarnessOffice" } }),
  });
  runtime.boot(null);
  const hired = await hirePm(runtime);
  assert.equal(hired.profile.hermes.sessionId, "ho-pm-lin");
  const seated = visualSnapshot(hired.session);
  assert.equal(seated.roles.find((role) => role.role === "PM").name, "林可");
  assert.equal(seated.roles.find((role) => role.role === "PM").text, "");
  const replied = await runtime.postMessage({ text: "@PM 做一個像素 Office", clientMessageId: "live-1" });
  const last = replied.session.office.messages.at(-1);
  assert.equal(last.from, "PM");
  assert.equal(last.text, "我先把驗收條件列出來。");
  const shot = visualSnapshot(replied.session);
  assert.equal(shot.lines.at(-1).text, "我先把驗收條件列出來。");
  assert.equal(shot.lines.at(-1).name, "林可");
  assert.equal(shot.lines.some((line) => line.role === "你" && line.text.includes("@PM")), true);
  assert.equal(shot.roles.find((role) => role.role === "PM").text, "我先把驗收條件列出來。");
  const envWrite = calls.find((call) => call.url.endsWith("/api/env") && call.method === "PUT");
  const sessionOpen = calls.find((call) => call.url.endsWith("/api/sessions") && call.method === "POST");
  assert.ok(envWrite && sessionOpen);
  assert.ok(calls.indexOf(envWrite) < calls.indexOf(sessionOpen));
  const envBody = JSON.parse(envWrite.body);
  assert.equal(envBody.key, "API_SERVER_KEY");
  assert.equal(envBody.profile, "pm-lin");
  assert.equal(envBody.value, "desk-token");
  assert.equal(JSON.stringify(replied.session).includes("desk-token"), false);
  const stream = calls.filter((call) => call.url.endsWith("/chat/stream"));
  assert.equal(stream.length, 1);
  assert.equal(stream[0].url, "https://hermes.example/p/pm-lin/api/sessions/ho-pm-lin/chat/stream");

  const saved = runtime.snapshot();
  const againCalls = [];
  const restarted = createOfficeRuntime({
    templates,
    fetchImpl: liveFetch(againCalls, { profileStatus: 400, streamText: "第二則只出現一次。" }),
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit", group: { name: "HarnessOffice" } }),
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
      if (url.endsWith("/api/env")) return json(200, { ok: true, key: "API_SERVER_KEY" });
      throw new Error(url);
    },
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit" }),
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
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit" }),
  });
  runtime.boot(null);
  await hirePm(runtime);
  const saved = runtime.snapshot();
  saved.projects["harness-office"].office.messages.push({ id: "m-pending", from: "system", text: "PM 正在透過 Hermes 回覆…", delivery: "pending" });
  const restarted = createOfficeRuntime({
    templates,
    fetchImpl: async () => {
      throw new Error("should not call");
    },
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit" }),
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
      if (url.endsWith("/api/env")) return json(200, { ok: true, key: "API_SERVER_KEY" });
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
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit" }),
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

test("a live turn can be accepted before Hermes replies", async () => {
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
      if (url.endsWith("/api/env")) return json(200, { ok: true, key: "API_SERVER_KEY" });
      if (url.endsWith("/api/sessions")) return json(201, {});
      if (url.endsWith("/chat/stream")) {
        await gate;
        return sse("fixture：回覆還在路上。");
      }
      throw new Error(url);
    },
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit" }),
  });
  runtime.boot(null);
  await hirePm(runtime);
  const accepted = await runtime.postMessage({ text: "@PM fixture：先收下", wait: false });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.session.office.messages.at(-1).delivery, "pending");
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.view().office.messages.at(-1).text, "fixture：回覆還在路上。");
});

test("assigning a fixture issue does not invent a GitHub comment", async () => {
  const runtime = createOfficeRuntime({ templates });
  runtime.boot(null);
  await runtime.postMessage({ text: "@HR 請幫我 hire FE" });
  await runtime.hireCandidate("fe-wu");
  runtime.setGithubIssues([{ number: 12, title: "fixture：看板", url: "https://github.com/codingXiang/HarnessOffice/issues/12" }], "W/\"fixture\"");
  const assigned = await runtime.postMessage({ text: "@FE 看一下 #12" });
  assert.equal(Object.values(assigned.session.github.assignments).find((item) => item.number === 12).role, "FE");
  assert.match(assigned.session.office.messages.at(-1).text, /沒有寫 GitHub 草稿/);
  const shot = visualSnapshot(assigned.session);
  assert.equal(shot.roles.find((role) => role.role === "FE").text, "working on #12");
  assert.equal(shot.issues[0].number, 12);
});

test("a saved office becomes the default project, and another project hires its own bot", async () => {
  const calls = [];
  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: liveFetch(calls),
    loadSettings: () => ({ apiBase: "https://hermes.example", token: "desk-token", dashboardToken: "dash-explicit", group: { name: "HarnessOffice" } }),
    loadGithub: () => ({
      token: "",
      projects: [
        { id: "harness-office", name: "HarnessOffice", group: "主群", repos: [{ owner: "codingXiang", repo: "HarnessOffice", alias: "ho" }] },
        { id: "other", name: "另一個", group: "另一個群", repos: [{ owner: "codingXiang", repo: "Other", alias: "other" }] },
      ],
    }),
  });
  runtime.boot({
    office: {
      present: ["HR", "QA"],
      messages: [{ from: "QA", text: "fixture：原本的對話" }],
      pendingCandidates: null,
      issue: null,
      assignments: [],
      phase: "idle",
      mockPr: null,
    },
    bots: { QA: { profileName: "qa-he", sessionId: "ho-qa-he", route: "multiplex", displayName: "何驗" } },
    github: { issues: [{ number: 3, title: "keep" }], assignments: {} },
  });
  const kept = runtime.view();
  assert.equal(kept.projectId, "harness-office");
  assert.equal(kept.group, "主群");
  assert.ok(kept.office.present.includes("QA"));
  assert.match(kept.office.messages.at(-1).text, /原本的對話/);
  assert.equal(kept.bots.QA.profileName, "qa-he");
  assert.equal(kept.github.issues[0].number, 3);
  await runtime.postMessage({ text: "@HR 請幫我 hire FE", projectId: "other" });
  await runtime.hireCandidate("fe-wu", "other");
  assert.ok(runtime.view("other").office.present.includes("FE"));
  assert.equal(runtime.view("other").bots.FE.profileName, "other--fe-wu");
  assert.equal(runtime.view("harness-office").office.present.includes("FE"), false);
  runtime.setGithubIssues([{ number: 12, title: "fixture：乙", owner: "codingXiang", repo: "Other", alias: "other" }], "W/\"b\"", "codingXiang/Other");
  const paused = await runtime.postMessage({ text: "@FE 看一下 https://github.com/codingXiang/Other/issues/12", projectId: "harness-office", typing: true });
  assert.equal(paused.session.projectId, "harness-office");
  assert.equal(paused.session.switchOffer.projectId, "other");
  assert.equal(runtime.view("harness-office").notices[0].projectId, "other");
  const moved = await runtime.postMessage({ text: "@FE 看一下 codingXiang/Other#12", projectId: "harness-office" });
  assert.equal(moved.session.projectId, "other");
  assert.equal(Object.values(moved.session.github.assignments).find((item) => item.number === 12).role, "FE");
  assert.equal(runtime.view("harness-office").office.messages.some((message) => String(message.text).includes("codingXiang/Other")), false);
});
