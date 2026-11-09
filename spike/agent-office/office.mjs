// Mock office the vendored agent-office client can sit in.
// Status mapping is the spike's whole product behavior:
//   appear  → idle
//   waiting → needs_input
//   coding  → working + action edit
//   pr      → done, plus a merged pull and a gong so the client dances

export const FLOOR_ID = "harness";
export const FLOOR_NAME = "HarnessOffice";

export const SPEAKERS = {
  HR: { id: "role-hr", deskId: "desk-1", name: "HR", color: "#f0c14a", sign: "#ef476f", prNumber: 101 },
  PM: { id: "role-pm", deskId: "desk-2", name: "PM", color: "#8eb6e0", sign: "#118ab2", prNumber: 102 },
  "Tech Lead": { id: "role-tech-lead", deskId: "desk-3", name: "Tech Lead", color: "#c48ad4", sign: "#9b5de5", prNumber: 103 },
  FE: { id: "role-fe", deskId: "desk-4", name: "FE", color: "#e07a5f", sign: "#f78c6b", prNumber: 104 },
  BE: { id: "role-be", deskId: "desk-5", name: "BE", color: "#7dcea0", sign: "#06d6a0", prNumber: 105 },
  QA: { id: "role-qa", deskId: "desk-6", name: "QA", color: "#d9d3c5", sign: "#ffd166", prNumber: 106 },
};

/** Phase API stays HR and PM. Other roles only speak when Group Chat says so. */
export const ROLES = { HR: SPEAKERS.HR, PM: SPEAKERS.PM };

export const PHASES = {
  appear: { status: "idle", acked: true, summary: "At the desk" },
  waiting: { status: "needs_input", acked: false, summary: "Waiting on you" },
  coding: { status: "working", action: "edit", acked: true, summary: "Editing" },
  pr: { status: "done", acked: false, summary: "Mock PR merged" },
};

/**
 * Lines copied from the PixelOffice Mock Group Chat (`demo/office.mjs`).
 * Each one is spoken by that role, and shown on the card over their head.
 */
export const LINES = {
  HR: {
    appear: "我是 HR，開場就在。要 Candidate 請 @HR，並說 Role：PM、Tech Lead、FE、BE 或 QA。選定之前不會 Hire。",
    waiting: "告訴我 Role：PM、Tech Lead、FE、BE 或 QA。",
    coding: "我只能為 PM、Tech Lead、FE、BE、QA 提出 Candidate。",
    pr: "已 Hire 林可 擔任 PM。Mock mode：由 Hermes 建立 Bot，OpenCode 沒有參與。",
  },
  PM: {
    appear: "Issue 草稿：做出一個看得到團隊的 Office。驗收條件：人可以在同一個 Group Chat 裡把需求說清楚；Issue 帶有驗收條件；人核准之前不開始寫程式。請核准，或先不要。",
    waiting: "請核准，或先不要。",
    coding: "Mock mode：FE 與 BE 正在寫程式。沒有啟動 OpenCode。",
    pr: "Mock PR：做出一個看得到團隊的 Office。這不是 GitHub 上的 PR，沒有送出。",
  },
};

const ZERO_USAGE = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };

function chatLine(role, text) {
  return {
    t: "chat",
    from: role?.id ?? "spike",
    name: role?.name ?? "Spike",
    color: role?.color ?? "#ffd166",
    text,
    at: Date.now(),
  };
}

function phaseOf(worker) {
  if (worker.status === "needs_input") return "waiting";
  if (worker.status === "working") return "coding";
  if (worker.status === "done") return "pr";
  return "appear";
}

function pullUrl(number) {
  return `https://github.com/codingXiang/HarnessOffice/pull/${number}`;
}

function mergedPull(role) {
  const now = new Date().toISOString();
  return {
    number: role.prNumber,
    title: `${role.name} mock PR`,
    state: "MERGED",
    isDraft: false,
    url: pullUrl(role.prNumber),
    author: "spike",
    labels: [],
    reviewDecision: "",
    headRefName: `spike/${role.name.toLowerCase()}`,
    baseRefName: "main",
    createdAt: now,
    updatedAt: now,
    additions: 1,
    deletions: 0,
    checks: "pass",
    body: "Mock PR from the HarnessOffice visual spike. Nothing was pushed.",
    closes: [],
  };
}

function workerRecord(role, phaseName, prev) {
  const phase = PHASES[phaseName];
  const worker = {
    id: role.id,
    kind: "agent",
    provider: "custom",
    deskId: role.deskId,
    name: role.name,
    color: role.color,
    status: phase.status,
    acked: phase.acked,
    createdBy: "spike",
    createdAt: prev?.createdAt ?? Date.now(),
    cols: 80,
    rows: 24,
    viewers: [],
    viewerIds: [],
    task: { name: role.name, summary: LINES[role.name]?.[phaseName] ?? phase.summary },
    activity: LINES[role.name]?.[phaseName] ?? phase.summary,
  };
  if (phase.action) worker.action = phase.action;
  if (phase.status === "needs_input" || phase.status === "done") worker.waitingSince = Date.now();
  if (phaseName === "pr") worker.pr = { number: role.prNumber, url: pullUrl(role.prNumber) };
  return worker;
}

export function createOffice() {
  const workers = new Map();
  const pulls = new Map();
  const seenLines = new Set();
  const transcript = [];

  function floorView(port = 4600) {
    const list = [...workers.values()];
    return {
      floor: FLOOR_ID,
      project: {
        name: FLOOR_NAME,
        dir: "/tmp/harness-office-spike",
        branch: "main",
        remote: "https://github.com/codingXiang/HarnessOffice",
        agentCmd: "mock",
        defaultProvider: "custom",
        agentProviders: ["custom"],
      },
      workers: list,
      issues: { items: [], fetchedAt: Date.now(), loading: false },
      pulls: { items: [...pulls.values()], fetchedAt: Date.now(), loading: false },
      queue: { tasks: [], maxWorkers: 0 },
      decor: [],
      plan: {
        wing: 0,
        labels: Object.fromEntries(
          list.map((worker) => {
            const speaker = Object.values(SPEAKERS).find((item) => item.id === worker.id);
            if (!speaker) return null;
            return [speaker.deskId, { text: speaker.name, color: speaker.sign, by: "spike", at: 0 }];
          }).filter(Boolean),
        ),
      },
      services: { items: [], port },
      dog: {
        name: "Biscuit",
        coat: 0,
        breed: "corgi",
        path: [[-2, 1]],
        speed: 0,
        elapsed: 0,
        act: "sit",
        face: 0,
      },
      jukebox: { on: false, track: "coffee-break", startedAt: Date.now(), elapsed: 0 },
      cabinet: { player: null, scores: [], frame: null },
      whiteboard: { elements: [], people: [] },
      meeting: { current: null, past: [] },
      ball: {},
      cars: [],
      jail: { prisoners: [], bones: 0 },
    };
  }

  function welcome(you, peers, port) {
    const busy = [...workers.values()].filter((w) => w.status === "working" || w.status === "needs_input").length;
    const waiting = [...workers.values()].filter((w) => w.status === "needs_input" || (w.status === "done" && !w.acked)).length;
    return {
      t: "welcome",
      you,
      peers,
      floors: [
        {
          id: FLOOR_ID,
          name: FLOOR_NAME,
          repo: "codingXiang/HarnessOffice",
          dir: "/tmp/harness-office-spike",
          branch: "main",
          palette: 0,
          local: true,
          addedBy: "spike",
          addedAt: 0,
          workers: workers.size,
          busy,
          waiting,
          people: peers.length,
          wing: 0,
        },
      ],
      projectsDir: { dir: "~/harness-office", custom: false },
      ice: [],
      chat: transcript.length > 0
        ? transcript.slice(-20)
        : [
            {
              from: "spike",
              name: "Spike",
              color: "#ffd166",
              text: "Spectator view of the north desks, HR through QA. Press U to walk, or open ?view=first. Lines here come from the Group Chat on port 4173.",
              at: Date.now(),
            },
          ],
      invites: false,
      version: "0.1.211",
      upgrade: { available: false, phase: "idle" },
      usage: { total: { ...ZERO_USAGE }, today: { ...ZERO_USAGE }, day: "2026-11-05", pauseHiring: false },
      limits: { windows: [], at: 0 },
      me: { admin: false },
      notify: {},
      machine: { cpu: 4, cores: 2, memUsed: 512 * 1024 * 1024, memTotal: 2 * 1024 * 1024 * 1024, history: [], workers: workers.size },
      sky: { lat: 25.03, lon: 121.57, utcOffset: 480, weather: "clear", intensity: 0, realTime: true },
      theme: { pick: "off", active: null },
      map: { pick: "office", custom: [] },
      prompts: { custom: {} },
      leaveOnMerge: { on: false },
      ...floorView(port),
    };
  }

  function upsert(roleName, phaseName) {
    const role = ROLES[roleName];
    if (!role) return { error: "unknown-role" };
    if (!PHASES[phaseName]) return { error: "unknown-phase" };
    const worker = workerRecord(role, phaseName, workers.get(role.id));
    workers.set(role.id, worker);
    const messages = [{ t: "worker.update", worker }, chatLine(role, worker.activity)];
    if (phaseName === "pr") {
      pulls.set(role.prNumber, mergedPull(role));
      messages.push({
        t: "gh.pulls",
        state: { items: [...pulls.values()], fetchedAt: Date.now(), loading: false },
      });
      messages.push({ t: "gong", why: "merged", by: "spike", pr: role.prNumber });
    }
    return { worker, phase: phaseName, messages };
  }

  function applyActivity(worker, activity) {
    if (activity === "working") {
      worker.status = "working";
      worker.action = "reading";
      worker.acked = true;
    } else if (activity === "waiting") {
      worker.status = "needs_input";
      worker.acked = false;
      delete worker.action;
    } else if (activity === "idle") {
      worker.status = "idle";
      worker.acked = true;
      delete worker.action;
    }
  }

  const SEATED_NOTE = "已入座。還沒有回覆。";

  function shownName(role, name) {
    const trimmed = typeof name === "string" ? name.trim().slice(0, 24) : "";
    return trimmed || role?.name || "";
  }

  function cardTitle(role, shown) {
    if (!role) return shown || "Spike";
    if (!shown || shown === role.name) return role.name;
    return `${role.name} · ${shown}`;
  }

  /** Puts a known role at their desk. A role with no line of their own still gets a chair and a card. */
  function placeWorker(roleName, options) {
    const role = SPEAKERS[roleName];
    if (!role) return null;
    const shown = shownName(role, options.name);
    const summary = typeof options.text === "string" && options.text.trim() ? options.text.trim().slice(0, 400) : SEATED_NOTE;
    const title = cardTitle(role, shown);
    const prev = workers.get(role.id);
    const worker = workerRecord(role, prev ? phaseOf(prev) : "appear", prev);
    worker.name = shown || role.name;
    worker.task = { name: title, summary };
    worker.activity = summary;
    if (options.activity) applyActivity(worker, options.activity);
    const unchanged = Boolean(
      prev
      && prev.name === worker.name
      && prev.deskId === worker.deskId
      && prev.status === worker.status
      && prev.task?.name === worker.task.name
      && prev.task?.summary === worker.task.summary,
    );
    workers.set(role.id, worker);
    return { worker, unchanged };
  }

  /** A Group Chat line. Known roles get it on the card over their head; anyone else is chat-only. */
  function say(roleName, text, options = {}) {
    const line = typeof text === "string" ? text.trim().slice(0, 400) : "";
    if (!line) return { error: "empty" };
    const messageId = options.messageId;
    if (messageId && seenLines.has(messageId)) return { duplicate: true, messages: [] };
    if (messageId) seenLines.add(messageId);
    const role = SPEAKERS[roleName];
    const shown = shownName(role, options.name);
    const chat = chatLine(role, line);
    if (shown) chat.name = shown;
    transcript.push({
      from: role?.id ?? "spike",
      name: shown || String(roleName || "Spike").slice(0, 24),
      color: role?.color ?? "#ffd166",
      text: line,
      at: chat.at,
    });
    if (!role) return { worker: null, messages: [{ ...chat, name: shown || String(roleName || "Spike").slice(0, 24) }] };
    const placed = placeWorker(roleName, { name: shown, text: line, activity: options.activity });
    return { worker: placed.worker, messages: [{ t: "worker.update", worker: placed.worker }, chat] };
  }

  function applySession(snapshot) {
    const messages = [];
    const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
    const spoken = new Set();
    for (const line of lines) {
      const result = say(line.role, line.text, { messageId: line.id, activity: line.activity, name: line.name });
      if (result.worker) spoken.add(line.role);
      if (result.messages) messages.push(...result.messages);
    }
    const roles = Array.isArray(snapshot?.roles) ? snapshot.roles : [];
    for (const role of roles) {
      if (!role?.role || spoken.has(role.role)) continue;
      const placed = placeWorker(role.role, { name: role.name, text: role.text, activity: role.activity });
      if (!placed || placed.unchanged) continue;
      messages.push({ t: "worker.update", worker: placed.worker });
    }
    if (messages.some((message) => message.t === "worker.update")) {
      messages.push({ t: "plan", plan: floorView().plan });
    }
    if (Array.isArray(snapshot?.issues)) {
      messages.push({
        t: "gh.issues",
        state: { items: snapshot.issues, fetchedAt: Date.now(), loading: false },
      });
    }
    return { messages };
  }

  return {
    workers,
    pulls,
    floorView,
    welcome,
    upsert,
    say,
    applySession,
    snapshot() {
      return { workers: [...workers.values()], pulls: [...pulls.values()] };
    },
  };
}
