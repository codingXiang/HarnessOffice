// Mock office the vendored agent-office client can sit in.
// Status mapping is the spike's whole product behavior:
//   appear  → idle
//   waiting → needs_input
//   coding  → working + action edit
//   pr      → done, plus a merged pull and a gong so the client dances

export const FLOOR_ID = "harness";
export const FLOOR_NAME = "HarnessOffice";

export const ROLES = {
  HR: { id: "role-hr", deskId: "desk-1", name: "HR", color: "#ef476f", sign: "#ef476f", prNumber: 101 },
  PM: { id: "role-pm", deskId: "desk-2", name: "PM", color: "#4f86f7", sign: "#118ab2", prNumber: 102 },
};

export const PHASES = {
  appear: { status: "idle", acked: true, summary: "At the desk" },
  waiting: { status: "needs_input", acked: false, summary: "Waiting on you" },
  coding: { status: "working", action: "edit", acked: true, summary: "Editing" },
  pr: { status: "done", acked: false, summary: "Mock PR merged" },
};

const ZERO_USAGE = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };

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
    task: { name: role.name, summary: phase.summary },
    activity: phase.summary,
  };
  if (phase.action) worker.action = phase.action;
  if (phase.status === "needs_input" || phase.status === "done") worker.waitingSince = Date.now();
  if (phaseName === "pr") worker.pr = { number: role.prNumber, url: pullUrl(role.prNumber) };
  return worker;
}

export function createOffice() {
  const workers = new Map();
  const pulls = new Map();

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
        labels: {
          "desk-1": { text: "HR", color: ROLES.HR.sign, by: "spike", at: 0 },
          "desk-2": { text: "PM", color: ROLES.PM.sign, by: "spike", at: 0 },
        },
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
      chat: [
        {
          from: "spike",
          name: "Spike",
          color: "#ffd166",
          text: "Spectator view of desk 1 (HR) and desk 2 (PM). Press U to walk, or open ?view=first. npm run spike:office:demo moves them.",
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
    const messages = [{ t: "worker.update", worker }];
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

  return {
    workers,
    pulls,
    floorView,
    welcome,
    upsert,
    snapshot() {
      return { workers: [...workers.values()], pulls: [...pulls.values()] };
    },
  };
}
