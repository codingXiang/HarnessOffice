const root = document.createElement("aside");
root.id = "ho-office";
root.innerHTML = `
  <div class="ho-row">
    <h2>Group Chat</h2>
    <button type="button" id="ho-settings-toggle">Hermes 設定</button>
  </div>
  <p class="ho-roles" id="ho-roles">正在讀取角色…</p>
  <div id="ho-github"></div>
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
    <label>GitHub owner/repo <input id="ho-gh-repo" type="text" autocomplete="off" placeholder="codingXiang/HarnessOffice" /></label>
    <label>GitHub token（留白不改） <input id="ho-gh-token" type="password" autocomplete="off" /></label>
    <label>Issue 輪詢秒數 <input id="ho-gh-poll" type="number" min="15" max="600" /></label>
    <label>標籤對應 role（JSON） <input id="ho-gh-labels" type="text" autocomplete="off" /></label>
    <label><input id="ho-gh-auto" type="checkbox" /> 評論自動發布到 GitHub（預設關閉）</label>
    <div class="ho-row">
      <button type="button" id="ho-gh-save">儲存 GitHub</button>
      <button type="button" id="ho-gh-test">測試連線</button>
      <button type="button" id="ho-gh-refresh">重新整理 issues</button>
    </div>
    <p class="ho-status" id="ho-gh-status"></p>
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
    const progress = confirmed?.github?.progress?.[role];
    return `${name} · ${state}${progress ? ` · ${progress}` : ""}`;
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
  const offered = pending?.role && !(office.present ?? []).includes(pending.role) ? pending.options?.[0] : null;
  const hireButton = document.createElement("button");
  hireButton.type = "button";
  hireButton.id = "ho-hire";
  if (offered) {
    hireButton.textContent = `Hire ${offered.displayName} · ${pending.role}`;
    hireButton.addEventListener("click", () => hire(offered.id, hireButton));
  } else {
    hireButton.textContent = "Hire";
    hireButton.disabled = true;
  }
  const hireHint = document.createElement("p");
  hireHint.className = "ho-status";
  hireHint.textContent = offered
    ? `按下 Hire 就建立 ${pending.role} 的 Hermes Bot。`
    : "請先 @HR 提出 Candidate，例如 @HR 請幫我 hire FE。";
  candidates.append(hireButton, hireHint);
  renderGithub(confirmed?.github);
}

function renderGithub(github) {
  const box = root.querySelector("#ho-github");
  box.replaceChildren();
  const issues = github?.issues ?? [];
  if (issues.length === 0 && !(github?.drafts ?? []).length) return;
  const title = document.createElement("p");
  title.className = "ho-status";
  title.textContent = "GitHub issues";
  box.append(title);
  for (const issue of issues) {
    const row = document.createElement("p");
    const link = document.createElement("a");
    link.href = issue.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `#${issue.number} ${issue.title}`;
    row.append(link);
    if (issue.role) row.append(document.createTextNode(` · ${issue.role}`));
    box.append(row);
  }
  for (const draft of github?.drafts ?? []) {
    const row = document.createElement("div");
    const text = document.createElement("p");
    text.textContent = `${draft.role} 的 #${draft.number} 草稿：${draft.body}`;
    const publish = document.createElement("button");
    publish.type = "button";
    publish.textContent = "發布到 GitHub";
    publish.addEventListener("click", () => githubAction(`/api/office/github/drafts/${encodeURIComponent(draft.id)}/publish`));
    const discard = document.createElement("button");
    discard.type = "button";
    discard.textContent = "捨棄";
    discard.addEventListener("click", () => githubAction(`/api/office/github/drafts/${encodeURIComponent(draft.id)}/discard`));
    const pr = document.createElement("button");
    pr.type = "button";
    pr.textContent = "開 PR";
    pr.addEventListener("click", () => githubAction(`/api/office/github/issues/${draft.number}/pr`));
    row.append(text, publish, discard, pr);
    box.append(row);
  }
}

async function githubAction(path) {
  sendStatus.textContent = "處理中";
  try {
    const response = await withTimeout(() => fetch(path, { method: "POST", cache: "no-store" }), 20000);
    const payload = await response.json().catch(() => ({}));
    if (payload?.office) adopt(payload);
    else await readSession();
    sendStatus.textContent = payload.message || (response.ok ? "" : "GitHub 沒有完成這一步。");
  } catch {
    sendStatus.textContent = "GitHub 沒有在時間內完成。";
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

const HIRE_TIMEOUT_MS = 45000;

async function hire(candidateId, button) {
  const pending = confirmed?.office?.pendingCandidates;
  const allowed = pending?.options?.some((item) => item.id === candidateId)
    && !(confirmed.office.present ?? []).includes(pending.role);
  if (!allowed) {
    sendStatus.textContent = "請先 @HR 提出 Candidate，例如 @HR 請幫我 hire FE。";
    return;
  }
  button.disabled = true;
  sendStatus.textContent = "建立中";
  let finished = false;
  const done = (detail) => {
    if (finished) return;
    finished = true;
    clearTimeout(hard);
    button.disabled = false;
    sendStatus.textContent = detail;
  };
  const hard = setTimeout(() => done("建立還在進行。可以再按一次 Hire，不會重複建立 profile。"), HIRE_TIMEOUT_MS);
  try {
    const response = await withTimeout(() => fetch("/api/office/hire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ candidateId }),
    }), HIRE_TIMEOUT_MS);
    const payload = await response.json().catch(() => ({}));
    if (payload?.office) adopt(payload);
    if (!response.ok) {
      done(payload.message || "現在沒有可以 Hire 的 Candidate。請先 @HR 提出一個 Role。");
      return;
    }
    const session = await readSession();
    const present = session?.office?.present ?? [];
    done(present.includes(pending.role) ? "" : "建立的結果還沒從伺服器讀回。可以再按一次 Hire。");
  } catch {
    const session = await readSession().catch(() => null);
    if ((session?.office?.present ?? []).includes(pending.role)) {
      done("");
      return;
    }
    done("建立沒有在時間內完成。可以再按一次 Hire，不會重複建立 profile。");
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
  settingsStatus.textContent = payload.message || payload.mode || payload.state || "連線檢查沒有完成。";
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

async function loadGithub() {
  const response = await fetch("/api/office/github", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) return;
  root.querySelector("#ho-gh-repo").value = `${payload.owner || "codingXiang"}/${payload.repo || "HarnessOffice"}`;
  root.querySelector("#ho-gh-poll").value = payload.pollSeconds || 60;
  root.querySelector("#ho-gh-labels").value = JSON.stringify(payload.labels || {});
  root.querySelector("#ho-gh-auto").checked = payload.autoPost === true;
  root.querySelector("#ho-gh-token").value = "";
  root.querySelector("#ho-gh-status").textContent = payload.configured ? "GitHub 已設定。token 只在伺服器上。" : "尚未設定 GitHub token。";
}

root.querySelector("#ho-gh-save").addEventListener("click", async () => {
  const [owner, repo] = root.querySelector("#ho-gh-repo").value.split("/");
  let labels = {};
  try {
    labels = JSON.parse(root.querySelector("#ho-gh-labels").value || "{}");
  } catch {
    root.querySelector("#ho-gh-status").textContent = "標籤對應不是 JSON。";
    return;
  }
  const response = await fetch("/api/office/github", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      owner: (owner || "").trim(),
      repo: (repo || "").trim(),
      token: root.querySelector("#ho-gh-token").value,
      pollSeconds: Number(root.querySelector("#ho-gh-poll").value),
      autoPost: root.querySelector("#ho-gh-auto").checked,
      labels,
    }),
  });
  const payload = await response.json();
  root.querySelector("#ho-gh-token").value = "";
  root.querySelector("#ho-gh-status").textContent = payload.configured ? "已儲存。token 不會回到這個頁面。" : (payload.message || "已儲存，尚未設定 token。");
});

root.querySelector("#ho-gh-test").addEventListener("click", async () => {
  root.querySelector("#ho-gh-status").textContent = "正在測試 GitHub…";
  const response = await fetch("/api/office/github/test", { method: "POST", cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  root.querySelector("#ho-gh-status").textContent = payload.fullName
    ? `${payload.fullName} · ${JSON.stringify(payload.permissions || {})}`
    : (payload.detail || "GitHub 連線沒有完成。");
});

root.querySelector("#ho-gh-refresh").addEventListener("click", () => githubAction("/api/office/github/refresh"));

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
loadGithub().catch(() => {
  root.querySelector("#ho-gh-status").textContent = "讀不到 GitHub 設定。";
});
