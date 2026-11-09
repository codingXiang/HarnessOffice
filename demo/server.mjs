import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isConfigured, probeHermes, hireWithHermes, redactSecrets } from "./hermes.mjs";
import { enabledRepos, fetchIssues, loadGithubSettings, publicGithubSettings, resolveGithubFile, saveGithubSettings, testGithubConnection } from "./github.mjs";
import { loadHermesSettings, publicHermesSettings, resolveHermesSettingsFile, saveHermesSettings } from "./hermes-settings.mjs";
import { resolveIacDir, writeProfile } from "./iac.mjs";
import { isAgentEvent } from "./pixel-office-events.mjs";
import { createPixelOfficeForwarder } from "./pixel-office-forward.mjs";
import { createOfficeRuntime, visualSnapshot } from "./runtime.mjs";

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

function sessionPathFor(hermesFile, sessionFile) {
  if (sessionFile) return sessionFile;
  if (!hermesFile) return null;
  return path.join(path.dirname(hermesFile), "session.json");
}

function readSession(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeSession(file, record) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`);
  fs.renameSync(tmp, file);
}

export function createServer({
  root = demoRoot,
  iac = resolveIacDir({ cwd: root }),
  pixelOffice = createPixelOfficeForwarder(),
  hermesFile = null,
  hermesFetch = globalThis.fetch,
  githubFile = null,
  githubFetch = globalThis.fetch,
  sessionFile = null,
  visualSink = null,
} = {}) {
  const templates = loadTemplates(path.join(root, "templates"));
  const publicDir = path.join(root, "public");
  const storedSession = sessionPathFor(hermesFile, sessionFile);
  const listeners = new Set();

  function broadcast(sessionView) {
    const payload = `data: ${JSON.stringify(sessionView)}\n\n`;
    for (const res of listeners) {
      try {
        res.write(payload);
      } catch {
        listeners.delete(res);
      }
    }
  }

  async function pushVisual(sessionView) {
    if (!visualSink) return;
    try {
      await visualSink(visualSnapshot(sessionView));
    } catch {
      // The 3D page is optional. A missing spike does not change the chat.
    }
  }

  const runtime = createOfficeRuntime({
    templates,
    fetchImpl: hermesFetch,
    loadGithub: () => loadGithubSettings(githubFile),
    loadSettings: () => {
      try {
        return loadHermesSettings(hermesFile);
      } catch {
        return { apiBase: "" };
      }
    },
    onChange(sessionView) {
      writeSession(storedSession, runtime.snapshot());
      broadcast(sessionView);
      pushVisual(sessionView);
    },
  });
  try {
    runtime.boot(readSession(storedSession));
  } catch {
    runtime.boot(null);
  }

  function loadHermes(res) {
    try {
      return loadHermesSettings(hermesFile);
    } catch (error) {
      if (error.code === "unreadable") {
        sendJson(res, 500, { error: "unreadable", message: "Hermes 設定檔讀不到。這次沒有 Hire。" });
        return null;
      }
      throw error;
    }
  }

  let lastGithubPoll = 0;
  let githubCursor = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/iac") {
        sendJson(res, 200, { dir: iac.dir, fallback: iac.fallback });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/hermes") {
        const settings = loadHermes(res);
        if (!settings) return;
        sendJson(res, 200, publicHermesSettings(settings, hermesFile ? { file: hermesFile } : {}));
        return;
      }
      if (req.method === "PUT" && url.pathname === "/api/hermes") {
        if (!hermesFile) {
          sendJson(res, 400, { error: "no-settings-file", message: "這台 demo 沒有 Hermes 設定檔可寫。Hire 維持 Mock mode。" });
          return;
        }
        const body = await readJson(req);
        try {
          const saved = saveHermesSettings(hermesFile, body);
          sendJson(res, 200, publicHermesSettings(saved, { file: hermesFile }));
        } catch (error) {
          if (error.code === "bad-endpoint") {
            sendJson(res, 400, {
              error: "bad-endpoint",
              message: "endpoint 必須是 http 或 https 網址，或留空以使用 Mock mode。",
            });
            return;
          }
          if (error.code === "unreadable") {
            sendJson(res, 500, { error: "unreadable", message: "Hermes 設定檔讀不到。這次沒有改設定。" });
            return;
          }
          throw error;
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/hermes/probe") {
        const settings = loadHermes(res);
        if (!settings) return;
        if (!isConfigured(settings)) {
          sendJson(res, 200, { configured: false, reachable: false, mode: "mock" });
          return;
        }
        const probe = await probeHermes(settings, hermesFetch);
        sendJson(res, 200, {
          configured: true,
          reachable: probe.reachable,
          state: probe.state,
          multiplex: probe.multiplex,
          mode: probe.state === "live" ? "reachable" : probe.state === "offline" ? "mock" : probe.state,
          status: probe.status ?? null,
        });
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
        const settings = loadHermes(res);
        if (!settings) return;
        const outcome = await hireWithHermes({
          settings,
          role: body.role,
          candidateId: body.candidateId,
          displayName: body.displayName,
          template,
          fetchImpl: hermesFetch,
        });
        if (!outcome.ok) {
          const auth = outcome.reason === "auth";
          sendJson(res, auth ? 401 : 502, {
            error: auth ? "hermes-auth" : "hermes-rejected",
            message: auth
              ? redactSecrets(outcome.detail || "Hermes 拒絕了憑證。這次沒有 Hire，也沒有改用 Mock 成功。", settings)
              : `Hermes 沒有建立 Bot。這次沒有 Hire。${outcome.detail ? ` ${redactSecrets(outcome.detail, settings)}` : ""}`,
            status: outcome.status ?? null,
          });
          return;
        }
        const file = writeProfile(iac.dir, outcome.profile);
        sendJson(res, 201, {
          file,
          profile: outcome.profile,
          iacDir: iac.dir,
          fallback: iac.fallback,
          mode: outcome.mode,
          reason: outcome.reason,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session") {
        const requested = url.searchParams.get("project");
        if (requested) runtime.setActiveProject(requested);
        sendJson(res, 200, runtime.view(requested || undefined));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session/visual") {
        sendJson(res, 200, visualSnapshot(runtime.view()));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/session/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify(runtime.view())}\n\n`);
        listeners.add(res);
        req.on("close", () => listeners.delete(res));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/messages") {
        const body = await readJson(req);
        const result = await runtime.postMessage({
          text: body.text,
          clientMessageId: body.clientMessageId,
          wait: url.searchParams.get("wait") !== "0",
          projectId: body.projectId || url.searchParams.get("project") || undefined,
          typing: body.typing === true,
        });
        if (result.profile) writeProfile(iac.dir, result.profile);
        const lastHuman = [...(result.session?.office?.messages ?? [])].reverse().find((message) => message.from === "human");
        console.log(`session message ${result.duplicate ? "duplicate" : lastHuman?.id ?? "none"} addressed=${lastHuman?.addressed ?? "none"}`);
        sendJson(res, result.ok ? 200 : result.status ?? 400, result.session ?? { error: "bad-request" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/github") {
        sendJson(res, 200, publicGithubSettings(loadGithubSettings(githubFile)));
        return;
      }
      if (req.method === "PUT" && url.pathname === "/api/github") {
        const body = await readJson(req);
        if (!githubFile) {
          sendJson(res, 500, { message: "GitHub 設定檔沒有位置。" });
          return;
        }
        const saved = saveGithubSettings(githubFile, body);
        runtime.syncProjects(saved.projects, { remove: true });
        sendJson(res, 200, saved);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/github/test") {
        const body = await readJson(req);
        const settings = loadGithubSettings(githubFile);
        const repos = enabledRepos(settings);
        const repo = repos.find((item) => item.id === body.projectId || item.id === body.repoId || `${item.owner}/${item.repo}` === body.projectId) || repos[0];
        const result = await testGithubConnection({
          owner: repo?.owner,
          repo: repo?.repo,
          token: repo?.token || settings.token,
          projects: repo ? [{ id: repo.officeProjectId, name: repo.officeProjectId, group: repo.officeProjectId, repos: [repo] }] : [],
        }, githubFetch);
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/github/active") {
        const body = await readJson(req);
        sendJson(res, 200, runtime.setActiveProject(body.projectId, body.role));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/github/refresh") {
        const settings = loadGithubSettings(githubFile);
        const enabled = enabledRepos(settings);
        if (!url.searchParams.has("manual") && Date.now() - lastGithubPoll < settings.pollSeconds * 1000) {
          sendJson(res, 200, runtime.view(url.searchParams.get("project") || undefined));
          return;
        }
        lastGithubPoll = Date.now();
        const batch = url.searchParams.has("manual") ? enabled : enabled.slice(githubCursor % Math.max(enabled.length, 1), (githubCursor % Math.max(enabled.length, 1)) + 1);
        if (!url.searchParams.has("manual")) githubCursor += 1;
        for (const repo of batch) {
          const etag = runtime.snapshot().projects?.[repo.officeProjectId]?.github?.etags?.[repo.id];
          const result = await fetchIssues({ settings, project: repo, fetchImpl: githubFetch, etag });
          if (result.ok && !result.notModified) runtime.setGithubIssues(result.issues, result.etag, repo.id);
        }
        sendJson(res, 200, runtime.view(url.searchParams.get("project") || undefined));
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/github/drafts/") && url.pathname.endsWith("/publish")) {
        const id = decodeURIComponent(url.pathname.slice("/api/github/drafts/".length, -"/publish".length));
        const result = await runtime.publishDraft(id);
        sendJson(res, result.ok ? 200 : result.status ?? 400, { ...(result.session ?? {}), message: result.message });
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/github/drafts/") && url.pathname.endsWith("/discard")) {
        const id = decodeURIComponent(url.pathname.slice("/api/github/drafts/".length, -"/discard".length));
        const result = runtime.discardDraft(id);
        sendJson(res, result.ok ? 200 : result.status ?? 400, { ...(result.session ?? {}), message: result.message });
        return;
      }
      if (req.method === "POST" && /^\/api\/github\/issues\/\d+\/pr$/.test(url.pathname)) {
        const number = Number(url.pathname.split("/")[4]);
        const result = await runtime.openPullRequest(number);
        sendJson(res, result.ok ? 200 : result.status ?? 400, { ...(result.session ?? {}), message: result.message });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/hire") {
        const body = await readJson(req);
        const result = await runtime.hireCandidate(body.candidateId, body.projectId);
        if (result.profile) writeProfile(iac.dir, result.profile);
        const payload = result.session ?? { error: "bad-request" };
        if (!result.ok) {
          const last = [...(payload.office?.messages ?? [])].reverse().find((message) => message.from === "system" || message.from === "HR");
          payload.message = last?.text || "現在沒有可以 Hire 的 Candidate。請先 @HR 提出一個 Role。";
        }
        sendJson(res, result.ok ? 201 : result.status ?? 400, payload);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/cancel") {
        const body = await readJson(req);
        const result = await runtime.cancel(body.messageId);
        sendJson(res, result.ok ? 200 : 404, result.session);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/approve") {
        sendJson(res, 200, runtime.approve().session);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/hold") {
        sendJson(res, 200, runtime.hold().session);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/coding") {
        const started = runtime.startCoding();
        sendJson(res, 200, started.session);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/session/pr") {
        sendJson(res, 200, runtime.finishCoding().session);
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
  const hermes = resolveHermesSettingsFile({ cwd: demoRoot });
  const githubFile = resolveGithubFile({ cwd: demoRoot });
  const { host, port } = demoBind();
  const visualBase = process.env.HARNESS_VISUAL_URL ?? "http://127.0.0.1:4600";
  const server = createServer({
    iac,
    hermesFile: hermes.file,
    githubFile,
    visualSink: async (snapshot) => {
      await fetch(`${visualBase}/api/spike/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(400),
      });
    },
  });
  server.listen(port, host, () => {
    let hermesNote = "Mock mode（尚未設定 Hermes）";
    try {
      if (isConfigured(loadHermesSettings(hermes.file))) hermesNote = "Hermes 已設定，Hire 時會先檢查連線";
    } catch {
      hermesNote = "Hermes 設定檔讀不到";
    }
    console.log(`HarnessOffice chat http://${host}:${port}`);
    console.log(`${hermesNote}。設定檔：${hermes.file}${hermes.fallback ? " (fallback)" : ""}`);
    console.log("PixelOffice events: HTTP http://127.0.0.1:3003/api/events and UDP 127.0.0.1:9997");
    console.log(`IaC store: ${iac.dir}${iac.fallback ? " (fallback)" : ""}`);
    setInterval(() => {
      const settings = loadGithubSettings(githubFile);
      if (!settings.token && !enabledRepos(settings).some((repo) => repo.token)) return;
      fetch(`http://127.0.0.1:${port}/api/github/refresh`, { method: "POST" }).catch(() => {});
    }, 15000);
  });
}
