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
    <textarea id="ho-draft" rows="2" placeholder="用 @Role 說話"></textarea>
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

let confirmed = null;
let outbox = null;

function lineItem(who, text, delivery) {
  const item = document.createElement("li");
  const head = document.createElement("div");
  head.className = "ho-who";
  head.textContent = who;
  if (delivery) head.append(badgeNode(delivery));
  const body = document.createElement("div");
  body.textContent = text;
  item.append(head, body);
  return item;
}

function badgeNode(delivery) {
  const label = DELIVERY[delivery];
  if (!label) return document.createTextNode("");
  const node = document.createElement("span");
  node.className = `ho-badge ${delivery}`;
  node.textContent = label;
  return node;
}

function render() {
  const office = confirmed?.office ?? { messages: [], present: [] };
  const activity = confirmed?.activity ?? {};
  const bots = confirmed?.bots ?? {};
  roles.textContent = (office.present ?? []).map((role) => {
    const name = bots[role]?.displayName && bots[role].displayName !== role ? `${role} ${bots[role].displayName}` : role;
    const state = activity[role] === "working" ? "處理中" : activity[role] === "waiting" ? "等待" : "在場";
    return `${name} · ${state}`;
  }).join("  ") || "還沒有角色";
  log.replaceChildren();
  for (const message of office.messages ?? []) {
    const who = message.from === "human" ? "你" : message.from === "system" ? "系統" : message.from;
    log.append(lineItem(who, message.text, message.delivery));
  }
  if (outbox) {
    const item = lineItem("你", outbox.text, "");
    item.className = "ho-unconfirmed";
    const mark = document.createElement("span");
    mark.className = "ho-badge pending";
    mark.textContent = outbox.state === "failed" ? "未寫入伺服器" : "尚未寫入伺服器";
    item.querySelector(".ho-who").append(mark);
    if (outbox.state === "failed") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "再試一次";
      retry.addEventListener("click", () => send(outbox.text));
      item.append(retry);
    }
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

function adopt(session) {
  if (!session?.office) return false;
  confirmed = session;
  if (outbox && (session.office.messages ?? []).some((message) => message.from === "human" && message.text === outbox.text)) {
    outbox = null;
  }
  render();
  return true;
}

async function readSession() {
  const response = await fetch("/api/office/session", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    sendStatus.textContent = payload.message || "讀不到 Group Chat。";
    return null;
  }
  adopt(payload);
  return payload;
}

const SEND_TIMEOUT_MS = 12000;

function stored(session, text) {
  return (session?.office?.messages ?? []).some((message) => message.from === "human" && message.text === text);
}

async function confirmSend(text) {
  const response = await fetch("/api/office/session", { cache: "no-store", signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!stored(payload, text)) return null;
  adopt(payload);
  return payload;
}

function failSend(text, detail) {
  outbox = { text, state: "failed" };
  draft.value = text;
  sendStatus.textContent = detail;
  render();
}

function withTimeout(work, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
    Promise.resolve().then(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function send(text) {
  outbox = { text, state: "pending" };
  draft.value = "";
  sendStatus.textContent = "送出中…";
  render();
  let finished = false;
  const controller = new AbortController();
  const finish = (detail) => {
    if (finished) return;
    finished = true;
    clearTimeout(hard);
    controller.abort();
    if (detail) failSend(text, detail);
  };
  const hard = setTimeout(() => {
    finish("沒有在時間內送出。文字還在，可以再試一次。");
    confirmSend(text).then((session) => {
      if (!session) return;
      outbox = null;
      draft.value = "";
      sendStatus.textContent = (session.office.messages ?? []).some((message) => message.delivery === "pending")
        ? "已送出，回覆還在路上。"
        : "";
      render();
    }).catch(() => {});
  }, SEND_TIMEOUT_MS);
  try {
    const session = await withTimeout(async () => {
      const response = await fetch("/api/office/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        cache: "no-store",
        signal: controller.signal,
      });
      await response.json().catch(() => null);
      return confirmSend(text);
    }, SEND_TIMEOUT_MS);
    if (finished) return;
    if (!session) {
      finish("伺服器沒有收下這則。文字還在，可以再試一次。");
      return;
    }
    finished = true;
    clearTimeout(hard);
    sendStatus.textContent = (session.office.messages ?? []).some((message) => message.delivery === "pending")
      ? "已送出，回覆還在路上。"
      : "";
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || controller.signal.aborted;
    finish(timedOut ? "沒有在時間內送出。文字還在，可以再試一次。" : "沒有送到伺服器。文字還在，可以再試一次。");
  }
}

async function hire(candidateId, button) {
  button.disabled = true;
  sendStatus.textContent = "Hire 送出中…";
  let finished = false;
  const done = (detail) => {
    if (finished) return;
    finished = true;
    clearTimeout(hard);
    button.disabled = false;
    sendStatus.textContent = detail;
  };
  const hard = setTimeout(() => done("Hire 沒有在時間內完成。可以再試一次。"), SEND_TIMEOUT_MS);
  try {
    const response = await withTimeout(() => fetch("/api/office/hire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ candidateId }),
    }), SEND_TIMEOUT_MS);
    const payload = await response.json();
    if (!response.ok || !payload?.office) {
      done(payload.message || `Hire 沒有完成（HTTP ${response.status}）。`);
      return;
    }
    const session = await readSession();
    done(session ? "" : "Hire 的結果還沒從伺服器讀回。");
  } catch {
    done("Hire 沒有送到伺服器。");
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
    adopt(JSON.parse(event.data));
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

function watchBuild() {
  const loaded = document.querySelector('meta[name="ho-build"]')?.content || "";
  if (!loaded) return;
  const look = async () => {
    try {
      const response = await fetch("/api/office/build", { cache: "no-store" });
      const body = await response.json();
      if (!body.id || body.id === loaded || document.querySelector("#ho-reload")) return;
      const note = document.createElement("p");
      note.id = "ho-reload";
      note.className = "ho-status";
      note.textContent = "這頁有新版本。";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "重新載入";
      button.addEventListener("click", () => location.reload());
      note.append(button);
      root.prepend(note);
    } catch {
      // The next look tries again. An old page keeps working until then.
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") look();
  });
  setInterval(look, 30000);
  look();
}

readSession().catch(() => {
  sendStatus.textContent = "沒有送到伺服器。";
});
watchBuild();
loadSettings().catch(() => {
  settingsStatus.textContent = "讀不到 Hermes 設定。";
});
