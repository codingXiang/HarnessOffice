import {
  approveIssue,
  createSession,
  finishMockPr,
  handleHumanMessage,
  hire,
  holdIssue,
  parseAddress,
  roleMentioned,
  startMockCoding,
} from "./office.mjs";
import { hireWithHermes, normalizeSettings, redactSecrets, streamBotTurn } from "./hermes.mjs";

function freshRecord() {
  return {
    revision: 0,
    office: createSession(),
    bots: {},
    clientIds: {},
    activity: {},
    seq: 0,
  };
}

function stamp(record) {
  for (const message of record.office.messages) {
    if (!message.id) message.id = `m${(record.seq += 1)}`;
  }
}

function interruptPending(record) {
  let changed = false;
  for (const message of record.office.messages) {
    if (message.delivery !== "pending") continue;
    message.delivery = "interrupted";
    message.from = "system";
    message.text = "上一則 Hermes 回覆在重啟時中斷，沒有自動重送。";
    changed = true;
  }
  if (changed) record.revision += 1;
}

export function createOfficeRuntime({ templates, fetchImpl, loadSettings, onChange } = {}) {
  let record = freshRecord();
  const turns = new Map();

  function touch() {
    stamp(record);
    record.revision += 1;
    onChange?.(view());
  }

  function view() {
    return {
      office: record.office,
      runtime: record.runtime ?? { state: "mock" },
      bots: Object.fromEntries(
        Object.entries(record.bots).map(([role, bot]) => [
          role,
          { profileName: bot.profileName, sessionId: bot.sessionId, route: bot.route },
        ]),
      ),
      activity: { ...record.activity },
      revision: record.revision,
    };
  }

  function boot(saved) {
    record = saved ? structuredClone(saved) : freshRecord();
    if (!record.office) record.office = createSession();
    record.bots ??= {};
    record.clientIds ??= {};
    record.activity ??= {};
    record.seq ??= 0;
    record.revision ??= 0;
    interruptPending(record);
    stamp(record);
    return view();
  }

  function snapshot() {
    return structuredClone(record);
  }

  function note(text) {
    record.office.messages.push({ from: "system", text });
    touch();
  }

  function instructionsFor(role, displayName) {
    const template = templates[role];
    const settings = normalizeSettings(loadSettings());
    const duties = Array.isArray(template?.responsibilities) ? template.responsibilities.join("；") : "";
    const group = settings.group.name || "HarnessOffice";
    return [
      `你是 HarnessOffice Group Chat 裡的 ${role}，顯示名稱是 ${displayName}。`,
      duties ? `職責：${duties}` : "",
      `這個房間叫 ${group}。用繁體中文回覆這一則。不要呼叫 OpenCode，也不要宣稱已經寫入 GitHub。`,
    ].filter(Boolean).join("\n");
  }

  async function rememberHire(candidateId, outcome) {
    const pending = record.office.pendingCandidates;
    const hired = hire(record.office, candidateId, templates, {
      createdBy: outcome.profile.createdBy,
      reason: outcome.reason === "unreachable" ? "unreachable" : outcome.reason === "unconfigured" ? "unconfigured" : "created",
    });
    record.office = hired.session;
    if (outcome.mode === "live" && outcome.profile?.hermes) {
      record.bots[pending.role] = {
        profileName: outcome.profile.hermes.name,
        sessionId: outcome.profile.hermes.sessionId,
        route: outcome.profile.hermes.route,
        displayName: outcome.profile.displayName,
      };
      record.runtime = { state: "live", route: outcome.profile.hermes.route };
      if (outcome.reason === "profile-only") {
        record.office.messages.push({
          from: "system",
          text: "Hermes 已建立這個 Bot profile，但這個 API server 沒有把 /p/<profile>/ 送到該 Bot（multiplex 沒開，或探針無法判斷）。Group Chat 不會假裝已經收到那個 Bot 的回覆。",
        });
      }
    } else {
      record.runtime = { state: outcome.reason === "unreachable" ? "offline" : "mock" };
    }
    touch();
    return { ok: true, ...outcome, session: view() };
  }

  async function hireCandidate(candidateId) {
    const pending = record.office.pendingCandidates;
    const candidate = pending?.options.find((item) => item.id === candidateId) ?? null;
    if (!candidate) {
      note("還沒有可以選定的 Candidate。");
      return { ok: false, status: 400, session: view() };
    }
    const template = templates[pending.role];
    const outcome = await hireWithHermes({
      settings: loadSettings(),
      role: pending.role,
      candidateId: candidate.id,
      displayName: candidate.displayName,
      template,
      fetchImpl,
    });
    if (!outcome.ok) {
      const text = outcome.reason === "auth"
        ? redactSecrets(outcome.detail || "Hermes 拒絕了憑證。這次沒有 Hire，也沒有改用 Mock 成功。", loadSettings())
        : `Hermes 沒有建立 Bot。這次沒有 Hire。${outcome.detail ? ` ${redactSecrets(outcome.detail, loadSettings())}` : ""}`;
      note(text.trim());
      record.runtime = { state: outcome.reason === "auth" ? "auth" : "live" };
      return { ok: false, status: outcome.reason === "auth" ? 401 : 502, reason: outcome.reason, session: view() };
    }
    return rememberHire(candidateId, outcome);
  }

  async function deliverLive(parsed, text, clientMessageId) {
    const bot = record.bots[parsed.role];
    const humanId = `m${(record.seq += 1)}`;
    record.office.messages.push({ id: humanId, from: "human", text, addressed: parsed.role });
    const pendingId = `m${(record.seq += 1)}`;
    record.office.messages.push({
      id: pendingId,
      from: "system",
      text: `${parsed.role} 正在透過 Hermes 回覆…`,
      delivery: "pending",
    });
    if (clientMessageId) record.clientIds[clientMessageId] = pendingId;
    record.activity[parsed.role] = "working";
    touch();
    const controller = new AbortController();
    turns.set(pendingId, controller);
    const result = await streamBotTurn({
      settings: loadSettings(),
      profileName: bot.profileName,
      sessionId: bot.sessionId,
      input: parsed.body || text,
      instructions: instructionsFor(parsed.role, bot.displayName),
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool") record.activity[parsed.role] = "working";
      },
    });
    turns.delete(pendingId);
    const message = record.office.messages.find((item) => item.id === pendingId);
    if (!message || message.delivery === "interrupted") {
      record.activity[parsed.role] = "idle";
      touch();
      return view();
    }
    // The placeholder was already shown. A new id lets the 3D page speak the outcome
    // instead of treating this line as a duplicate of the "still replying" notice.
    message.id = `m${(record.seq += 1)}`;
    if (result.ok) {
      message.from = parsed.role;
      message.text = result.text;
      message.delivery = "done";
      record.activity[parsed.role] = "idle";
    } else if (result.reason === "cancelled") {
      message.from = "system";
      message.text = "這次回覆已取消。沒有把它當成 Hermes 的回覆。";
      message.delivery = "cancelled";
      record.activity[parsed.role] = "idle";
    } else if (result.reason === "auth") {
      message.from = "system";
      message.text = "Hermes 拒絕了憑證。沒有收到回覆，也沒有改用 Mock 成功。";
      message.delivery = "error";
      record.runtime = { state: "auth" };
      record.activity[parsed.role] = "waiting";
    } else if (result.reason === "malformed") {
      message.from = "system";
      message.text = "Hermes 回傳的內容無法讀取。沒有把它當成回覆。";
      message.delivery = "error";
      record.activity[parsed.role] = "waiting";
    } else if (result.reason === "offline" || result.reason === "interrupted") {
      message.from = "system";
      message.text = "Hermes 連線中斷，沒有收到完整回覆。";
      message.delivery = "error";
      record.activity[parsed.role] = "waiting";
    } else {
      message.from = "system";
      message.text = `Hermes 拒絕了這次回覆。${result.detail ? ` ${result.detail}` : ""}`.trim();
      message.delivery = "error";
      record.activity[parsed.role] = "waiting";
    }
    touch();
    return view();
  }

  async function postMessage({ text, clientMessageId }) {
    const body = String(text ?? "");
    if (!body.trim()) return { ok: false, status: 400, session: view() };
    if (clientMessageId && record.clientIds[clientMessageId]) return { ok: true, duplicate: true, session: view() };
    const parsed = parseAddress(body);
    const hireName = parsed?.role === "HR" ? parsed.body.match(/^雇用\s+(.+)$/)?.[1]?.trim() : "";
    if (hireName && record.office.pendingCandidates) {
      const candidate = record.office.pendingCandidates.options.find((item) => item.displayName === hireName);
      if (candidate) {
        if (clientMessageId) record.clientIds[clientMessageId] = "hire";
        return hireCandidate(candidate.id);
      }
    }
    const askingCandidates = parsed?.role === "HR" && roleMentioned(parsed.body) && !hireName;
    const bot = parsed ? record.bots[parsed.role] : null;
    if (bot && !askingCandidates && record.office.present.includes(parsed.role)) {
      if (clientMessageId) record.clientIds[clientMessageId] = "live";
      if (bot.route === "multiplex" && bot.sessionId) {
        const session = await deliverLive(parsed, body, null);
        return { ok: true, session };
      }
      record.office.messages.push({ from: "human", text: body, addressed: parsed.role });
      record.office.messages.push({
        from: "system",
        text: "這個 Bot profile 在 Hermes，但這個 API server 沒有把對話送到 /p/<profile>/。沒有改用 Mock 回覆。",
      });
      touch();
      return { ok: true, session: view() };
    }
    const result = handleHumanMessage(record.office, body, templates);
    record.office = result.session;
    if (clientMessageId) record.clientIds[clientMessageId] = "mock";
    touch();
    return { ok: true, profile: result.profile, effect: result.effect, session: view() };
  }

  async function cancel(messageId) {
    const controller = turns.get(messageId);
    if (!controller) return { ok: false, status: 404, session: view() };
    controller.abort();
    return { ok: true, session: view() };
  }

  function mutate(fn) {
    const result = fn(record.office);
    record.office = result.session;
    touch();
    return { ok: true, session: view() };
  }

  return {
    boot,
    snapshot,
    view,
    hireCandidate,
    postMessage,
    cancel,
    approve: () => mutate(approveIssue),
    hold: () => mutate(holdIssue),
    startCoding: () => mutate(startMockCoding),
    finishCoding: () => mutate(finishMockPr),
  };
}

export function visualSnapshot(sessionView) {
  const office = sessionView.office;
  const lines = [];
  for (const message of office.messages) {
    if (!message.text || message.from === "human") continue;
    const role = message.from === "system" ? "系統" : message.from;
    const activity = sessionView.activity?.[role] || (message.delivery === "pending" ? "working" : "idle");
    lines.push({ id: message.id, role, text: message.text, activity });
  }
  const roles = office.present.map((role) => {
    const last = [...lines].reverse().find((line) => line.role === role);
    return {
      role,
      activity: sessionView.activity?.[role] || "idle",
      text: last?.text ?? "",
    };
  });
  return { revision: sessionView.revision, lines: lines.slice(-40), roles };
}
