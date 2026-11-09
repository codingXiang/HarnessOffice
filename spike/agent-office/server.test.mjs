import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { DEMO_STEPS } from "./demo.mjs";
import { createOffice } from "./office.mjs";
import { FLOOR_SPAWN, cacheControlFor, createSpikeServer, spikeBind, withOfficePanel } from "./server.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function connect(port) {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?name=Tester&color=%234f86f7&skin=1&hair=2&style=0`);
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  const opened = new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
  return { ws, messages, opened };
}

async function until(messages, pred) {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const found = messages.find(pred);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting among ${messages.map((m) => m.t).join(",")}`);
}

test("a Group Chat snapshot is spoken once and a reconnect does not repeat it", async () => {
  const server = createSpikeServer({ clientDist: null });
  const port = await listen(server);
  try {
    const body = {
      revision: 3,
      lines: [{ id: "m-pm", role: "PM", text: "我先把驗收條件列出來。", activity: "idle" }],
    };
    const first = await fetch(`http://127.0.0.1:${port}/api/spike/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`http://127.0.0.1:${port}/api/spike/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const repeated = await second.json();
    assert.equal(repeated.applied, 0);
    const client = connect(port);
    await client.opened;
    const welcome = await until(client.messages, (message) => message.t === "welcome");
    const copies = welcome.chat.filter((line) => line.text === "我先把驗收條件列出來。");
    assert.equal(copies.length, 1);
    client.ws.terminate();
  } finally {
    await close(server);
  }
});

test("a hired role with no reply of their own is still seated, and a later hire does not duplicate anyone", async () => {
  const qaText = "fixture：我是何驗，這句不是上游模型。";
  const hrText = "fixture：已 Hire 林可 擔任 PM。";
  const present = {
    revision: 4,
    lines: [
      { id: "m-hr", role: "HR", name: "HR", text: hrText, activity: "idle" },
      { id: "m-qa", role: "QA", name: "何驗", text: qaText, activity: "idle" },
    ],
    roles: [
      { role: "HR", name: "HR", text: hrText, activity: "idle" },
      { role: "QA", name: "何驗", text: qaText, activity: "idle" },
      { role: "PM", name: "林可", text: "", activity: "idle" },
    ],
  };
  const office = createOffice();
  office.applySession(present);
  const ids = [...office.workers.values()].map((worker) => worker.id).sort();
  assert.deepEqual(ids, ["role-hr", "role-pm", "role-qa"]);
  const pm = office.workers.get("role-pm");
  assert.equal(pm.deskId, "desk-2");
  assert.equal(pm.name, "林可");
  assert.equal(pm.task.name, "PM · 林可");
  assert.match(pm.task.summary, /還沒有回覆/);
  const qa = office.workers.get("role-qa");
  assert.equal(qa.deskId, "desk-6");
  assert.equal(qa.name, "何驗");
  assert.equal(qa.task.name, "QA · 何驗");
  assert.equal(qa.task.summary, qaText);
  assert.equal(office.welcome("p1", [], 4600).chat.filter((line) => line.text === qaText).length, 1);
  assert.equal(office.welcome("p1", [], 4600).chat.some((line) => line.text === pm.task.summary), false);
  assert.equal(office.welcome("p1", [], 4600).plan.labels["desk-2"].text, "PM");
  assert.equal(office.welcome("p1", [], 4600).plan.labels["desk-6"].text, "QA");
  const replay = office.applySession(present);
  assert.equal(replay.messages.length, 0);
  assert.equal(office.workers.size, 3);

  const growing = createOffice();
  growing.applySession({
    revision: 1,
    lines: [
      { id: "m-hr", role: "HR", name: "HR", text: hrText, activity: "idle" },
      { id: "m-qa", role: "QA", name: "何驗", text: qaText, activity: "idle" },
    ],
    roles: [
      { role: "HR", name: "HR", text: hrText, activity: "idle" },
      { role: "QA", name: "何驗", text: qaText, activity: "idle" },
    ],
  });
  assert.equal(growing.workers.size, 2);
  const added = growing.applySession(present);
  assert.equal(added.messages.some((message) => message.t === "worker.update" && message.worker.id === "role-pm"), true);
  assert.equal(growing.workers.size, 3);
  assert.equal(new Set([...growing.workers.keys()]).size, 3);
  assert.equal(growing.applySession(present).messages.length, 0);
  assert.equal(growing.welcome("p1", [], 4600).chat.filter((line) => line.text === qaText).length, 1);

  const server = createSpikeServer({ clientDist: null });
  const port = await listen(server);
  let client;
  try {
    const seated = await fetch(`http://127.0.0.1:${port}/api/spike/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(present),
    });
    assert.equal(seated.status, 200);
    await seated.json();
    client = connect(port);
    await client.opened;
    const welcome = await until(client.messages, (message) => message.t === "welcome");
    assert.deepEqual(welcome.workers.map((worker) => worker.id).slice().sort(), ["role-hr", "role-pm", "role-qa"]);
    assert.equal(welcome.floors[0].workers, 3);
    assert.equal(welcome.chat.filter((line) => line.text === qaText).length, 1);
    const again = await fetch(`http://127.0.0.1:${port}/api/spike/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(present),
    });
    assert.equal((await again.json()).applied, 0);
    client.ws.terminate();
    const reconnect = connect(port);
    try {
      await reconnect.opened;
      const back = await until(reconnect.messages, (message) => message.t === "welcome");
      assert.deepEqual(back.workers.map((worker) => worker.id).slice().sort(), ["role-hr", "role-pm", "role-qa"]);
      assert.equal(back.chat.filter((line) => line.text === qaText).length, 1);
    } finally {
      reconnect.ws.terminate();
    }
  } finally {
    client?.ws.terminate();
    await close(server);
  }
});

test("typing in the 3D chat is forwarded to Group Chat, and a failure is a visible toast", async () => {
  const calls = [];
  const forwarded = createSpikeServer({
    clientDist: null,
    chatUrl: "http://chat.example",
    chatFetch: async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      if (String(url).endsWith("/api/session/messages")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        revision: 1,
        lines: [{ id: "m-hint", role: "系統", text: "請用 @Role 指定一位已經在 Office 裡的 Hermes Bot。", activity: "idle" }],
        roles: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const port = await listen(forwarded);
  const client = connect(port);
  try {
    await client.opened;
    client.ws.send(JSON.stringify({ t: "chat", text: "你好" }));
    const line = await until(client.messages, (message) => message.t === "chat" && message.text.includes("請用 @Role"));
    assert.equal(line.text.includes("請用 @Role"), true);
    assert.equal(calls.some((call) => call.url === "http://chat.example/api/session/messages" && call.body.includes("你好")), true);
    const dropped = createSpikeServer({
      clientDist: null,
      chatFetch: async () => {
        throw new Error("should not call");
      },
    });
    const droppedPort = await listen(dropped);
    const other = connect(droppedPort);
    try {
      await other.opened;
      other.ws.send(JSON.stringify({ t: "chat", text: "沒有送出" }));
      const toast = await until(other.messages, (message) => message.t === "toast");
      assert.match(toast.text, /沒有送出/);
    } finally {
      other.ws.terminate();
      await close(dropped);
    }
  } finally {
    client.ws.terminate();
    await close(forwarded);
  }
});

test("the office page is the chat client and does not return a Hermes secret", async () => {
  assert.match(withOfficePanel("<html><body></body></html>"), /office-panel\.js/);
  const panel = fs.readFileSync(new URL("./panel/office-panel.js", import.meta.url), "utf8");
  assert.match(panel, /event\.key !== "Enter"/);
  assert.match(panel, /送出中…/);
  assert.match(panel, /沒有在時間內送出。文字還在，可以再試一次。/);
  assert.match(panel, /尚未寫入伺服器/);
  assert.match(panel, /再試一次/);
  assert.match(panel, /roleChoices/);
  assert.match(panel, /function withTimeout/);
  assert.match(panel, /\/api\/office\/build/);
  assert.match(withOfficePanel("<html><body></body></html>", "abc123"), /name="ho-build" content="abc123"/);
  assert.equal(cacheControlFor("/index.html"), "no-store");
  assert.equal(cacheControlFor("/office-panel.js"), "no-store");
  assert.match(cacheControlFor("/assets/main-abc.js"), /immutable/);
  assert.equal(panel.includes("告訴我 Role"), false);
  const loop = fs.readFileSync(new URL("../../vendor/agent-office/src/client/core/loop.ts", import.meta.url), "utf8");
  const scene = fs.readFileSync(new URL("../../vendor/agent-office/src/client/core/scene.ts", import.meta.url), "utf8");
  assert.match(loop, /player\.view === 'spectator' && f\.now - lastSpectatorDraw < 100/);
  assert.match(scene, /setPixelRatio\(1\)/);
  assert.equal(panel.includes("localStorage"), false);
  const calls = [];
  const server = createSpikeServer({
    clientDist: null,
    chatUrl: "http://chat.example",
    chatFetch: async (url, init) => {
      calls.push({ url: String(url), body: init?.body });
      if (String(url).endsWith("/api/hermes")) {
        return new Response(JSON.stringify({ configured: true, token: "desk-token", tokenSet: true, apiBase: "https://hermes.example" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith("/api/session/visual")) {
        return new Response(JSON.stringify({ revision: 2, lines: [{ id: "m-hint", role: "系統", text: "fixture：請用 @Role。", activity: "idle" }], roles: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        office: {
          present: ["HR", "QA"],
          messages: [
            { id: "m1", from: "human", text: "fixture：你好", delivery: "done" },
            { id: "m2", from: "system", text: "請用 @Role 指定一位已經在 Office 裡的 Hermes Bot。", delivery: "done" },
          ],
        },
        runtime: { state: "mock" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const port = await listen(server);
  try {
    const said = await fetch(`http://127.0.0.1:${port}/api/office/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "fixture：你好" }),
    });
    const saidBody = await said.json();
    assert.equal(said.status, 200);
    assert.equal(saidBody.office.messages[0].text, "fixture：你好");
    assert.equal(calls.some((call) => call.url.includes("/api/session/messages") && call.body.includes("fixture：你好")), true);
    const settings = await fetch(`http://127.0.0.1:${port}/api/office/hermes`);
    const settingsText = await settings.text();
    assert.equal(settings.status, 200);
    assert.equal(settingsText.includes("desk-token"), false);
    assert.match(settingsText, /tokenSet/);
    const scriptResponse = await fetch(`http://127.0.0.1:${port}/office-panel.js`);
    assert.equal(scriptResponse.headers.get("cache-control"), "no-store");
    const script = await scriptResponse.text();
    assert.match(script, /\/api\/office\/hire/);
    const build = await fetch(`http://127.0.0.1:${port}/api/office/build`);
    assert.equal(build.headers.get("cache-control"), "no-store");
    assert.ok((await build.json()).id);
  } finally {
    await close(server);
  }

  const bare = createSpikeServer({ clientDist: null });
  const barePort = await listen(bare);
  try {
    const missing = await fetch(`http://127.0.0.1:${barePort}/api/office/session`);
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).message, /沒有接到 Group Chat/);
  } finally {
    await close(bare);
  }
});

test("the office page is not cached and a hashed asset is", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-office-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body>office</body></html>");
  fs.writeFileSync(path.join(dir, "assets", "main-abc.js"), "console.log(1)");
  const server = createSpikeServer({ clientDist: dir });
  const port = await listen(server);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(await page.text(), /office-panel\.js/);
    const asset = await fetch(`http://127.0.0.1:${port}/assets/main-abc.js`);
    assert.match(asset.headers.get("cache-control"), /immutable/);
  } finally {
    await close(server);
  }
});

test("spike listens on 0.0.0.0 unless HOST is set", () => {
  assert.equal(spikeBind({}).host, "0.0.0.0");
  assert.equal(spikeBind({}).port, 4600);
  assert.equal(spikeBind({ HOST: "127.0.0.1", PORT: "4610" }).host, "127.0.0.1");
  assert.equal(spikeBind({ PORT: "4610" }).port, 4610);
});

test("whoami succeeds and the demo seats HR then PM through idle, waiting, coding, and a merged PR", async () => {
  const server = createSpikeServer({ clientDist: null });
  const port = await listen(server);
  const client = connect(port);
  await client.opened;
  try {
    const who = await fetch(`http://127.0.0.1:${port}/api/whoami`);
    assert.equal(who.status, 200);
    assert.deepEqual(await who.json(), { ok: true, me: { admin: false } });

    const welcome = await until(client.messages, (m) => m.t === "welcome");
    assert.equal(welcome.floor, "harness");
    assert.equal(welcome.map.pick, "office");
    assert.equal(welcome.upgrade.phase, "idle");
    assert.equal(welcome.me.admin, false);
    assert.ok(Array.isArray(welcome.workers));
    assert.ok(Array.isArray(welcome.machine.history));
    assert.equal(typeof welcome.usage.total.calls, "number");
    assert.equal(typeof welcome.usage.today.calls, "number");
    assert.ok(welcome.jukebox.track);
    assert.ok(Array.isArray(welcome.whiteboard.elements));
    assert.ok(Array.isArray(welcome.cabinet.scores));
    assert.equal(welcome.meeting.current, null);
    assert.ok(welcome.services.items);
    assert.equal(welcome.theme.active, null);
    assert.equal(welcome.you, welcome.peers[0].id);
    assert.equal(welcome.peers[0].floor, "harness");
    assert.equal(welcome.floor, "harness");
    // Guests start on the floor south of the HR/PM pod, not in the elevator car (about z −13..−10.7).
    assert.deepEqual(
      { x: welcome.peers[0].x, y: welcome.peers[0].y, z: welcome.peers[0].z, rotY: welcome.peers[0].rotY },
      FLOOR_SPAWN,
    );
    assert.ok(welcome.peers[0].z > -10);

    client.ws.send(JSON.stringify({ t: "ping", at: 42 }));
    const pong = await until(client.messages, (m) => m.t === "pong");
    assert.equal(pong.at, 42);
    assert.equal(typeof pong.now, "number");

    for (const step of DEMO_STEPS) {
      const res = await fetch(`http://127.0.0.1:${port}/api/spike/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(step),
      });
      assert.equal(res.status, 200, step.role + step.phase);
    }

    const updates = client.messages.filter((m) => m.t === "worker.update").map((m) => m.worker);
    assert.deepEqual(
      updates.map((w) => [w.name, w.status, w.action ?? null, w.deskId]),
      [
        ["HR", "idle", null, "desk-1"],
        ["PM", "idle", null, "desk-2"],
        ["HR", "needs_input", null, "desk-1"],
        ["PM", "working", "edit", "desk-2"],
        ["PM", "done", null, "desk-2"],
      ],
    );
    assert.equal(updates[0].task.summary.includes("我是 HR，開場就在"), true);
    assert.equal(updates[1].task.summary.includes("Issue 草稿"), true);
    assert.equal(client.messages.some((m) => m.t === "chat" && m.name === "HR" && m.text.includes("我是 HR")), true);
    assert.equal(updates[2].acked, false);
    assert.equal(updates[4].pr.number, 102);
    assert.equal(updates[4].pr.url.includes("/pull/102"), true);

    const pulls = client.messages.find((m) => m.t === "gh.pulls");
    assert.equal(pulls.state.items[0].state, "MERGED");
    assert.equal(pulls.state.items[0].number, 102);
    const gong = client.messages.find((m) => m.t === "gong");
    assert.deepEqual({ why: gong.why, pr: gong.pr }, { why: "merged", pr: 102 });

    const unknown = await fetch(`http://127.0.0.1:${port}/api/spike/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "FE", phase: "appear" }),
    });
    assert.equal(unknown.status, 400);

    const said = await fetch(`http://127.0.0.1:${port}/api/spike/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "Tech Lead", text: "Issue 還沒核准。我不會分派，也不會開始寫程式。" }),
    });
    assert.equal(said.status, 200);
    const saidBody = await said.json();
    assert.equal(saidBody.worker.deskId, "desk-3");
    assert.equal(saidBody.worker.task.summary.includes("不會分派"), true);
    const spoken = await until(client.messages, (m) => m.t === "worker.update" && m.worker.name === "Tech Lead");
    assert.equal(spoken.worker.task.summary.includes("不會分派"), true);

    const hint = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(hint.status, 200);
    assert.match(await hint.text(), /spike:office:client/);
  } finally {
    client.ws.terminate();
    await close(server);
  }
});
