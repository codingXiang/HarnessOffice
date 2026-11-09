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
import { commentBody, DEFAULT_PROJECT_ID, emptyGithubSettings, findOpencode, normalizeGithubSettings, opencodeCommand, parseGithubCommand, parseIssueRef, projectForRepo, publishComment, pullRequestPlan, repoWorktree, resolveProject } from "./github.mjs";
import { hireWithHermes, redactSecrets, streamBotTurn } from "./hermes.mjs";

function emptyGithubState() {
  return { issues: [], assignments: {}, drafts: [], pulls: [], etags: {}, progress: {}, choices: [], unread: false };
}

function emptyRoom(id, name = "HarnessOffice", group = name) {
  return {
    id,
    name,
    group,
    office: createSession(),
    bots: {},
    clientIds: {},
    activity: {},
    runtime: { state: "mock" },
    github: emptyGithubState(),
    switchOffer: null,
  };
}

function freshRecord() {
  return {
    revision: 0,
    seq: 0,
    ownedProfiles: [],
    activeProjectId: DEFAULT_PROJECT_ID,
    projects: { [DEFAULT_PROJECT_ID]: emptyRoom(DEFAULT_PROJECT_ID) },
  };
}

export function migrateRecord(saved, { groupName } = {}) {
  if (!saved || typeof saved !== "object") return freshRecord();
  if (saved.projects && typeof saved.projects === "object" && !saved.office) {
    const projects = saved.projects;
    for (const room of Object.values(projects)) {
      room.office ??= createSession();
      room.bots ??= {};
      room.clientIds ??= {};
      room.activity ??= {};
      room.runtime ??= { state: "mock" };
      room.github ??= emptyGithubState();
      room.github.issues ??= [];
      room.github.assignments ??= {};
      room.github.drafts ??= [];
      room.github.pulls ??= [];
      room.github.etags ??= {};
      room.github.progress ??= {};
      room.github.choices ??= [];
      room.name ||= "HarnessOffice";
      room.group ||= room.name;
    }
    const active = saved.activeProjectId && projects[saved.activeProjectId] ? saved.activeProjectId : Object.keys(projects)[0] || DEFAULT_PROJECT_ID;
    if (!projects[active]) projects[active] = emptyRoom(active);
    return { revision: saved.revision ?? 0, seq: saved.seq ?? 0, ownedProfiles: saved.ownedProfiles ?? [], activeProjectId: active, projects };
  }
  const room = emptyRoom(DEFAULT_PROJECT_ID, groupName || "HarnessOffice", groupName || "HarnessOffice");
  if (saved.office) room.office = saved.office;
  room.bots = saved.bots ?? {};
  room.clientIds = saved.clientIds ?? {};
  room.activity = saved.activity ?? {};
  room.runtime = saved.runtime ?? { state: "mock" };
  room.github = {
    ...emptyGithubState(),
    issues: saved.github?.issues ?? [],
    assignments: saved.github?.assignments ?? {},
    drafts: saved.github?.drafts ?? [],
    pulls: saved.github?.pulls ?? [],
    etags: { ...(saved.github?.etags ?? {}) },
    progress: saved.github?.progress ?? {},
    choices: saved.github?.choices ?? [],
  };
  if (saved.github?.etag) room.github.etags["codingXiang/HarnessOffice"] ??= saved.github.etag;
  return {
    revision: saved.revision ?? 0,
    seq: saved.seq ?? 0,
    ownedProfiles: saved.ownedProfiles ?? [],
    activeProjectId: DEFAULT_PROJECT_ID,
    projects: { [DEFAULT_PROJECT_ID]: room },
  };
}

function stamp(record, current) {
  for (const message of current.office.messages) {
    if (!message.id) message.id = `m${(record.seq += 1)}`;
  }
}

function interruptPending(current) {
  for (const message of current.office.messages) {
    if (message.delivery !== "pending") continue;
    message.delivery = "interrupted";
    message.from = "system";
    message.text = "上一則 Hermes 回覆在重啟時中斷，沒有自動重送。";
  }
}

export function createOfficeRuntime({ templates, fetchImpl, loadSettings = () => ({}), loadGithub = emptyGithubSettings, onChange } = {}) {
  let record = freshRecord();
  const turns = new Map();
  const hiring = new Set();

  function touch(current = room()) {
    stamp(record, current);
    record.revision += 1;
    onChange?.(view(record.activeProjectId));
  }

  function room(projectId) {
    if (projectId && record.projects[projectId]) return record.projects[projectId];
    return record.projects[record.activeProjectId] || Object.values(record.projects)[0];
  }

  function configuredProjects() {
    return normalizeGithubSettings(loadGithub()).projects;
  }

  function ensureConfiguredRooms(removeMissing) {
    const list = configuredProjects();
    for (const item of list) {
      const existing = record.projects[item.id];
      if (!existing) record.projects[item.id] = emptyRoom(item.id, item.name, item.group);
      else {
        existing.name = item.name || existing.name;
        existing.group = item.group || existing.group;
      }
    }
    if (!removeMissing) return;
    const ids = new Set(list.map((item) => item.id));
    for (const id of Object.keys(record.projects)) {
      if (!ids.has(id)) delete record.projects[id];
    }
    if (!record.projects[record.activeProjectId]) record.activeProjectId = list[0]?.id || DEFAULT_PROJECT_ID;
  }

  function view(projectId) {
    const current = room(projectId);
    const settings = normalizeGithubSettings(loadGithub());
    return {
      projectId: current.id,
      projectName: current.name,
      group: current.group,
      projects: Object.values(record.projects).map((item) => ({
        id: item.id,
        name: item.name,
        group: item.group,
        repos: (settings.projects.find((project) => project.id === item.id)?.repos || []).map((repo) => ({
          id: repo.id,
          alias: repo.alias,
          owner: repo.owner,
          repo: repo.repo,
          color: repo.color,
        })),
      })),
      notices: Object.values(record.projects).filter((item) => item.id !== current.id && item.github?.unread).map((item) => ({ projectId: item.id, name: item.name })),
      switchOffer: current.switchOffer,
      office: current.office,
      runtime: current.runtime ?? { state: "mock" },
      bots: Object.fromEntries(
        Object.entries(current.bots).map(([role, bot]) => [
          role,
          { profileName: bot.profileName, sessionId: bot.sessionId, route: bot.route, displayName: bot.displayName },
        ]),
      ),
      activity: { ...current.activity },
      github: {
        issues: current.github?.issues ?? [],
        assignments: current.github?.assignments ?? {},
        drafts: (current.github?.drafts ?? []).filter((draft) => draft.status === "draft"),
        pulls: current.github?.pulls ?? [],
        progress: current.github?.progress ?? {},
        choices: current.github?.choices ?? [],
      },
      revision: record.revision,
    };
  }

  function boot(saved, options = {}) {
    record = migrateRecord(saved, options);
    ensureConfiguredRooms(false);
    record.seq ??= 0;
    record.revision ??= 0;
    for (const current of Object.values(record.projects)) interruptPending(current);
    for (const current of Object.values(record.projects)) stamp(record, current);
    return view();
  }

  function snapshot() {
    return structuredClone(record);
  }

  function note(current, text) {
    current.office.messages.push({ from: "system", text });
    touch(current);
  }

  function instructionsFor(current, role, displayName) {
    const template = templates[role];
    const duties = Array.isArray(template?.responsibilities) ? template.responsibilities.join("；") : "";
    const group = current.group || "HarnessOffice";
    return [
      `你是 HarnessOffice Group Chat 裡的 ${role}，顯示名稱是 ${displayName}。`,
      duties ? `職責：${duties}` : "",
      `這個房間叫 ${group}。用繁體中文回覆這一則。不要呼叫 OpenCode，也不要宣稱已經寫入 GitHub。`,
    ].filter(Boolean).join("\n");
  }

  function scopedCandidate(current, candidateId) {
    return current.id === DEFAULT_PROJECT_ID ? candidateId : `${current.id}--${candidateId}`;
  }

  async function rememberHire(current, candidateId, outcome) {
    const pending = current.office.pendingCandidates;
    const hired = hire(current.office, candidateId, templates, {
      createdBy: outcome.profile.createdBy,
      reason: outcome.reason === "unreachable" ? "unreachable" : outcome.reason === "unconfigured" ? "unconfigured" : "created",
    });
    current.office = hired.session;
    if (outcome.mode === "live" && outcome.profile?.hermes) {
      current.bots[pending.role] = {
        profileName: outcome.profile.hermes.name,
        sessionId: outcome.profile.hermes.sessionId,
        route: outcome.profile.hermes.route,
        displayName: outcome.profile.displayName,
      };
      current.runtime = { state: "live", route: outcome.profile.hermes.route };
      if (outcome.reason === "profile-only") {
        current.office.messages.push({
          from: "system",
          text: "Hermes 已建立這個 Bot profile，但這個 API server 沒有把 /p/<profile>/ 送到該 Bot（multiplex 沒開，或探針無法判斷）。Group Chat 不會假裝已經收到那個 Bot 的回覆。",
        });
      }
    } else {
      current.runtime = { state: outcome.reason === "unreachable" ? "offline" : "mock" };
    }
    touch(current);
    return { ok: true, ...outcome, session: view(current.id) };
  }

  async function hireCandidate(candidateId, projectId) {
    const current = room(projectId);
    const pending = current.office.pendingCandidates;
    const candidate = pending?.options.find((item) => item.id === candidateId) ?? null;
    if (!candidate || current.office.present.includes(pending.role)) {
      note(current, current.office.present.includes(pending?.role) ? `${pending.role} 已經在 Office 裡。` : "還沒有可以選定的 Candidate。請先 @HR 提出一個 Role，例如 @HR 請幫我 hire FE。");
      return { ok: false, status: 400, session: view(current.id) };
    }
    const profileName = scopedCandidate(current, candidate.id);
    const hireKey = `${current.id}:${candidateId}`;
    if (hiring.has(hireKey)) {
      note(current, "這個 Candidate 正在建立，請稍候。");
      return { ok: true, status: 202, session: view(current.id) };
    }
    hiring.add(hireKey);
    const template = templates[pending.role];
    let outcome;
    try {
      outcome = await hireWithHermes({
      settings: loadSettings(),
      role: pending.role,
      candidateId: profileName,
      displayName: candidate.displayName,
      template,
      fetchImpl,
      ownsProfile: (record.ownedProfiles ?? []).includes(profileName)
        || Object.values(current.bots).some((bot) => bot.profileName === profileName),
    });
    } finally {
      hiring.delete(hireKey);
    }
    if (outcome.ownedProfile) {
      record.ownedProfiles = [...new Set([...(record.ownedProfiles ?? []), outcome.ownedProfile])];
      touch(current);
    }
    if (!outcome.ok) {
      const text = outcome.reason === "auth"
        ? redactSecrets(outcome.detail || "Hermes 拒絕了憑證。這次沒有 Hire，也沒有改用 Mock 成功。", loadSettings())
        : `Hermes 沒有建立 Bot。這次沒有 Hire。${outcome.detail ? ` ${redactSecrets(outcome.detail, loadSettings())}` : ""}`;
      note(current, text.trim());
      current.runtime = { state: outcome.reason === "auth" ? "auth" : "live" };
      return { ok: false, status: outcome.reason === "auth" ? 401 : 502, reason: outcome.reason, session: view(current.id) };
    }
    return rememberHire(current, candidateId, outcome);
  }

  async function deliverLive(current, parsed, text, clientMessageId) {
    const bot = current.bots[parsed.role];
    const humanId = `m${(record.seq += 1)}`;
    current.office.messages.push({ id: humanId, from: "human", text, addressed: parsed.role });
    const pendingId = `m${(record.seq += 1)}`;
    current.office.messages.push({
      id: pendingId,
      from: "system",
      text: `${parsed.role} 正在透過 Hermes 回覆…`,
      delivery: "pending",
    });
    if (clientMessageId) current.clientIds[clientMessageId] = pendingId;
    current.activity[parsed.role] = "working";
    touch(current);
    const controller = new AbortController();
    turns.set(pendingId, controller);
    const result = await streamBotTurn({
      settings: loadSettings(),
      profileName: bot.profileName,
      sessionId: bot.sessionId,
      input: parsed.body || text,
      instructions: instructionsFor(current, parsed.role, bot.displayName),
      fetchImpl,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool") current.activity[parsed.role] = "working";
      },
    });
    turns.delete(pendingId);
    const message = current.office.messages.find((item) => item.id === pendingId);
    if (!message || message.delivery === "interrupted") {
      current.activity[parsed.role] = "idle";
      touch(current);
      return view(current.id);
    }
    // The placeholder was already shown. A new id lets the 3D page speak the outcome
    // instead of treating this line as a duplicate of the "still replying" notice.
    message.id = `m${(record.seq += 1)}`;
    if (result.ok) {
      message.from = parsed.role;
      message.text = result.text;
      message.delivery = "done";
      current.activity[parsed.role] = "idle";
    } else if (result.reason === "cancelled") {
      message.from = "system";
      message.text = "這次回覆已取消。沒有把它當成 Hermes 的回覆。";
      message.delivery = "cancelled";
      current.activity[parsed.role] = "idle";
    } else if (result.reason === "auth") {
      message.from = "system";
      message.text = "Hermes 拒絕了憑證。沒有收到回覆，也沒有改用 Mock 成功。";
      message.delivery = "error";
      current.runtime = { state: "auth" };
      current.activity[parsed.role] = "waiting";
    } else if (result.reason === "malformed") {
      message.from = "system";
      message.text = "Hermes 回傳的內容無法讀取。沒有把它當成回覆。";
      message.delivery = "error";
      current.activity[parsed.role] = "waiting";
    } else if (result.reason === "offline" || result.reason === "interrupted") {
      message.from = "system";
      message.text = "Hermes 連線中斷，沒有收到完整回覆。";
      message.delivery = "error";
      current.activity[parsed.role] = "waiting";
    } else {
      message.from = "system";
      message.text = `Hermes 拒絕了這次回覆。${result.detail ? ` ${result.detail}` : ""}`.trim();
      message.delivery = "error";
      current.activity[parsed.role] = "waiting";
    }
    touch(current);
    return view(current.id);
  }

  function roomForRepoId(repoId) {
    const settings = normalizeGithubSettings(loadGithub());
    const owner = settings.projects.find((project) => project.repos.some((repo) => repo.id === repoId || `${repo.owner}/${repo.repo}` === repoId));
    if (!owner) return room();
    if (!record.projects[owner.id]) record.projects[owner.id] = emptyRoom(owner.id, owner.name, owner.group);
    return record.projects[owner.id];
  }

  function repoById(repoId) {
    for (const project of configuredProjects()) {
      const repo = project.repos.find((item) => item.id === repoId || `${item.owner}/${item.repo}` === repoId);
      if (repo) return repo;
    }
    return configuredProjects()[0]?.repos?.[0] || null;
  }

  function setGithubIssues(issues, etag, repoId = "codingXiang/HarnessOffice") {
    const current = roomForRepoId(repoId);
    const tagged = issues.map((issue) => ({ ...issue, projectId: issue.projectId || repoId, repoId, officeProjectId: current.id }));
    current.github.issues = current.github.issues.filter((issue) => issue.repoId !== repoId && issue.projectId !== repoId).concat(tagged);
    if (etag) current.github.etags[repoId] = etag;
    current.github.unread = current.id !== record.activeProjectId;
    touch(current);
    return view(record.activeProjectId);
  }

  function setActiveProject(projectId) {
    if (!record.projects[projectId]) return { ok: false, status: 404, session: view() };
    record.activeProjectId = projectId;
    record.projects[projectId].github.unread = false;
    record.projects[projectId].switchOffer = null;
    touch(record.projects[projectId]);
    return view(projectId);
  }

  function syncProjects(list, { remove = false } = {}) {
    for (const item of list || []) {
      const existing = record.projects[item.id];
      if (!existing) record.projects[item.id] = emptyRoom(item.id, item.name, item.group);
      else {
        if (item.name) existing.name = item.name;
        if (item.group) existing.group = item.group;
      }
    }
    if (remove && list?.length) {
      const ids = new Set(list.map((item) => item.id));
      for (const id of Object.keys(record.projects)) {
        if (!ids.has(id)) delete record.projects[id];
      }
    }
    if (!record.projects[record.activeProjectId]) record.activeProjectId = list?.[0]?.id || DEFAULT_PROJECT_ID;
    touch(room());
    return view(record.activeProjectId);
  }

  function targetRoom(text) {
    const ref = parseIssueRef(text);
    if (!ref) return null;
    const settings = normalizeGithubSettings(loadGithub());
    if (ref.owner && ref.repo) {
      const hit = projectForRepo(settings, ref.owner, ref.repo);
      if (!hit) return null;
      if (!record.projects[hit.id]) record.projects[hit.id] = emptyRoom(hit.id, hit.name, hit.group);
      return record.projects[hit.id];
    }
    if (ref.alias) {
      const hit = settings.projects.find((project) => project.repos.some((repo) => repo.alias.toLowerCase() === ref.alias.toLowerCase()));
      if (!hit) return null;
      if (!record.projects[hit.id]) record.projects[hit.id] = emptyRoom(hit.id, hit.name, hit.group);
      return record.projects[hit.id];
    }
    const holders = Object.values(record.projects).filter((item) => item.github.issues.some((issue) => issue.number === ref.number));
    return holders.length === 1 ? holders[0] : null;
  }

  async function draftComment(current, number, role, repoId) {
    const issue = current.github.issues.find((item) => item.number === number && (!repoId || item.repoId === repoId || item.projectId === repoId));
    const id = `d${current.id}-${repoId || "repo"}-${number}-${role}`;
    const marker = `harness-office:${id}`;
    const bot = current.bots[role];
    if (!bot?.sessionId || bot.route !== "multiplex") {
      current.office.messages.push({ from: "system", text: `${role} 還沒有 Hermes session，沒有寫 GitHub 草稿。` });
      touch(current);
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
      current.office.messages.push({ from: "system", text: `${role} 沒有寫出 #${number} 的草稿。沒有發布到 GitHub。` });
      touch(current);
      return;
    }
    const draft = { id, number, projectId: repoId || issue?.repoId || null, role, body: result.text, marker, status: "draft" };
    current.github.drafts = current.github.drafts.filter((item) => item.id !== id).concat(draft);
    const settings = normalizeGithubSettings(loadGithub());
    if (settings.autoPost) {
      await publishDraft(id);
      return;
    }
    current.office.messages.push({ from: "system", text: `${role} 寫了 #${number} 的草稿。按下「發布到 GitHub」才會送出。` });
    touch(current);
  }

  function findDraft(id) {
    for (const current of Object.values(record.projects)) {
      const draft = current.github.drafts.find((item) => item.id === id && item.status === "draft");
      if (draft) return { current, draft };
    }
    return null;
  }

  async function publishDraft(id) {
    const found = findDraft(id);
    if (!found) return { ok: false, status: 404, session: view(), message: "沒有這份草稿。" };
    const { current, draft } = found;
    const settings = normalizeGithubSettings(loadGithub());
    const repo = repoById(draft.projectId);
    if (!repo || !(repo.token || settings.token)) {
      note(current, "尚未設定 GitHub token，草稿沒有送出。");
      return { ok: false, status: 400, session: view(current.id), message: "尚未設定 GitHub token，草稿沒有送出。" };
    }
    const bot = current.bots[draft.role];
    const posted = await publishComment({
      settings: { ...settings, token: repo.token || settings.token },
      fetchImpl,
      owner: repo.owner,
      repo: repo.repo,
      number: draft.number,
      marker: draft.marker,
      body: commentBody(draft.role, bot?.displayName, draft.body, draft.marker),
    });
    if (!posted.ok) {
      note(current, `GitHub 沒有收下 #${draft.number} 的評論。${posted.detail || ""}`.trim());
      return { ok: false, status: posted.status || 502, session: view(current.id), message: "GitHub 沒有收下這則評論。" };
    }
    draft.status = "posted";
    draft.url = posted.url;
    current.office.messages.push({ from: "system", text: posted.duplicate ? `#${draft.number} 的評論已經在 GitHub 上。` : `已把 ${draft.role} 的評論發布到 #${draft.number}。` });
    touch(current);
    return { ok: true, session: view(current.id) };
  }

  function discardDraft(id) {
    const found = findDraft(id);
    if (!found) return { ok: false, status: 404, session: view(), message: "沒有這份草稿。" };
    found.draft.status = "discarded";
    note(found.current, `已捨棄 #${found.draft.number} 的草稿。沒有寫入 GitHub。`);
    return { ok: true, session: view(found.current.id) };
  }

  async function openPullRequest(number, projectId) {
    const current = room(projectId);
    const existing = current.github.pulls.find((item) => item.issue === number && item.url);
    if (existing) return { ok: true, duplicate: true, session: view(current.id), message: `PR 已開：${existing.url}` };
    const assignment = Object.values(current.github.assignments).find((item) => item.number === number);
    if (!assignment) {
      note(current, `#${number} 還沒有指派，沒有開 PR。`);
      return { ok: false, status: 400, session: view(current.id), message: `#${number} 還沒有指派，沒有開 PR。` };
    }
    current.github.progress[assignment.role] = "分析中";
    touch(current);
    const issue = current.github.issues.find((item) => item.number === number && item.projectId === assignment.projectId) || { number, title: assignment.title || `issue ${number}` };
    const repo = repoById(assignment.projectId);
    const plan = pullRequestPlan(issue, "main");
    if (!plan.ok) {
      current.github.progress[assignment.role] = "失敗";
      note(current, plan.detail);
      return { ok: false, status: 400, session: view(current.id), message: plan.detail };
    }
    const binary = findOpencode();
    if (!binary) {
      current.github.progress[assignment.role] = "失敗";
      const message = "這台機器沒有 OpenCode（command -v opencode 找不到）。沒有建立 worktree，也沒有推分支。";
      note(current, message);
      return { ok: false, status: 400, session: view(current.id), message };
    }
    current.github.progress[assignment.role] = "寫程式中";
    touch(current);
    const worktree = repo ? repoWorktree(repo.owner, repo.repo) : "";
    current.github.pulls.push({ issue: number, projectId: assignment.projectId, branch: plan.branch, url: "", status: "等待確認", command: opencodeCommand(worktree, issue) });
    current.github.progress[assignment.role] = "等待確認";
    note(current, `OpenCode 會在 ${worktree || "隔離的 worktree"} 跑 ${plan.branch}。還沒有 push。`);
    return { ok: true, session: view(current.id) };
  }

  async function postMessage({ text, clientMessageId, wait = true, projectId, typing = false }) {
    const body = String(text ?? "");
    const origin = room(projectId);
    if (!body.trim()) return { ok: false, status: 400, session: view(origin.id) };
    const destination = targetRoom(body);
    if (destination && destination.id !== origin.id) {
      if (typing) {
        origin.switchOffer = { projectId: destination.id, name: destination.name, text: body };
        touch(origin);
        return { ok: true, switchOffer: origin.switchOffer, session: view(origin.id) };
      }
      record.activeProjectId = destination.id;
      origin.switchOffer = null;
    }
    const current = destination && !typing ? destination : origin;
    if (clientMessageId && current.clientIds[clientMessageId]) return { ok: true, duplicate: true, session: view(current.id) };
    const githubCommand = parseGithubCommand(body);
    if (githubCommand?.type === "assign") {
      const settings = normalizeGithubSettings(loadGithub());
      const resolved = resolveProject(githubCommand.ref || { number: githubCommand.number }, {
        projects: settings.projects,
        issues: Object.values(record.projects).flatMap((item) => item.github.issues),
        activeProjectId: current.id,
      });
      current.office.messages.push({ from: "human", text: body, addressed: githubCommand.by });
      if (resolved.ambiguous) {
        current.github.choices = resolved.ambiguous.map((choice) => ({ ...choice, role: githubCommand.role }));
        current.office.messages.push({ from: "system", text: `#${githubCommand.number} 出現在多個群組。點一個再切換。` });
        touch(current);
        return { ok: true, session: view(current.id) };
      }
      if (!resolved.project) {
        current.office.messages.push({ from: "system", text: `找不到這個專案，沒有指派 #${githubCommand.number}。` });
        touch(current);
        return { ok: true, session: view(current.id) };
      }
      if (!current.office.present.includes(githubCommand.role)) {
        current.office.messages.push({ from: "system", text: `${githubCommand.role} 還不在這個群組。沒有指派 #${githubCommand.number}。` });
        touch(current);
        return { ok: true, session: view(current.id) };
      }
      const repo = resolved.repo || resolved.project.repos[0];
      const repoId = repo?.id || `${repo?.owner}/${repo?.repo}`;
      const issue = current.github.issues.find((item) => item.number === githubCommand.number && (item.repoId === repoId || item.projectId === repoId));
      const key = `${repoId}#${githubCommand.number}`;
      current.github.assignments[key] = {
        number: githubCommand.number,
        projectId: repoId,
        role: githubCommand.role,
        title: issue?.title || `#${githubCommand.number}`,
        url: issue?.url || "",
      };
      current.github.choices = [];
      current.activity[githubCommand.role] = "working";
      current.github.progress[githubCommand.role] = `working on #${githubCommand.number}`;
      current.office.messages.push({ from: "system", text: `已把 ${repo?.alias || current.name}#${githubCommand.number} 交給 ${githubCommand.role}。` });
      if (clientMessageId) current.clientIds[clientMessageId] = "github";
      touch(current);
      const drafting = draftComment(current, githubCommand.number, githubCommand.role, repoId);
      if (wait) await drafting;
      return { ok: true, session: view(current.id) };
    }
    const parsed = parseAddress(body);
    const hireName = parsed?.role === "HR" ? parsed.body.match(/^雇用\s+(.+)$/)?.[1]?.trim() : "";
    if (hireName && current.office.pendingCandidates) {
      const candidate = current.office.pendingCandidates.options.find((item) => item.displayName === hireName);
      if (candidate) {
        if (clientMessageId) current.clientIds[clientMessageId] = "hire";
        return hireCandidate(candidate.id, current.id);
      }
    }
    if (parsed?.role === "HR" || (parsed?.hint && !parsed.role)) {
      const result = handleHumanMessage(current.office, body, templates);
      current.office = result.session;
      if (clientMessageId) current.clientIds[clientMessageId] = "mock";
      touch(current);
      return { ok: true, profile: result.profile, effect: result.effect, session: view(current.id) };
    }
    const bot = parsed?.role ? current.bots[parsed.role] : null;
    if (bot && current.office.present.includes(parsed.role)) {
      if (clientMessageId) current.clientIds[clientMessageId] = "live";
      if (bot.route === "multiplex" && bot.sessionId) {
        const pending = deliverLive(current, parsed, body, null);
        if (!wait) return { ok: true, accepted: true, session: view(current.id) };
        return { ok: true, session: await pending };
      }
      current.office.messages.push({ from: "human", text: body, addressed: parsed.role });
      current.office.messages.push({
        from: "system",
        text: "這個 Bot profile 在 Hermes，但這個 API server 沒有把對話送到 /p/<profile>/。沒有改用 Mock 回覆。",
      });
      touch(current);
      return { ok: true, session: view(current.id) };
    }
    const result = handleHumanMessage(current.office, body, templates);
    current.office = result.session;
    if (clientMessageId) current.clientIds[clientMessageId] = "mock";
    touch(current);
    return { ok: true, profile: result.profile, effect: result.effect, session: view(current.id) };
  }

  async function cancel(messageId) {
    const controller = turns.get(messageId);
    if (!controller) return { ok: false, status: 404, session: view() };
    controller.abort();
    return { ok: true, session: view() };
  }

  function mutate(fn, projectId) {
    const current = room(projectId);
    const result = fn(current.office);
    current.office = result.session;
    touch(current);
    return { ok: true, session: view(current.id) };
  }

  return {
    boot,
    snapshot,
    view,
    hireCandidate,
    postMessage,
    setGithubIssues,
    setActiveProject,
    syncProjects,
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
