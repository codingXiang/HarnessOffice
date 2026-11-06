import assert from "node:assert/strict";
import test from "node:test";
import { hireWithHermes, redactSecrets, streamBotTurn } from "./hermes.mjs";

const fe = {
  role: "FE",
  runtime: "hermes",
  displayName: null,
  openCode: false,
  groupChat: "shared",
  responsibilities: ["負責畫面"],
};

const settings = {
  apiBase: "https://hermes.example",
  token: "desk-token",
  bot: { cloneFrom: "default", provider: "openrouter", model: "local" },
  group: { name: "HarnessOffice" },
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Hire without Hermes settings stays Mock and does not call the network", async () => {
  const calls = [];
  const result = await hireWithHermes({
    role: "FE",
    candidateId: "fe-wu",
    displayName: "吳像素",
    template: fe,
    settings: {},
    fetchImpl: async () => {
      calls.push("network");
      throw new Error("network should not be called");
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(result.mode, "mock");
  assert.equal(result.reason, "unconfigured");
  assert.equal(result.profile.createdBy, "mock-hermes");
});

test("a live Hire creates the profile and a stable session on that profile", async () => {
  const calls = [];
  const result = await hireWithHermes({
    role: "FE",
    candidateId: "fe-wu",
    displayName: "吳像素",
    template: fe,
    settings,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, authorization: init.headers?.authorization });
      if (url.endsWith("/health") && !url.includes("/p/")) return json(200, { status: "ok", platform: "hermes-agent" });
      if (url.endsWith("/v1/capabilities")) return json(200, { features: { session_chat_streaming: true } });
      if (url.includes("/p/__ho_probe__/health")) return json(404, { error: "Unknown or unconfigured profile" });
      if (url.endsWith("/api/profiles")) return json(201, { ok: true, name: "fe-wu" });
      if (url.endsWith("/api/sessions")) return json(201, { object: "hermes.session", session: { id: "ho-fe-wu" } });
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "live");
  assert.equal(result.reason, "created");
  assert.equal(result.profile.createdBy, "hermes");
  assert.equal(result.profile.hermes.name, "fe-wu");
  assert.equal(result.profile.hermes.sessionId, "ho-fe-wu");
  assert.equal(result.profile.hermes.route, "multiplex");
  assert.equal(result.profile.hermesGroup.name, "HarnessOffice");
  assert.equal(JSON.stringify(result.profile).includes("desk-token"), false);
  const profileCall = calls.find((call) => call.url.endsWith("/api/profiles"));
  assert.equal(profileCall.method, "POST");
  assert.equal(profileCall.url, "https://hermes.example/api/profiles");
  assert.deepEqual(JSON.parse(profileCall.body), {
    name: "fe-wu",
    description: "FE：吳像素。負責畫面",
    clone_from: "default",
    provider: "openrouter",
    model: "local",
  });
  const sessionCall = calls.find((call) => call.url.endsWith("/api/sessions"));
  assert.equal(sessionCall.url, "https://hermes.example/p/fe-wu/api/sessions");
  assert.equal(sessionCall.authorization, "Bearer desk-token");
  assert.equal(JSON.parse(sessionCall.body).id, "ho-fe-wu");
  assert.equal(JSON.parse(sessionCall.body).title, "Group: HarnessOffice");
});

test("an auth failure is not a Mock hire", async () => {
  const calls = [];
  const result = await hireWithHermes({
    role: "FE",
    candidateId: "fe-wu",
    displayName: "吳像素",
    template: fe,
    settings,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      return json(401, { error: { message: "bad key desk-token" } });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "auth");
  assert.equal(result.profile, undefined);
  assert.equal(calls.some((url) => url.endsWith("/api/profiles")), false);
});

test("a stream turn returns the assistant text and surfaces a tool as activity", async () => {
  const events = [];
  const sse = [
    "event: tool.started",
    'data: {"tool_name":"web_search"}',
    "",
    "event: assistant.completed",
    'data: {"content":"驗收條件要先寫下來。","completed":true}',
    "",
    "event: run.completed",
    'data: {"completed":true}',
    "",
  ].join("\n");
  const result = await streamBotTurn({
    settings,
    profileName: "fe-wu",
    sessionId: "ho-fe-wu",
    input: "@FE 畫面呢",
    instructions: "你是 FE",
    onEvent: (event) => events.push(event),
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://hermes.example/p/fe-wu/api/sessions/ho-fe-wu/chat/stream");
      assert.equal(JSON.parse(init.body).input, "@FE 畫面呢");
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "驗收條件要先寫下來。");
  assert.equal(events.some((event) => event.type === "tool" && event.name === "web_search"), true);
});

test("a malformed stream is not treated as a reply", async () => {
  const result = await streamBotTurn({
    settings,
    profileName: "fe-wu",
    sessionId: "ho-fe-wu",
    input: "你好",
    instructions: "你是 FE",
    fetchImpl: async () => new Response("event: assistant.completed\ndata: not-json\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed");
});

test("cancelling the turn does not become a successful reply", async () => {
  const controller = new AbortController();
  const pending = streamBotTurn({
    settings,
    profileName: "fe-wu",
    sessionId: "ho-fe-wu",
    input: "你好",
    instructions: "你是 FE",
    signal: controller.signal,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cancelled");
});

test("secrets are redacted before an error is shown", () => {
  assert.equal(redactSecrets("bad key desk-token", settings).includes("desk-token"), false);
  assert.match(redactSecrets("Authorization: Bearer desk-token", settings), /\[redacted\]/);
});
