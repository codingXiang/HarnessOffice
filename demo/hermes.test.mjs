import assert from "node:assert/strict";
import test from "node:test";
import { hireWithHermes } from "./hermes.mjs";

const fe = {
  role: "FE",
  runtime: "hermes",
  displayName: null,
  openCode: false,
  groupChat: "shared",
  responsibilities: ["負責畫面"],
};

const hireInput = {
  role: "FE",
  candidateId: "fe-wu",
  displayName: "吳像素",
  template: fe,
};

test("Hire without Hermes settings stays Mock and does not call the network", async () => {
  const calls = [];
  const result = await hireWithHermes({
    ...hireInput,
    settings: {},
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      throw new Error("network should not be called");
    },
  });

  assert.equal(calls.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "mock");
  assert.equal(result.reason, "unconfigured");
  assert.equal(result.profile.createdBy, "mock-hermes");
  assert.equal(result.profile.displayName, "吳像素");
  assert.equal(result.profile.runtime, "hermes");
  assert.equal(result.profile.openCode, false);
  assert.equal(Object.hasOwn(result.profile, "hermes"), false);
});

test("Hire with settings posts a profile-create body to the configured endpoint", async () => {
  const calls = [];
  const settings = {
    endpoint: "https://hermes.example/api/profiles",
    token: "desk-token",
    bot: { cloneFrom: "default", provider: "openrouter", model: "anthropic/claude-sonnet-4" },
    group: { name: "HarnessOffice", roomId: "room-7" },
  };
  const result = await hireWithHermes({
    ...hireInput,
    settings,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      if (init.method === "GET") return new Response("", { status: 405 });
      return new Response(JSON.stringify({ ok: true, name: "fe-wu", path: "/profiles/fe-wu" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "live");
  assert.equal(result.reason, "created");
  assert.equal(result.profile.createdBy, "hermes");
  assert.equal(result.profile.hermes.name, "fe-wu");
  assert.deepEqual(result.profile.hermesGroup, { name: "HarnessOffice", roomId: "room-7" });
  assert.equal(JSON.stringify(result.profile).includes("desk-token"), false);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://hermes.example/api/profiles");
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].url, "https://hermes.example/api/profiles");
  assert.equal(calls[1].headers.authorization, "Bearer desk-token");
  assert.equal(calls[1].headers["x-hermes-session-token"], "desk-token");
  assert.deepEqual(JSON.parse(calls[1].body), {
    name: "fe-wu",
    description: "FE：吳像素。負責畫面",
    clone_from: "default",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
  });
});

test("Hire falls back to Mock when the configured endpoint does not answer", async () => {
  const calls = [];
  const result = await hireWithHermes({
    ...hireInput,
    settings: {
      endpoint: "https://hermes.example/api/profiles",
      token: "desk-token",
      group: { name: "HarnessOffice", roomId: "" },
    },
    fetchImpl: async (url, init) => {
      calls.push(init.method);
      throw new TypeError("fetch failed");
    },
  });

  assert.deepEqual(calls, ["GET"]);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "mock");
  assert.equal(result.reason, "unreachable");
  assert.equal(result.profile.createdBy, "mock-hermes");
  assert.deepEqual(result.profile.hermesGroup, { name: "HarnessOffice", roomId: "" });
  assert.equal(Object.hasOwn(result.profile, "hermes"), false);
});

test("Hire does not pretend success when Hermes answers and refuses the Bot", async () => {
  const result = await hireWithHermes({
    ...hireInput,
    settings: { endpoint: "https://hermes.example/api/profiles", bot: { model: "local" } },
    fetchImpl: async (_url, init) => {
      if (init.method === "GET") return new Response("", { status: 200 });
      return new Response(JSON.stringify({ detail: "name taken" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "rejected");
  assert.equal(result.status, 400);
  assert.equal(result.profile, undefined);
});
