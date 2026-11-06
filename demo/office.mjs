export const HIREABLE_ROLES = ["PM", "Tech Lead", "FE", "BE", "QA"];

export const MOCK_CANDIDATES = {
  PM: [
    { id: "pm-lin", displayName: "林可", blurb: "把含糊的需求收成可以核准的 Issue。" },
    { id: "pm-zhou", displayName: "周衡", blurb: "先問驗收條件，再讓人決定。" },
    { id: "pm-xu", displayName: "許安", blurb: "同一個 Group Chat 裡把範圍講完。" },
  ],
  "Tech Lead": [
    { id: "tl-chen", displayName: "陳硯", blurb: "核准之後才把工作拆給 FE 與 BE。" },
    { id: "tl-gao", displayName: "高朗", blurb: "不在場的 Engineer 不會被憑空分派。" },
    { id: "tl-song", displayName: "宋析", blurb: "分派完才進入寫程式。" },
  ],
  FE: [
    { id: "fe-wu", displayName: "吳像素", blurb: "負責 Office 的畫面。" },
    { id: "fe-li", displayName: "李繪", blurb: "負責畫面上的狀態。" },
    { id: "fe-zhang", displayName: "張介", blurb: "負責人看得到的那一層。" },
  ],
  BE: [
    { id: "be-huang", displayName: "黃渠", blurb: "負責服務與資料。" },
    { id: "be-cai", displayName: "蔡庫", blurb: "負責畫面背後的資料。" },
    { id: "be-ma", displayName: "馬埠", blurb: "負責請求怎麼被記住。" },
  ],
  QA: [
    { id: "qa-he", displayName: "何驗", blurb: "負責品質。這個 demo 沒有 QA 關卡。" },
    { id: "qa-zheng", displayName: "鄭測", blurb: "看成品算不算做到。" },
    { id: "qa-pan", displayName: "潘關", blurb: "問驗收條件有沒有被滿足。" },
  ],
};

export function createSession() {
  return {
    present: ["HR"],
    messages: [
      {
        from: "HR",
        text: "我是 HR，開場就在。要 Candidate 請 @HR，並說 Role：PM、Tech Lead、FE、BE 或 QA。選定之前不會 Hire。",
      },
    ],
    pendingCandidates: null,
    issue: null,
    assignments: [],
    phase: "idle",
    mockPr: null,
  };
}

export function parseAddress(text) {
  const match = String(text).trim().match(/^@(Tech Lead|HR|PM|FE|BE|QA)(?:\s+|$)([\s\S]*)$/);
  if (!match) return null;
  return { role: match[1], body: match[2].trim() };
}

export function roleMentioned(body) {
  return ["Tech Lead", "PM", "FE", "BE", "QA"].find((role) => body.includes(role)) ?? null;
}

function clone(session) {
  return structuredClone(session);
}

export function requestCandidates(session, role) {
  const next = clone(session);
  if (!HIREABLE_ROLES.includes(role)) {
    next.messages.push({
      from: "HR",
      text: "我只能為 PM、Tech Lead、FE、BE、QA 提出 Candidate。",
    });
    return { session: next, candidates: null };
  }
  if (next.present.includes(role)) {
    next.messages.push({ from: "HR", text: `${role} 已經在 Office 裡了。` });
    next.pendingCandidates = null;
    return { session: next, candidates: null };
  }
  const options = MOCK_CANDIDATES[role].map((candidate) => ({ ...candidate }));
  next.pendingCandidates = { role, options };
  next.messages.push({
    from: "HR",
    text: `這是 ${role} 的 Candidate（Mock mode，沒有呼叫模型，也沒有 OpenCode）。選定之前不會 Hire。`,
  });
  return { session: next, candidates: options };
}

export function hire(session, candidateId, templates, options = {}) {
  const next = clone(session);
  const pending = next.pendingCandidates;
  const candidate = pending?.options.find((item) => item.id === candidateId) ?? null;
  if (!candidate) {
    next.messages.push({ from: "system", text: "還沒有可以選定的 Candidate。" });
    return { session: next, profile: null };
  }
  const template = templates?.[pending.role];
  if (!template || template.runtime !== "hermes" || template.openCode !== false) {
    next.messages.push({ from: "system", text: `沒有 ${pending.role} 的 Hermes Bot profile 範本。` });
    return { session: next, profile: null };
  }
  const createdBy = options.createdBy ?? "mock-hermes";
  const reason = options.reason ?? "unconfigured";
  const profile = {
    ...structuredClone(template),
    displayName: candidate.displayName,
    candidateId: candidate.id,
    createdBy,
  };
  next.present = [...next.present, pending.role];
  next.pendingCandidates = null;
  next.messages.push({
    from: "HR",
    text: hireLine(candidate.displayName, pending.role, createdBy, reason),
  });
  return { session: next, profile };
}

function hireLine(displayName, role, createdBy, reason) {
  if (createdBy === "hermes") {
    return `已 Hire ${displayName} 擔任 ${role}。Hermes 已建立 Bot。OpenCode 沒有參與。`;
  }
  if (reason === "unreachable") {
    return `已 Hire ${displayName} 擔任 ${role}。Mock mode：Hermes 連不上，這次沒有建立 Bot。OpenCode 沒有參與。`;
  }
  return `已 Hire ${displayName} 擔任 ${role}。Mock mode：由 Hermes 建立 Bot，OpenCode 沒有參與。`;
}

export function draftIssue(session, requestText) {
  const next = clone(session);
  if (!next.present.includes("PM")) {
    next.messages.push({ from: "system", text: "Office 裡還沒有 PM。" });
    return { session: next, issue: null };
  }
  const summary = requestText.trim() || "做出一個看得到團隊的 Office";
  const issue = {
    summary,
    acceptanceCriteria: [
      "人可以在同一個 Group Chat 裡把需求說清楚",
      "Issue 帶有驗收條件",
      "人核准之前不開始寫程式",
    ],
    status: "draft",
  };
  next.issue = issue;
  next.assignments = [];
  next.phase = "idle";
  next.mockPr = null;
  next.messages.push({
    from: "PM",
    text: `Issue 草稿：${summary}。驗收條件：${issue.acceptanceCriteria.join("；")}。請核准，或先不要。`,
  });
  return { session: next, issue };
}

export function approveIssue(session) {
  const next = clone(session);
  if (next.issue?.status !== "draft") {
    next.messages.push({ from: "system", text: "目前沒有待核准的 Issue。" });
    return { session: next };
  }
  next.issue = { ...next.issue, status: "approved" };
  next.messages.push({
    from: "system",
    text: "Issue 已核准。Tech Lead 可以分派。寫程式動畫還沒有開始。",
  });
  return { session: next };
}

export function holdIssue(session) {
  const next = clone(session);
  if (next.issue?.status !== "draft") {
    next.messages.push({ from: "system", text: "目前沒有可以先按下的草稿。" });
    return { session: next };
  }
  next.messages.push({ from: "system", text: "先不要。Issue 仍是草稿，不會開始寫程式。" });
  return { session: next };
}

export function assignWork(session) {
  const next = clone(session);
  if (!next.present.includes("Tech Lead")) {
    next.messages.push({ from: "system", text: "Office 裡還沒有 Tech Lead。" });
    return { session: next, assignments: [] };
  }
  if (next.issue?.status !== "approved") {
    next.messages.push({
      from: "Tech Lead",
      text: "Issue 還沒核准。我不會分派，也不會開始寫程式。",
    });
    return { session: next, assignments: [] };
  }
  const missing = ["FE", "BE"].filter((role) => !next.present.includes(role));
  if (missing.length > 0) {
    next.messages.push({
      from: "Tech Lead",
      text: `請先 Hire ${missing.join(" 與 ")}。我不憑空分派還沒在 Office 裡的人。`,
    });
    return { session: next, assignments: [] };
  }
  next.assignments = [
    { role: "FE", task: "畫面" },
    { role: "BE", task: "服務與資料" },
  ];
  next.messages.push({
    from: "Tech Lead",
    text: "已分派：FE 負責畫面，BE 負責服務與資料。可以播放 Mock 的寫程式動畫。",
  });
  return { session: next, assignments: next.assignments };
}

export function startMockCoding(session) {
  const next = clone(session);
  if (next.issue?.status !== "approved" || next.assignments.length === 0) {
    next.messages.push({ from: "system", text: "核准並完成分派之前，不能開始寫程式。" });
    return { session: next };
  }
  next.phase = "coding";
  next.mockPr = null;
  next.messages.push({
    from: "system",
    text: "Mock mode：FE 與 BE 正在寫程式。沒有啟動 OpenCode。",
  });
  return { session: next };
}

export function finishMockPr(session) {
  const next = clone(session);
  if (next.phase !== "coding") {
    next.messages.push({ from: "system", text: "還沒有在寫程式，所以沒有 PR。" });
    return { session: next, mockPr: null };
  }
  next.phase = "pr";
  next.mockPr = {
    title: next.issue.summary,
    sentToGitHub: false,
  };
  next.messages.push({
    from: "system",
    text: `Mock PR：${next.mockPr.title}。這不是 GitHub 上的 PR，沒有送出。`,
  });
  return { session: next, mockPr: next.mockPr };
}

export function handleHumanMessage(session, text, templates) {
  const parsed = parseAddress(text);
  const next = clone(session);
  next.messages.push({ from: "human", text: String(text), addressed: parsed?.role ?? null });
  if (!parsed) {
    next.messages.push({
      from: "system",
      text: "請用 @Role 指定一位已經在 Office 裡的 Hermes Bot。",
    });
    return { session: next, effect: null, profile: null };
  }
  if (!next.present.includes(parsed.role)) {
    next.messages.push({
      from: "system",
      text: `${parsed.role} 還不在 Office 裡。請先向 HR 要 Candidate，選定才算 Hire。`,
    });
    return { session: next, effect: null, profile: null };
  }
  if (parsed.role === "HR") {
    const hireName = parsed.body.match(/^雇用\s+(.+)$/)?.[1]?.trim();
    if (hireName && next.pendingCandidates) {
      const candidate = next.pendingCandidates.options.find((item) => item.displayName === hireName);
      if (candidate) {
        const hired = hire(next, candidate.id, templates);
        return { ...hired, effect: hired.profile ? "hire" : null };
      }
    }
    const role = roleMentioned(parsed.body);
    if (!role) {
      next.messages.push({
        from: "HR",
        text: "告訴我 Role：PM、Tech Lead、FE、BE 或 QA。",
      });
      return { session: next, effect: null, profile: null };
    }
    const asked = requestCandidates(next, role);
    return { ...asked, effect: asked.candidates ? "candidates" : null, profile: null };
  }
  if (parsed.role === "PM") {
    const drafted = draftIssue(next, parsed.body);
    return { ...drafted, effect: drafted.issue ? "draft" : null, profile: null };
  }
  if (parsed.role === "Tech Lead") {
    const assigned = assignWork(next);
    return {
      ...assigned,
      effect: assigned.assignments.length > 0 ? "assign" : null,
      profile: null,
    };
  }
  next.messages.push({
    from: parsed.role,
    text: "我在這個 Group Chat 裡。寫程式要等 Issue 核准，再由 Tech Lead 分派。",
  });
  return { session: next, effect: null, profile: null };
}
