import {
  approveIssue,
  assignWork,
  createSession,
  finishMockPr,
  handleHumanMessage,
  hire,
  holdIssue,
  startMockCoding,
} from "/office.mjs";

const ROLE_COPY = {
  HR: { task: "提出 Candidate", shirt: "#f0c14a", hair: "#3a2a22" },
  PM: { task: "起草 Issue", shirt: "#8eb6e0", hair: "#1d2430" },
  "Tech Lead": { task: "分派 FE / BE", shirt: "#c48ad4", hair: "#2a1d30" },
  FE: { task: "畫面", shirt: "#e07a5f", hair: "#3a2218" },
  BE: { task: "服務與資料", shirt: "#7dcea0", hair: "#143028" },
  QA: { task: "品質", shirt: "#d9d3c5", hair: "#242424" },
};

const SEATS = ["HR", "PM", "Tech Lead", "FE", "BE", "QA"];

let session = createSession();
let templates = null;
let iac = null;
let writing = false;

const floor = document.querySelector("#floor");
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

function render() {
  floor.classList.toggle("coding", session.phase === "coding");
  floor.replaceChildren();
  for (const role of SEATS) {
    const present = session.present.includes(role);
    const assignment = session.assignments.find((item) => item.role === role);
    const seat = document.createElement("article");
    seat.className = `seat${present ? "" : " empty"}${assignment && session.phase === "coding" ? " working" : ""}`;
    const copy = ROLE_COPY[role];
    const status = !present ? "空位" : session.phase === "coding" && assignment ? "寫程式中" : assignment ? `分派：${assignment.task}` : "在席";
    seat.innerHTML = `
      <div class="sprite" style="--shirt:${copy.shirt};--hair:${copy.hair}">
        ${present ? '<i class="hair"></i><i class="head"></i><i class="body"></i><i class="legs"></i>' : ""}
      </div>
      <div>
        <h3>${role}</h3>
        <p>${present ? copy.task : "尚未 Hire"}</p>
        <p class="status">${status}</p>
      </div>`;
    floor.append(seat);
  }

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
      messages: [...session.messages, { from: "system", text: "Bot profile 沒有寫入 IaC store，所以這次沒有 Hire。" }],
    };
    render();
    return;
  }
  const hired = hire(session, candidateId, templates);
  session = hired.session;
  session.messages.push({
    from: "system",
    text: `Bot profile 已寫入 ${body.file}${body.fallback ? "（家目錄不可寫，改用 fallback）" : ""}。`,
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

document.querySelector("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = draft.value.trim();
  if (!text) return;
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

templates = await loadTemplates();
const iacResponse = await fetch("/api/iac");
iac = await iacResponse.json();
iacNote.textContent = iac.fallback
  ? `IaC store fallback：${iac.dir}。家目錄的 ~/harness-office-iac/bots/ 現在不可寫。`
  : `IaC store：${iac.dir}`;
render();
