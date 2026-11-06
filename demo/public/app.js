import { eventsForTransition } from "/pixel-office-events.mjs";

let session = {
  present: ["HR"],
  messages: [],
  pendingCandidates: null,
  issue: null,
  assignments: [],
  phase: "idle",
  mockPr: null,
};
let previous = null;
let writing = false;
let runtimeState = { state: "mock" };

const modeLabel = document.querySelector("#mode-label");
const banner = document.querySelector("#banner");
const hermesStatus = document.querySelector("#hermes-status");
const hermesForm = document.querySelector("#hermes-form");
const hermesEndpoint = document.querySelector("#hermes-endpoint");
const hermesDashboard = document.querySelector("#hermes-dashboard");
const hermesToken = document.querySelector("#hermes-token");
const hermesDashboardToken = document.querySelector("#hermes-dashboard-token");
const hermesCloneFrom = document.querySelector("#hermes-clone-from");
const hermesProvider = document.querySelector("#hermes-provider");
const hermesModel = document.querySelector("#hermes-model");
const hermesGroupName = document.querySelector("#hermes-group-name");

let savedHermes = null;

const log = document.querySelector("#log");
const issueCard = document.querySelector("#issue");
const candidateBox = document.querySelector("#candidates");
const prCard = document.querySelector("#pr");
const draft = document.querySelector("#draft");
const approve = document.querySelector("#approve");
const hold = document.querySelector("#hold");
const animate = document.querySelector("#animate");
const iacNote = document.querySelector("#iac");

function publishOffice(events) {
  if (events.length === 0) return;
  fetch("/api/pixel-office/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  }).catch(() => {});
}

function render() {
  const events = eventsForTransition(previous, session);
  previous = structuredClone(session);
  publishOffice(events);

  log.replaceChildren();
  for (const message of session.messages) {
    const item = document.createElement("li");
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = message.from === "human" ? "你" : message.from === "system" ? "系統" : message.from;
    const text = document.createElement("div");
    text.textContent = message.text;
    item.append(who, text);
    log.append(item);
  }
  log.scrollTop = log.scrollHeight;

  if (session.issue) {
    issueCard.hidden = false;
    const state = session.issue.status === "approved" ? "已核准" : "草稿";
    issueCard.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `Issue · ${state}`;
    const summary = document.createElement("p");
    summary.textContent = session.issue.summary;
    const criteria = document.createElement("p");
    criteria.textContent = `驗收條件：${session.issue.acceptanceCriteria.join("；")}`;
    issueCard.append(title, summary, criteria);
  } else {
    issueCard.hidden = true;
    issueCard.replaceChildren();
  }

  candidateBox.replaceChildren();
  if (session.pendingCandidates) {
    for (const candidate of session.pendingCandidates.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "candidate";
      button.textContent = `Hire ${candidate.displayName} · ${session.pendingCandidates.role} · ${candidate.blurb}`;
      button.addEventListener("click", () => choose(candidate.id));
      candidateBox.append(button);
    }
  }

  if (session.mockPr) {
    prCard.hidden = false;
    prCard.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "Mock PR · 未送出 GitHub";
    const line = document.createElement("p");
    line.textContent = session.mockPr.title;
    prCard.append(title, line);
  } else {
    prCard.hidden = true;
    prCard.replaceChildren();
  }

  approve.disabled = writing || session.issue?.status !== "draft";
  hold.disabled = approve.disabled;
  animate.disabled = writing || session.issue?.status !== "approved" || session.assignments.length === 0 || session.phase !== "idle";
}

function applyPayload(payload) {
  if (!payload?.office) return;
  session = payload.office;
  runtimeState = payload.runtime ?? { state: "mock" };
  render();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (payload?.office) applyPayload(payload);
  return { response, payload };
}

async function choose(candidateId) {
  await postJson("/api/session/hire", { candidateId });
}

async function play() {
  writing = true;
  render();
  await postJson("/api/session/coding");
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await postJson("/api/session/pr");
  writing = false;
  render();
}

document.querySelector("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = draft.value.trim();
  if (!text) return;
  draft.value = "";
  await postJson("/api/session/messages", { text, clientMessageId: `c${Date.now()}-${Math.random().toString(16).slice(2)}` });
});

approve.addEventListener("click", () => {
  postJson("/api/session/approve");
});

hold.addEventListener("click", () => {
  postJson("/api/session/hold");
});

animate.addEventListener("click", () => {
  play();
});

const quick = document.createElement("div");
quick.className = "actions";
for (const role of ["PM", "Tech Lead", "FE", "BE", "QA"]) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `@HR ${role}`;
  button.addEventListener("click", () => {
    draft.value = `@HR ${role}`;
    draft.focus();
  });
  quick.append(button);
}
document.querySelector("#composer").prepend(quick);

function formSettings() {
  return {
    apiBase: hermesEndpoint.value.trim(),
    dashboardBase: hermesDashboard.value.trim(),
    token: hermesToken.value,
    dashboardToken: hermesDashboardToken.value,
    bot: {
      cloneFrom: hermesCloneFrom.value.trim(),
      provider: hermesProvider.value.trim(),
      model: hermesModel.value.trim(),
    },
    group: { name: hermesGroupName.value.trim() },
  };
}

function fillHermesForm(settings) {
  hermesEndpoint.value = settings.apiBase ?? "";
  hermesDashboard.value = settings.dashboardBase && settings.dashboardBase !== settings.apiBase ? settings.dashboardBase : "";
  hermesCloneFrom.value = settings.bot?.cloneFrom ?? "";
  hermesProvider.value = settings.bot?.provider ?? "";
  hermesModel.value = settings.bot?.model ?? "";
  hermesGroupName.value = settings.group?.name ?? "";
  hermesToken.value = "";
  hermesDashboardToken.value = "";
}

function showHermesStatus(text) {
  hermesStatus.textContent = text;
}

function applyHermesMode(settings, probe) {
  savedHermes = settings;
  const state = probe?.state ?? runtimeState.state;
  if (!settings?.configured || state === "mock" || state === "unconfigured") {
    document.title = "HarnessOffice · Mock mode";
    modeLabel.textContent = "Mock mode";
    banner.textContent = "這是展示。沒有 Hermes 設定時不會呼叫 Hermes。不會呼叫 OpenCode，也不會寫入 GitHub。Office 畫面是同一台機器上的 PixelOffice，3D 畫面在 4600。";
    showHermesStatus("Mock mode：尚未設定 Hermes。Hire 不會呼叫 Hermes。");
    return;
  }
  if (state === "auth") {
    document.title = "HarnessOffice · Hermes 憑證被拒";
    modeLabel.textContent = "Hermes 憑證被拒";
    banner.textContent = "Hermes 有回應，但拒絕了憑證。不會把這次當成 Mock 成功，也不會呼叫 OpenCode 或寫入 GitHub。";
    showHermesStatus("Hermes 拒絕了憑證。請更新 API 憑證。沒有改用 Mock 成功。");
    return;
  }
  if (state === "offline" || probe?.reachable === false) {
    document.title = "HarnessOffice · Mock mode";
    modeLabel.textContent = "Mock mode";
    banner.textContent = "Mock mode：Hermes 連不上。Hire 會標明是 Mock，不會假裝已經建立 Bot。";
    showHermesStatus("Hermes 連不上。Hire 會用 Mock mode，不會假裝已建立 Bot。");
    return;
  }
  if (!probe) {
    document.title = "HarnessOffice · Hermes 已設定";
    modeLabel.textContent = "Hermes 已設定";
    banner.textContent = "Hermes 已設定。Hire 會建立 Bot profile，並把 Group Chat 送到該 profile 的 API session。不會呼叫 OpenCode，也不會寫入 GitHub。";
    showHermesStatus(settings.tokenSet ? "已儲存 Hermes 設定，憑證在伺服器上。還沒檢查連線。" : "已儲存 Hermes 設定。還沒檢查連線。");
    return;
  }
  document.title = "HarnessOffice · Hermes";
  modeLabel.textContent = "Hermes";
  banner.textContent = "Hermes API 有回應。Group Chat 會把 @Role 送到那個 Bot 的 session。不會呼叫 OpenCode，也不會寫入 GitHub。";
  showHermesStatus(probe.multiplex === false
    ? "Hermes 連得上，但 /p/<profile>/ 沒有分到個別 Bot。Profile 可以建立，對話不會假裝已送達。"
    : "Hermes API 有回應。下一次 Hire 會建立 Bot，並開一個穩定的 API session。");
}

async function probeHermes() {
  const response = await fetch("/api/hermes/probe", { method: "POST" });
  const body = await response.json();
  applyHermesMode(savedHermes ?? { configured: body.configured }, body);
  return body;
}

hermesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formSettings();
  const response = await fetch("/api/hermes", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    showHermesStatus(body.message ?? "Hermes 設定沒有儲存。");
    return;
  }
  fillHermesForm(body);
  applyHermesMode(body, null);
  if (body.configured) {
    try {
      await probeHermes();
    } catch {
      showHermesStatus("檢查連線時出錯。Hire 會在按下時再試一次。");
    }
  }
});

document.querySelector("#hermes-clear").addEventListener("click", async () => {
  hermesEndpoint.value = "";
  hermesDashboard.value = "";
  hermesToken.value = "";
  hermesDashboardToken.value = "";
  hermesCloneFrom.value = "";
  hermesProvider.value = "";
  hermesModel.value = "";
  hermesGroupName.value = "";
  const response = await fetch("/api/hermes", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...formSettings(), clearToken: true }),
  });
  const body = await response.json();
  if (!response.ok) {
    showHermesStatus(body.message ?? "沒有清掉 Hermes 設定。");
    return;
  }
  fillHermesForm(body);
  applyHermesMode(body, null);
});

document.querySelector("#hermes-probe").addEventListener("click", async () => {
  if (!savedHermes?.configured) {
    showHermesStatus("Mock mode：尚未設定 Hermes。請先儲存 API base。");
    return;
  }
  if (hermesEndpoint.value.trim() !== (savedHermes.apiBase ?? "")) {
    showHermesStatus("表單和已儲存的 API base 不一樣。請先儲存，再檢查連線。");
    return;
  }
  showHermesStatus("正在檢查 Hermes 連線…");
  await probeHermes();
});

const hermesResponse = await fetch("/api/hermes");
const hermes = await hermesResponse.json();
fillHermesForm(hermes);
applyHermesMode(hermes, null);
if (hermes.configured) {
  probeHermes().catch(() => {
    showHermesStatus("檢查連線時出錯。Hire 會在按下時再試一次。");
  });
}

const sessionResponse = await fetch("/api/session");
applyPayload(await sessionResponse.json());
const stream = new EventSource("/api/session/events");
stream.onmessage = (event) => {
  applyPayload(JSON.parse(event.data));
};

const iacResponse = await fetch("/api/iac");
const iac = await iacResponse.json();
iacNote.textContent = iac.fallback
  ? `IaC store fallback：${iac.dir}。家目錄的 ~/harness-office-iac/bots/ 現在不可寫。`
  : `IaC store：${iac.dir}`;
render();
