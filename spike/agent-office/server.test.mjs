import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { DEMO_STEPS } from "./demo.mjs";
import { FLOOR_SPAWN, createSpikeServer, spikeBind } from "./server.mjs";

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
