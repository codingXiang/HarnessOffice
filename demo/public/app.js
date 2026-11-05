import {
  approveIssue,
  createSession,
  finishMockPr,
  handleHumanMessage,
  hire,
  holdIssue,
  startMockCoding,
} from "/office.mjs";
import { eventsForTransition } from "/pixel-office-events.mjs";

let session = createSession();
let previous = null;
let templates = null;
let writing = false;

let mirrored = 0;

/** The 3D spike on this host, port 4600. Missing spike is ignored. Hermes is not called. */
function mirrorChatToSpike() {
  const fresh = session.messages.slice(mirrored);
  mirrored = session.messages.length;
  const spike = `${location.protocol}//${location.hostname}:4600`;
  for (const message of fresh) {
    if (!message.text || message.from === "human") continue;
    fetch(`${spike}/api/spike/say`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: message.from, text: message.text }),
    }).catch(() => {});
  }
}

const STORAGE_KEY = "harness-office.hermes-settings";
const modeLabel = document.querySelector("#mode-label");
const banner = document.querySelector("#banner");
const hermesStatus = document.querySelector("#hermes-status");
const hermesForm = document.querySelector("#hermes-form");
const hermesEndpoint = document.querySelector("#hermes-endpoint");
const hermesToken = document.querySelector("#hermes-token");
const hermesCloneFrom = document.querySelector("#hermes-clone-from");
const hermesProvider = document.querySelector("#hermes-provider");
const hermesModel = document.querySelector("#hermes-model");
const hermesGroupName = document.querySelector("#hermes-group-name");
const hermesRoomId = document.querySelector("#hermes-room-id");

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

async function loadTemplates() {
  const roles = ["hr", "pm", "tech-lead", "fe", "be", "qa"];
  const loaded = {};
  for (const file of roles) {
    const response = await fetch(`/templates/${file}.json`);
    const data = await response.json();
    loaded[data.role] = data;
  }
  return loaded;
}

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
  mirrorChatToSpike();

  if (session.issue) {
    issueCard.hidden = false;
    const state = session.issue.status === "approved" ? "已核准" : "草稿";
    issueCard.innerHTML = `<strong>Issue · ${state}</strong><p>${session.issue.summary}</p><p>驗收條件：${session.issue.acceptanceCriteria.join("；")}</p>`;
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
    prCard.innerHTML = `<strong>Mock PR · 未送出 GitHub</strong><p>${session.mockPr.title}</p>`;
  } else {
    prCard.hidden = true;
    prCard.replaceChildren();
  }

  approve.disabled = writing || session.issue?.status !== "draft";
  hold.disabled = approve.disabled;
  animate.disabled = writing || session.issue?.status !== "approved" || session.assignments.length === 0 || session.phase !== "idle";
}

async function choose(candidateId) {
  const pending = session.pendingCandidates;
  const candidate = pending?.options.find((item) => item.id === candidateId);
  if (!candidate) return;
  const response = await fetch("/api/hires", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      role: pending.role,
      candidateId: candidate.id,
      displayName: candidate.displayName,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    session = {
      ...session,
      messages: [...session.messages, {
        from: "system",
        text: body.message || "Bot profile 沒有寫入 IaC store，所以這次沒有 Hire。",
      }],
    };
    render();
    return;
  }
  const hired = hire(session, candidateId, templates, {
    createdBy: body.profile.createdBy,
    reason: body.reason,
  });
  session = hired.session;
  session.messages.push({
    from: "system",
    text: `Bot profile 已寫入 ${body.file}${body.fallback ? "（家目錄不可寫，改用 fallback）" : ""}。PixelOffice 會讓這位 Role 出現。`,
  });
  render();
}

async function play() {
  writing = true;
  session = startMockCoding(session).session;
  render();
  await new Promise((resolve) => setTimeout(resolve, 1600));
  session = finishMockPr(session).session;
  writing = false;
  render();
}

document.querySelector("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = draft.value.trim();
  if (!text) return;
  const hireName = text.match(/^@HR\s+雇用\s+(.+)$/)?.[1]?.trim();
  const named = session.pendingCandidates?.options.find((item) => item.displayName === hireName);
  if (named) {
    draft.value = "";
    await choose(named.id);
    return;
  }
  const result = handleHumanMessage(session, text, templates);
  session = result.session;
  draft.value = "";
  render();
});

approve.addEventListener("click", () => {
  session = approveIssue(session).session;
  render();
});

hold.addEventListener("click", () => {
  session = holdIssue(session).session;
  render();
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

function formSettings(token) {
  return {
    endpoint: hermesEndpoint.value.trim(),
    token,
    bot: {
      cloneFrom: hermesCloneFrom.value.trim(),
      provider: hermesProvider.value.trim(),
      model: hermesModel.value.trim(),
    },
    group: {
      name: hermesGroupName.value.trim(),
      roomId: hermesRoomId.value.trim(),
    },
  };
}

function fillHermesForm(settings) {
  hermesEndpoint.value = settings.endpoint ?? "";
  hermesCloneFrom.value = settings.bot?.cloneFrom ?? "";
  hermesProvider.value = settings.bot?.provider ?? "";
  hermesModel.value = settings.bot?.model ?? "";
  hermesGroupName.value = settings.group?.name ?? "";
  hermesRoomId.value = settings.group?.roomId ?? "";
  hermesToken.value = "";
}

function rememberLocal(settings) {
  const previous = readLocal();
  const token = settings.token !== "" ? settings.token : (previous?.token ?? "");
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, token }));
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function showHermesStatus(text) {
  hermesStatus.textContent = text;
}

function applyHermesMode(settings, probe) {
  savedHermes = settings;
  if (!settings?.configured) {
    document.title = "HarnessOffice · Mock mode";
    modeLabel.textContent = "Mock mode";
    banner.textContent = "這是展示。不會呼叫 Hermes、OpenCode，也不會寫入 GitHub。Office 畫面是同一台機器上的 PixelOffice 視窗。";
    showHermesStatus("Mock mode：尚未設定 Hermes。Hire 不會呼叫 Hermes。");
    return;
  }
  if (!probe) {
    document.title = "HarnessOffice · Hermes 已設定";
    modeLabel.textContent = "Hermes 已設定";
    banner.textContent = "Hermes 已設定。Hire 會先檢查連線，連得上才建立 Bot。不會呼叫 OpenCode，也不會寫入 GitHub。";
    showHermesStatus(settings.tokenSet ? "已儲存 Hermes 設定，憑證也在。還沒檢查連線。" : "已儲存 Hermes 設定。還沒檢查連線。");
    return;
  }
  if (probe.reachable) {
    document.title = "HarnessOffice · Hermes";
    modeLabel.textContent = "Hermes";
    banner.textContent = "Hermes endpoint 有回應。Hire 會要求 Hermes 建立 Bot。不會呼叫 OpenCode，也不會寫入 GitHub。";
    showHermesStatus("Hermes endpoint 有回應。下一次 Hire 會要求它建立 Bot。");
    return;
  }
  document.title = "HarnessOffice · Mock mode";
  modeLabel.textContent = "Mock mode";
  banner.textContent = "Mock mode：Hermes 連不上。Hire 仍會完成，但是 Mock，不會假裝已經建立 Bot。不會呼叫 OpenCode，也不會寫入 GitHub。";
  showHermesStatus("Hermes 連不上。Hire 會用 Mock mode，不會假裝已建立 Bot。");
}

async function probeHermes() {
  const response = await fetch("/api/hermes/probe", { method: "POST" });
  const body = await response.json();
  applyHermesMode(savedHermes ?? { configured: body.configured }, body);
  return body;
}

hermesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formSettings(hermesToken.value);
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
  rememberLocal(payload);
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
  const response = await fetch("/api/hermes", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: "", clearToken: true, bot: { cloneFrom: "", provider: "", model: "" }, group: { name: "", roomId: "" } }),
  });
  const body = await response.json();
  if (!response.ok) {
    showHermesStatus(body.message ?? "沒有清掉 Hermes 設定。");
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  fillHermesForm(body);
  applyHermesMode(body, null);
});

document.querySelector("#hermes-probe").addEventListener("click", async () => {
  if (!savedHermes?.configured) {
    showHermesStatus("Mock mode：尚未設定 Hermes。請先儲存 endpoint。");
    return;
  }
  if (hermesEndpoint.value.trim() !== (savedHermes.endpoint ?? "")) {
    showHermesStatus("表單和已儲存的 endpoint 不一樣。請先儲存，再檢查連線。");
    return;
  }
  showHermesStatus("正在檢查 Hermes 連線…");
  await probeHermes();
});

templates = await loadTemplates();
const hermesResponse = await fetch("/api/hermes");
const hermes = await hermesResponse.json();
if (!hermes.configured) {
  const local = readLocal();
  if (local?.endpoint) {
    fillHermesForm(local);
    showHermesStatus("瀏覽器裡有尚未寫入的 Hermes 設定。按儲存之後，Hire 才會用它。現在仍是 Mock mode。");
  } else {
    applyHermesMode(hermes, null);
  }
} else {
  fillHermesForm(hermes);
  applyHermesMode(hermes, null);
  probeHermes().catch(() => {
    showHermesStatus("檢查連線時出錯。Hire 會在按下時再試一次。");
  });
}

const iacResponse = await fetch("/api/iac");
const iac = await iacResponse.json();
iacNote.textContent = iac.fallback
  ? `IaC store fallback：${iac.dir}。家目錄的 ~/harness-office-iac/bots/ 現在不可寫。`
  : `IaC store：${iac.dir}`;
render();
