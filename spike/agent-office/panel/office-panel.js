const root = document.createElement("aside");
root.id = "ho-office";
root.innerHTML = `
  <div class="ho-row">
    <h2>Group Chat</h2>
    <button type="button" id="ho-settings-toggle">Hermes 設定</button>
  </div>
  <p class="ho-roles" id="ho-roles">正在讀取角色…</p>
  <ol class="ho-log" id="ho-log"></ol>
  <div class="ho-candidates" id="ho-candidates"></div>
  <form id="ho-composer">
    <label for="ho-draft">對 Office 說話。Enter 送出，Shift+Enter 換行。用 @Role，例如 @QA。</label>
    <textarea id="ho-draft" rows="2" placeholder="@QA 你好"></textarea>
    <button type="submit">送出</button>
  </form>
  <p class="ho-status" id="ho-send-status" role="status"></p>
  <form id="ho-settings" class="ho-settings">
    <label>API base <input id="ho-api-base" type="url" autocomplete="off" /></label>
    <label>Dashboard base <input id="ho-dashboard-base" type="url" autocomplete="off" /></label>
    <label>API 憑證（留白不改） <input id="ho-token" type="password" autocomplete="off" /></label>
    <label>Dashboard 憑證（留白不改） <input id="ho-dashboard-token" type="password" autocomplete="off" /></label>
    <label>clone from <input id="ho-clone" type="text" autocomplete="off" /></label>
    <label>provider <input id="ho-provider" type="text" autocomplete="off" /></label>
    <label>model <input id="ho-model" type="text" autocomplete="off" /></label>
    <label>Group Chat 名稱 <input id="ho-group" type="text" autocomplete="off" /></label>
    <div class="ho-row">
      <button type="submit">儲存設定</button>
      <button type="button" id="ho-probe">檢查連線</button>
      <button type="button" id="ho-clear">清空</button>
    </div>
    <p class="ho-status" id="ho-settings-status" role="status"></p>
  </form>
`;
document.body.append(root);

const log = root.querySelector("#ho-log");
const roles = root.querySelector("#ho-roles");
const candidates = root.querySelector("#ho-candidates");
const draft = root.querySelector("#ho-draft");
const sendStatus = root.querySelector("#ho-send-status");
const settings = root.querySelector("#ho-settings");
const settingsStatus = root.querySelector("#ho-settings-status");

const DELIVERY = {
  pending: "送出中",
  done: "已送達",
  error: "失敗",
  interrupted: "中斷",
  cancelled: "已取消",
};

let seenRevision = -1;

function badge(delivery) {
  const label = DELIVERY[delivery];
  if (!label) return "";
  return `<span class="ho-badge ${delivery}">${label}</span>`;
}

function render(session) {
  if (!session?.office) return;
  if (session.revision != null && session.revision === seenRevision) return;
  seenRevision = session.revision ?? seenRevision;
  const office = session.office;
  const activity = session.activity ?? {};
  const bots = session.bots ?? {};
  roles.textContent = (office.present ?? []).map((role) => {
    const name = bots[role]?.displayName && bots[role].displayName !== role ? `${role} ${bots[role].displayName}` : role;
    const state = activity[role] === "working" ? "處理中" : activity[role] === "waiting" ? "等待" : "在場";
    return `${name} · ${state}`;
  }).join("  ") || "還沒有角色";
  log.replaceChildren();
  for (const message of office.messages ?? []) {
    const item = document.createElement("li");
    const who = message.from === "human" ? "你" : message.from === "system" ? "系統" : message.from;
    item.innerHTML = `<div class="ho-who">${who}${badge(message.delivery)}</div><div></div>`;
    item.querySelector("div:last-child").textContent = message.text;
    log.append(item);
  }
  log.scrollTop = log.scrollHeight;
  candidates.replaceChildren();
  for (const role of office.roleChoices ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `找 ${role}`;
    button.addEventListener("click", () => send(`@HR ${role}`));
    candidates.append(button);
  }
  const pending = office.pendingCandidates;
  if (pending?.options) {
    for (const candidate of pending.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Hire ${candidate.displayName} · ${pending.role}`;
      button.addEventListener("click", () => hire(candidate.id, button));
      candidates.append(button);
    }
  }
}

async function readSession() {
  const response = await fetch("/api/office/session");
  const payload = await response.json();
  if (!response.ok) {
    sendStatus.textContent = payload.message || "讀不到 Group Chat。";
    return;
  }
  render(payload);
}

const SEND_TIMEOUT_MS = 12000;
let inflightText = "";

async function reconcile(text) {
  try {
    const response = await fetch("/api/office/session", { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const payload = await response.json();
    const messages = payload.office?.messages ?? [];
    if (!messages.some((message) => message.from === "human" && message.text === text)) return null;
    seenRevision = -1;
    render(payload);
    return { pending: messages.some((message) => message.delivery === "pending") };
  } catch {
    return null;
  }
}

async function send(text) {
  const previous = draft.value;
  draft.value = "";
  inflightText = text;
  sendStatus.textContent = "送出中…";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch("/api/office/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || !payload?.office) {
      const arrived = await reconcile(text);
      if (arrived) {
        inflightText = "";
        sendStatus.textContent = arrived.pending ? "已送出，回覆還在路上。" : "";
        return;
      }
      draft.value = previous;
      inflightText = "";
      sendStatus.textContent = payload.message || `沒有送出（HTTP ${response.status}）。文字還在。`;
      return;
    }
    inflightText = "";
    sendStatus.textContent = payload.office.messages?.some((message) => message.delivery === "pending") ? "已送出，回覆還在路上。" : "";
    seenRevision = -1;
    render(payload);
  } catch {
    const arrived = await reconcile(text);
    if (arrived) {
      inflightText = "";
      sendStatus.textContent = arrived.pending ? "已送出，回覆還在路上。" : "";
      return;
    }
    draft.value = previous;
    inflightText = "";
    sendStatus.textContent = controller.signal.aborted ? "沒有在時間內送出。文字還在。" : "沒有送到伺服器。文字還在。";
  } finally {
    clearTimeout(timer);
  }
}

async function hire(candidateId, button) {
  button.disabled = true;
  sendStatus.textContent = "Hire 送出中…";
  try {
    const response = await fetch("/api/office/hire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.office) {
      sendStatus.textContent = payload.message || `Hire 沒有完成（HTTP ${response.status}）。`;
      button.disabled = false;
      return;
    }
    sendStatus.textContent = "";
    seenRevision = -1;
    render(payload);
  } catch {
    button.disabled = false;
    sendStatus.textContent = "Hire 沒有送到伺服器。";
  }
}

root.querySelector("#ho-composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = draft.value.trim();
  if (!text) return;
  send(text);
});

draft.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
});

root.querySelector("#ho-settings-toggle").addEventListener("click", () => {
  settings.classList.toggle("open");
});

function settingsBody(extra = {}) {
  return {
    apiBase: root.querySelector("#ho-api-base").value.trim(),
    dashboardBase: root.querySelector("#ho-dashboard-base").value.trim(),
    token: root.querySelector("#ho-token").value,
    dashboardToken: root.querySelector("#ho-dashboard-token").value,
    bot: {
      cloneFrom: root.querySelector("#ho-clone").value.trim(),
      provider: root.querySelector("#ho-provider").value.trim(),
      model: root.querySelector("#ho-model").value.trim(),
    },
    group: { name: root.querySelector("#ho-group").value.trim() },
    ...extra,
  };
}

function fillSettings(payload) {
  root.querySelector("#ho-api-base").value = payload.apiBase || "";
  root.querySelector("#ho-dashboard-base").value = payload.dashboardBase || "";
  root.querySelector("#ho-clone").value = payload.bot?.cloneFrom || "";
  root.querySelector("#ho-provider").value = payload.bot?.provider || "";
  root.querySelector("#ho-model").value = payload.bot?.model || "";
  root.querySelector("#ho-group").value = payload.group?.name || "";
  root.querySelector("#ho-token").value = "";
  root.querySelector("#ho-dashboard-token").value = "";
}

async function loadSettings() {
  const response = await fetch("/api/office/hermes");
  const payload = await response.json();
  if (!response.ok) {
    settingsStatus.textContent = payload.message || "讀不到 Hermes 設定。";
    return;
  }
  fillSettings(payload);
  settingsStatus.textContent = payload.configured ? "已儲存設定。憑證只在伺服器上。" : "尚未設定 Hermes。空著就是 Mock。";
}

settings.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsStatus.textContent = "儲存中…";
  const response = await fetch("/api/office/hermes", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settingsBody()),
  });
  const payload = await response.json();
  if (!response.ok) {
    settingsStatus.textContent = payload.message || "沒有儲存。";
    return;
  }
  fillSettings(payload);
  settingsStatus.textContent = "已儲存。憑證不會回到這個頁面。";
});

root.querySelector("#ho-clear").addEventListener("click", async () => {
  const response = await fetch("/api/office/hermes", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settingsBody({ clearToken: true })),
  });
  const payload = await response.json();
  if (!response.ok) {
    settingsStatus.textContent = payload.message || "沒有清空。";
    return;
  }
  fillSettings(payload);
  settingsStatus.textContent = "已回到 Mock。";
});

root.querySelector("#ho-probe").addEventListener("click", async () => {
  settingsStatus.textContent = "正在檢查連線…";
  const response = await fetch("/api/office/hermes/probe", { method: "POST" });
  const payload = await response.json();
  settingsStatus.textContent = payload.message || payload.mode || payload.state || `HTTP ${response.status}`;
});

const stream = new EventSource("/api/office/events");
stream.onmessage = (event) => {
  try {
    const payload = JSON.parse(event.data);
    render(payload);
    if (inflightText && payload.office?.messages?.some((message) => message.from === "human" && message.text === inflightText)) {
      inflightText = "";
      if (sendStatus.textContent === "送出中…") sendStatus.textContent = "已送出，回覆還在路上。";
    }
  } catch {
    // A bad event does not clear the transcript already on screen.
  }
};
stream.onerror = () => {
  if (sendStatus.textContent === "送出中…") return;
  sendStatus.textContent = "Group Chat 連線中斷，會再試。";
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") readSession().catch(() => {});
});

readSession().catch(() => {
  sendStatus.textContent = "沒有送到伺服器。";
});
loadSettings().catch(() => {
  settingsStatus.textContent = "讀不到 Hermes 設定。";
});
