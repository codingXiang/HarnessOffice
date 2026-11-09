import {
  approveIssue,
  createSession,
  finishMockPr,
  handleHumanMessage,
  hire,
  holdIssue,
  parseAddress,
  startMockCoding,
} from "./office.mjs";
import { commentBody, emptyGithubSettings, findOpencode, normalizeGithubSettings, opencodeCommand, parseGithubCommand, publishComment, pullRequestPlan, repoWorktree, resolveProject } from "./github.mjs";
import { hireWithHermes, normalizeSettings, redactSecrets, streamBotTurn } from "./hermes.mjs";

function freshRecord() {
  return {
    revision: 0,
    office: createSession(),
    bots: {},
    ownedProfiles: [],
    clientIds: {},
    activity: {},
    seq: 0,
    github: { issues: [], assignments: {}, drafts: [], pulls: [], etags: {}, progress: {}, activeProjectId: null, botProjects: {}, choices: [] },
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

export function createOfficeRuntime({ templates, fetchImpl, loadSettings = () => ({}), loadGithub = emptyGithubSettings, onChange } = {}) {
  let record = freshRecord();
  const turns = new Map();
  const hiring = new Set();

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
          { profileName: bot.profileName, sessionId: bot.sessionId, route: bot.route, displayName: bot.displayName },
        ]),
      ),
      activity: { ...record.activity },
      github: {
        issues: record.github?.issues ?? [],
        assignments: record.github?.assignments ?? {},
        drafts: (record.github?.drafts ?? []).filter((draft) => draft.status === "draft"),
        pulls: record.github?.pulls ?? [],
        progress: record.github?.progress ?? {},
        activeProjectId: record.github?.activeProjectId ?? null,
        botProjects: record.github?.botProjects ?? {},
        choices: record.github?.choices ?? [],
      },
      revision: record.revision,
    };
  }

  function ensureGithub() {
    record.github ??= { issues: [], assignments: {}, drafts: [], pulls: [], etags: {}, progress: {}, activeProjectId: null, botProjects: {}, choices: [] };
    record.github.issues ??= [];
    record.github.assignments ??= {};
    record.github.drafts ??= [];
    record.github.pulls ??= [];
    record.github.etags ??= {};
    record.github.progress ??= {};
    record.github.botProjects ??= {};
    record.github.choices ??= [];
  }

  function boot(saved) {
    record = saved ? structuredClone(saved) : freshRecord();
    if (!record.office) record.office = createSession();
    record.bots ??= {};
    record.ownedProfiles ??= [];
    record.clientIds ??= {};
    record.activity ??= {};
    record.github ??= { issues: [], assignments: {}, drafts: [], pulls: [], etags: {}, progress: {}, activeProjectId: null, botProjects: {}, choices: [] };
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
    if (!candidate || record.office.present.includes(pending.role)) {
      note(record.office.present.includes(pending?.role) ? `${pending.role} 已經在 Office 裡。` : "還沒有可以選定的 Candidate。請先 @HR 提出一個 Role，例如 @HR 請幫我 hire FE。");
      return { ok: false, status: 400, session: view() };
    }
    if (hiring.has(candidateId)) {
      note("這個 Candidate 正在建立，請稍候。");
      return { ok: true, status: 202, session: view() };
    }
    hiring.add(candidateId);
    const template = templates[pending.role];
    let outcome;
    try {
      outcome = await hireWithHermes({
      settings: loadSettings(),
      role: pending.role,
      candidateId: candidate.id,
      displayName: candidate.displayName,
      template,
      fetchImpl,
      ownsProfile: (record.ownedProfiles ?? []).includes(candidate.id)
        || Object.values(record.bots).some((bot) => bot.profileName === candidate.id),
    });
    } finally {
      hiring.delete(candidateId);
    }
    if (outcome.ownedProfile) {
      record.ownedProfiles = [...new Set([...(record.ownedProfiles ?? []), outcome.ownedProfile])];
      touch();
    }
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

  function setGithubIssues(issues, etag, projectId = "codingXiang/HarnessOffice") {
    ensureGithub();
    const tagged = issues.map((issue) => ({ ...issue, projectId: issue.projectId || projectId }));
    record.github.issues = record.github.issues.filter((issue) => issue.projectId !== projectId).concat(tagged);
    if (etag) record.github.etags[projectId] = etag;
    touch();
    return view();
  }

  function setActiveProject(projectId, role) {
    ensureGithub();
    record.github.activeProjectId = projectId;
    if (role) record.github.botProjects[role] = projectId;
    record.github.choices = [];
    touch();
    return view();
  }

  async function draftComment(number, role, projectId) {
    ensureGithub();
    const issue = record.github.issues.find((item) => item.number === number && (!projectId || item.projectId === projectId));
    const id = `d${projectId || "repo"}-${number}-${role}`;
    const marker = `harness-office:${id}`;
    const bot = record.bots[role];
    if (!bot?.sessionId || bot.route !== "multiplex") {
      record.office.messages.push({ from: "system", text: `${role} 還沒有 Hermes session，沒有寫 GitHub 草稿。` });
      touch();
      return;
    }
    const result = await streamBotTurn({
      settings: loadSettings(),
      profileName: bot.profileName,
      sessionId: bot.sessionId,
      input: `請為 GitHub issue #${number} ${issue?.title || ""} 寫一則簡短評論。不要說已經寫入 GitHub。`,
      instructions: "這是草稿。不要呼叫 OpenCode，也不要宣稱已經寫入 GitHub。",
      fetchImpl,
    });
    if (!result.ok || !result.text) {
      record.office.messages.push({ from: "system", text: `${role} 沒有寫出 #${number} 的草稿。沒有發布到 GitHub。` });
      touch();
      return;
    }
    const draft = { id, number, projectId: projectId || issue?.projectId || null, role, body: result.text, marker, status: "draft" };
    record.github.drafts = record.github.drafts.filter((item) => item.id !== id).concat(draft);
    const settings = normalizeGithubSettings(loadGithub());
    if (settings.autoPost) {
      await publishDraft(id);
      return;
    }
    record.office.messages.push({ from: "system", text: `${role} 寫了 #${number} 的草稿。按下「發布到 GitHub」才會送出。` });
    touch();
  }

  async function publishDraft(id) {
    ensureGithub();
    const draft = record.github.drafts.find((item) => item.id === id && item.status === "draft");
    if (!draft) return { ok: false, status: 404, session: view(), message: "沒有這份草稿。" };
    const settings = normalizeGithubSettings(loadGithub());
    const project = settings.projects.find((item) => item.id === draft.projectId) || settings.projects[0];
    if (!project || !(project.token || settings.token)) {
      note("尚未設定 GitHub token，草稿沒有送出。");
      return { ok: false, status: 400, session: view(), message: "尚未設定 GitHub token，草稿沒有送出。" };
    }
    const bot = record.bots[draft.role];
    const posted = await publishComment({
      settings: { ...settings, token: project.token || settings.token },
      fetchImpl,
      owner: project.owner,
      repo: project.repo,
      number: draft.number,
      marker: draft.marker,
      body: commentBody(draft.role, bot?.displayName, draft.body, draft.marker),
    });
    if (!posted.ok) {
      note(`GitHub 沒有收下 #${draft.number} 的評論。${posted.detail || ""}`.trim());
      return { ok: false, status: posted.status || 502, session: view(), message: "GitHub 沒有收下這則評論。" };
    }
    draft.status = "posted";
    draft.url = posted.url;
    record.office.messages.push({ from: "system", text: posted.duplicate ? `#${draft.number} 的評論已經在 GitHub 上。` : `已把 ${draft.role} 的評論發布到 #${draft.number}。` });
    touch();
    return { ok: true, session: view() };
  }

  function discardDraft(id) {
    ensureGithub();
    const draft = record.github.drafts.find((item) => item.id === id && item.status === "draft");
    if (!draft) return { ok: false, status: 404, session: view(), message: "沒有這份草稿。" };
    draft.status = "discarded";
    note(`已捨棄 #${draft.number} 的草稿。沒有寫入 GitHub。`);
    return { ok: true, session: view() };
  }

  async function openPullRequest(number) {
    ensureGithub();
    const existing = record.github.pulls.find((item) => item.issue === number && item.url);
    if (existing) return { ok: true, duplicate: true, session: view(), message: `PR 已開：${existing.url}` };
    const assignment = Object.values(record.github.assignments).find((item) => item.number === number && (!item.projectId || item.projectId === record.github.activeProjectId))
      || Object.values(record.github.assignments).find((item) => item.number === number);
    if (!assignment) {
      note(`#${number} 還沒有指派，沒有開 PR。`);
      return { ok: false, status: 400, session: view(), message: `#${number} 還沒有指派，沒有開 PR。` };
    }
    record.github.progress[assignment.role] = "分析中";
    touch();
    const issue = record.github.issues.find((item) => item.number === number && item.projectId === assignment.projectId) || { number, title: assignment.title || `issue ${number}` };
    const project = normalizeGithubSettings(loadGithub()).projects.find((item) => item.id === assignment.projectId);
    const plan = pullRequestPlan(issue, "main");
    if (!plan.ok) {
      record.github.progress[assignment.role] = "失敗";
      note(plan.detail);
      return { ok: false, status: 400, session: view(), message: plan.detail };
    }
    const binary = findOpencode();
    if (!binary) {
      record.github.progress[assignment.role] = "失敗";
      const message = "這台機器沒有 OpenCode（command -v opencode 找不到）。沒有建立 worktree，也沒有推分支。";
      note(message);
      return { ok: false, status: 400, session: view(), message };
    }
    record.github.progress[assignment.role] = "寫程式中";
    touch();
    const worktree = project ? repoWorktree(project.owner, project.repo) : "";
    record.github.pulls.push({ issue: number, projectId: assignment.projectId, branch: plan.branch, url: "", status: "等待確認", command: opencodeCommand(worktree, issue) });
    record.github.progress[assignment.role] = "等待確認";
    note(`OpenCode 會在 ${worktree || "隔離的 worktree"} 跑 ${plan.branch}。還沒有 push。`);
    return { ok: true, session: view() };
  }

  async function postMessage({ text, clientMessageId, wait = true }) {
    const body = String(text ?? "");
    if (!body.trim()) return { ok: false, status: 400, session: view() };
    if (clientMessageId && record.clientIds[clientMessageId]) return { ok: true, duplicate: true, session: view() };
    const githubCommand = parseGithubCommand(body);
    if (githubCommand?.type === "assign") {
      ensureGithub();
      const settings = normalizeGithubSettings(loadGithub());
      const resolved = resolveProject(githubCommand.ref || { number: githubCommand.number }, {
        projects: settings.projects,
        issues: record.github.issues,
        activeProjectId: record.github.activeProjectId,
        botProjectId: record.github.botProjects[githubCommand.role],
      });
      record.office.messages.push({ from: "human", text: body, addressed: githubCommand.by });
      if (resolved.ambiguous) {
        record.github.choices = resolved.ambiguous.map((choice) => ({ ...choice, role: githubCommand.role }));
        record.office.messages.push({ from: "system", text: `#${githubCommand.number} 出現在多個專案。點一個再指派。` });
        touch();
        return { ok: true, session: view() };
      }
      if (!resolved.project) {
        record.office.messages.push({ from: "system", text: `找不到這個專案，沒有指派 #${githubCommand.number}。` });
        touch();
        return { ok: true, session: view() };
      }
      if (!record.office.present.includes(githubCommand.role)) {
        record.office.messages.push({ from: "system", text: `${githubCommand.role} 還不在 Office 裡。沒有指派 #${githubCommand.number}。` });
        touch();
        return { ok: true, session: view() };
      }
      const projectId = resolved.project?.id || settings.projects[0]?.id;
      const issue = record.github.issues.find((item) => item.number === githubCommand.number && item.projectId === projectId);
      const key = `${projectId}#${githubCommand.number}`;
      record.github.assignments[key] = {
        number: githubCommand.number,
        projectId,
        role: githubCommand.role,
        title: issue?.title || `#${githubCommand.number}`,
        url: issue?.url || "",
      };
      record.github.activeProjectId = projectId;
      record.github.botProjects[githubCommand.role] = projectId;
      record.github.choices = [];
      record.activity[githubCommand.role] = "working";
      record.github.progress[githubCommand.role] = `working on #${githubCommand.number}`;
      record.office.messages.push({ from: "system", text: `已把 ${resolved.project?.alias || projectId}#${githubCommand.number} 交給 ${githubCommand.role}。` });
      if (clientMessageId) record.clientIds[clientMessageId] = "github";
      touch();
      const drafting = draftComment(githubCommand.number, githubCommand.role, projectId);
      if (wait) await drafting;
      return { ok: true, session: view() };
    }
    const parsed = parseAddress(body);
    const hireName = parsed?.role === "HR" ? parsed.body.match(/^雇用\s+(.+)$/)?.[1]?.trim() : "";
    if (hireName && record.office.pendingCandidates) {
      const candidate = record.office.pendingCandidates.options.find((item) => item.displayName === hireName);
      if (candidate) {
        if (clientMessageId) record.clientIds[clientMessageId] = "hire";
        return hireCandidate(candidate.id);
      }
    }
    if (parsed?.role === "HR" || (parsed?.hint && !parsed.role)) {
      const result = handleHumanMessage(record.office, body, templates);
      record.office = result.session;
      if (clientMessageId) record.clientIds[clientMessageId] = "mock";
      touch();
      return { ok: true, profile: result.profile, effect: result.effect, session: view() };
    }
    const bot = parsed?.role ? record.bots[parsed.role] : null;
    if (bot && record.office.present.includes(parsed.role)) {
      if (clientMessageId) record.clientIds[clientMessageId] = "live";
      if (bot.route === "multiplex" && bot.sessionId) {
        const pending = deliverLive(parsed, body, null);
        if (!wait) return { ok: true, accepted: true, session: view() };
        return { ok: true, session: await pending };
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
    setGithubIssues,
    setActiveProject,
    publishDraft,
    discardDraft,
    openPullRequest,
    cancel,
    approve: () => mutate(approveIssue),
    hold: () => mutate(holdIssue),
    startCoding: () => mutate(startMockCoding),
    finishCoding: () => mutate(finishMockPr),
  };
}

export function visualSnapshot(sessionView) {
  const office = sessionView.office;
  const names = {};
  for (const [role, bot] of Object.entries(sessionView.bots ?? {})) {
    if (bot?.displayName) names[role] = bot.displayName;
  }
  const lines = [];
  for (const message of office.messages) {
    if (!message.text) continue;
    if (message.from === "human") {
      lines.push({ id: message.id, role: "你", name: "你", text: message.text, activity: "idle", delivery: message.delivery || "done" });
      continue;
    }
    const role = message.from === "system" ? "系統" : message.from;
    const activity = sessionView.activity?.[role] || (message.delivery === "pending" ? "working" : "idle");
    lines.push({ id: message.id, role, name: names[role] || role, text: message.text, activity, delivery: message.delivery || "" });
  }
  const roles = office.present.map((role) => {
    const assignment = Object.values(sessionView.github?.assignments ?? {}).find((item) => item.role === role);
    const last = [...lines].reverse().find((line) => line.role === role);
    return {
      role,
      name: names[role] || role,
      activity: assignment ? "working" : (sessionView.activity?.[role] || "idle"),
      text: assignment ? `working on #${assignment.number}` : (last?.text ?? ""),
      progress: sessionView.github?.progress?.[role] || "",
    };
  });
  return {
    revision: sessionView.revision,
    lines: lines.slice(-40),
    roles,
    issues: sessionView.github?.issues ?? [],
  };
}
