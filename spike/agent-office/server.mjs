import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { FLOOR_ID, createOffice } from "./office.mjs";

const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(spikeRoot, "../..");
const defaultClientDist = path.join(repoRoot, "vendor/agent-office/dist/public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

const BUILD_HINT = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>HarnessOffice 3D spike</title></head>
  <body>
    <h1>HarnessOffice 3D spike</h1>
    <p>The vendored agent-office client is not built yet. From the repo root:</p>
    <pre>npm run spike:office:client
npm run spike:office</pre>
    <p>The mock WebSocket is already up at <code>/ws</code>. PixelOffice mock mode is a different server (<code>npm start</code>).</p>
  </body>
</html>`;

export function spikeBind(env = process.env) {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 4600),
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, body, type) {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function peerFrom(url, id) {
  const color = url.searchParams.get("color") ?? "";
  const num = (key, max) => {
    const n = Number(url.searchParams.get(key));
    return Number.isInteger(n) && n >= 0 && n <= max ? n : 0;
  };
  const named = (url.searchParams.get("name") ?? "").trim().slice(0, 24);
  const back = url.searchParams.get("floor") === FLOOR_ID && url.searchParams.get("x");
  const coord = (key, fallback) => {
    const n = Number(url.searchParams.get(key));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    id,
    name: named || `Guest ${id.slice(0, 3)}`,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#4f86f7",
    look: { skin: num("skin", 7), hair: num("hair", 9), style: num("style", 6) },
    x: back ? coord("x", 8.5) : 8.5,
    y: back ? coord("y", 0) : 0,
    z: back ? coord("z", -11.87) : -11.87,
    rotY: back ? coord("rotY", 0) : 0,
    moving: false,
    voice: false,
    muted: true,
    sharing: false,
    floor: FLOOR_ID,
  };
}

function listenPort(server) {
  const address = server.address();
  return address && typeof address === "object" ? address.port : 4600;
}

export function createSpikeServer({ clientDist = defaultClientDist, office = createOffice() } = {}) {
  const peers = new Map();
  const sockets = new Set();
  let seq = 0;

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg, except) {
    for (const ws of sockets) if (ws !== except) send(ws, msg);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/whoami") {
        sendJson(res, 200, { ok: true, me: { admin: false } });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/login") {
        sendJson(res, 200, { accounts: false, shared: true });
        return;
      }
      if (req.method === "POST" && (url.pathname === "/api/login" || url.pathname === "/api/logout")) {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/spike/state") {
        sendJson(res, 200, office.snapshot());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/spike/roles") {
        const body = await readJson(req);
        const result = office.upsert(body.role, body.phase);
        if (result.error) {
          sendJson(res, 400, { error: result.error });
          return;
        }
        for (const msg of result.messages) broadcast(msg);
        sendJson(res, 200, { worker: result.worker, phase: result.phase });
        return;
      }

      if (!clientDist || !fs.existsSync(clientDist)) {
        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          sendText(res, 200, BUILD_HINT, "text/html; charset=utf-8");
          return;
        }
        sendJson(res, 404, { error: "client-not-built" });
        return;
      }

      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const target = path.resolve(clientDist, `.${pathname}`);
      const root = path.resolve(clientDist);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        sendJson(res, 404, { error: "not-found" });
        return;
      }
      const body = fs.readFileSync(target);
      res.writeHead(200, {
        "content-type": MIME[path.extname(target)] ?? "application/octet-stream",
        "content-length": body.length,
      });
      res.end(body);
    } catch {
      sendJson(res, 400, { error: "bad-request" });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const id = `p${(seq += 1).toString(16)}`;
      const peer = peerFrom(url, id);
      peers.set(id, peer);
      sockets.add(ws);
      ws.on("close", () => {
        sockets.delete(ws);
        peers.delete(id);
        broadcast({ t: "peer.leave", id });
      });
      ws.on("error", () => ws.terminate());
      send(ws, office.welcome(id, [...peers.values()], listenPort(server)));
      broadcast({ t: "peer.join", peer }, ws);
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.t === "ping") {
          send(ws, { t: "pong", at: msg.at, now: Date.now() });
          return;
        }
        if (msg.t === "move") {
          Object.assign(peer, {
            x: Number(msg.x) || 0,
            y: Number(msg.y) || 0,
            z: Number(msg.z) || 0,
            rotY: Number(msg.rotY) || 0,
            moving: !!msg.moving,
          });
          broadcast({ t: "peer.move", id, x: peer.x, y: peer.y, z: peer.z, rotY: peer.rotY, moving: peer.moving }, ws);
          return;
        }
        if (msg.t === "floor.go") {
          send(ws, { t: "floor.enter", peers: [...peers.values()], ...office.floorView(listenPort(server)) });
          if (msg.floor && msg.floor !== FLOOR_ID) {
            send(ws, { t: "toast", text: "This spike has one floor.", level: "info" });
          }
          return;
        }
        if (msg.t === "worker.spawn" || msg.t === "worker.prompt" || msg.t === "worker.pr") {
          send(ws, {
            t: "toast",
            text: "This spike does not start agents. POST /api/spike/roles to move HR and PM.",
            level: "info",
          });
        }
      });
    });
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { host, port } = spikeBind();
  const server = createSpikeServer();
  server.listen(port, host, () => {
    const built = fs.existsSync(defaultClientDist);
    console.log(`HarnessOffice 3D spike http://${host}:${port}`);
    console.log(built ? `client: ${defaultClientDist}` : "client not built — npm run spike:office:client");
    console.log("mock /ws is up. npm run spike:office:demo upserts HR then PM.");
  });
}
