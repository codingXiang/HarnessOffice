import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveIacDir, writeProfile } from "./iac.mjs";
import { isAgentEvent } from "./pixel-office-events.mjs";
import { createPixelOfficeForwarder } from "./pixel-office-forward.mjs";

const demoRoot = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function demoBind(env = process.env) {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 4173),
  };
}

export function loadTemplates(dir) {
  const templates = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    templates[data.role] = data;
  }
  return templates;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendFile(res, file) {
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "content-length": body.length,
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

export function createServer({
  root = demoRoot,
  iac = resolveIacDir({ cwd: root }),
  pixelOffice = createPixelOfficeForwarder(),
} = {}) {
  const templates = loadTemplates(path.join(root, "templates"));
  const publicDir = path.join(root, "public");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/iac") {
        sendJson(res, 200, { dir: iac.dir, fallback: iac.fallback });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/templates/")) {
        const name = path.basename(url.pathname);
        const file = path.join(root, "templates", name);
        if (!name.endsWith(".json") || !fs.existsSync(file)) {
          sendJson(res, 404, { error: "not-found" });
          return;
        }
        sendFile(res, file);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/hires") {
        const body = await readJson(req);
        const template = templates[body.role];
        if (!template || template.role === "HR" || template.runtime !== "hermes" || template.openCode !== false) {
          sendJson(res, 400, { error: "unknown-role" });
          return;
        }
        if (!body.candidateId || !body.displayName) {
          sendJson(res, 400, { error: "missing-candidate" });
          return;
        }
        const profile = {
          ...structuredClone(template),
          displayName: body.displayName,
          candidateId: body.candidateId,
          createdBy: "mock-hermes",
        };
        const file = writeProfile(iac.dir, profile);
        sendJson(res, 201, { file, profile, iacDir: iac.dir, fallback: iac.fallback });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/pixel-office/events") {
        const body = await readJson(req);
        const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
        const results = [];
        for (const event of events) {
          if (!isAgentEvent(event)) {
            results.push({ ok: false });
            continue;
          }
          results.push({ ok: true, ...(await pixelOffice.send(event)) });
        }
        sendJson(res, 200, { results });
        return;
      }

      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      if (pathname === "/office.mjs") {
        sendFile(res, path.join(root, "office.mjs"));
        return;
      }
      if (pathname === "/pixel-office-events.mjs") {
        sendFile(res, path.join(root, "pixel-office-events.mjs"));
        return;
      }
      const target = path.resolve(publicDir, `.${pathname}`);
      if (!target.startsWith(`${publicDir}${path.sep}`) && target !== publicDir) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        sendJson(res, 404, { error: "not-found" });
        return;
      }
      sendFile(res, target);
    } catch {
      sendJson(res, 400, { error: "bad-request" });
    }
  });
  server.on("close", () => pixelOffice.close?.());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const iac = resolveIacDir({ cwd: demoRoot });
  const { host, port } = demoBind();
  const server = createServer({ iac });
  server.listen(port, host, () => {
    console.log(`HarnessOffice chat (Mock mode) http://${host}:${port}`);
    console.log("PixelOffice events: HTTP http://127.0.0.1:3003/api/events and UDP 127.0.0.1:9997");
    console.log(`IaC store: ${iac.dir}${iac.fallback ? " (fallback)" : ""}`);
  });
}
