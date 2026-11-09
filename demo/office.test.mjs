import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  approveIssue,
  assignWork,
  createSession,
  draftIssue,
  finishMockPr,
  handleHumanMessage,
  hire,
  parseAddress,
  requestCandidates,
  startMockCoding,
} from "./office.mjs";
import { loadTemplates } from "./server.mjs";

const templates = loadTemplates(path.join(path.dirname(fileURLToPath(import.meta.url)), "templates"));

test("opening the office shows only HR", () => {
  const session = createSession();
  assert.deepEqual(session.present, ["HR"]);
  assert.equal(session.messages[0].from, "HR");
  assert.equal(session.phase, "idle");
  assert.equal(session.mockPr, null);
});

test("one Group Chat: @Role addresses someone in the Office, and nobody else", () => {
  let session = createSession();
  const missing = handleHumanMessage(session, "大家好", templates);
  assert.equal(missing.session.messages.at(-1).text.includes("@Role"), true);
  assert.equal(missing.session.messages.at(-2).addressed, null);

  const hr = handleHumanMessage(session, "@HR PM", templates);
  assert.equal(hr.session.messages.some((message) => message.addressed === "HR"), true);
  assert.equal(hr.session.pendingCandidates.role, "PM");
  assert.equal(hr.session.present.includes("PM"), false);

  const absent = handleHumanMessage(session, "@PM 做一個辦公室", templates);
  assert.equal(absent.session.present.includes("PM"), false);
  assert.equal(absent.session.issue, null);
  assert.match(absent.session.messages.at(-1).text, /還沒有 PM|還不在 Office/);
});

test("Hire waits for a human selection, then adds the Role without touching the template", () => {
  let step = handleHumanMessage(createSession(), "@HR 請給我 PM 的 Candidate", templates);
  assert.equal(step.session.present.includes("PM"), false);
  const ignored = hire(step.session, "nobody", templates);
  assert.equal(ignored.profile, null);
  assert.equal(ignored.session.present.includes("PM"), false);

  const hired = hire(step.session, "pm-lin", templates);
  assert.deepEqual(hired.session.present, ["HR", "PM"]);
  assert.equal(hired.profile.displayName, "林可");
  assert.equal(hired.profile.runtime, "hermes");
  assert.equal(hired.profile.openCode, false);
  assert.equal(hired.profile.createdBy, "mock-hermes");
  assert.match(hired.session.messages.at(-1).text, /Mock mode：由 Hermes 建立 Bot，OpenCode 沒有參與。/);
  assert.equal(templates.PM.displayName, null);
  assert.equal(Object.hasOwn(templates.PM, "createdBy"), false);
});

test("coding stays stopped until the human approves the PM draft and the Tech Lead assigns FE and BE", () => {
  let session = hire(requestCandidates(createSession(), "PM").session, "pm-lin", templates).session;
  session = hire(requestCandidates(session, "Tech Lead").session, "tl-chen", templates).session;

  const drafted = handleHumanMessage(session, "@PM 做一個像素 Office", templates);
  assert.equal(drafted.session.issue.status, "draft");
  assert.match(drafted.session.messages.at(-1).text, /驗收條件/);
  assert.equal(startMockCoding(drafted.session).session.phase, "idle");
  assert.equal(assignWork(drafted.session).assignments.length, 0);

  const held = handleHumanMessage(
    { ...drafted.session, messages: drafted.session.messages },
    "@Tech Lead 分派",
    templates,
  );
  assert.equal(held.session.assignments.length, 0);
  assert.equal(held.session.phase, "idle");

  const approved = approveIssue(drafted.session);
  assert.equal(approved.session.issue.status, "approved");
  assert.equal(startMockCoding(approved.session).session.phase, "idle");

  const needEngineers = assignWork(approved.session);
  assert.equal(needEngineers.assignments.length, 0);
  assert.match(needEngineers.session.messages.at(-1).text, /FE/);

  session = hire(requestCandidates(approved.session, "FE").session, "fe-wu", templates).session;
  session = hire(requestCandidates(session, "BE").session, "be-huang", templates).session;
  const assigned = assignWork(session);
  assert.deepEqual(
    assigned.assignments.map((item) => item.role),
    ["FE", "BE"],
  );
  assert.equal(assigned.session.phase, "idle");

  const coding = startMockCoding(assigned.session);
  assert.equal(coding.session.phase, "coding");
  assert.equal(coding.session.mockPr, null);
  const pr = finishMockPr(coding.session);
  assert.equal(pr.session.phase, "pr");
  assert.equal(pr.mockPr.sentToGitHub, false);
  assert.equal(pr.mockPr.title, "做一個像素 Office");
});

test("a live Hire says Hermes created the Bot, and an unreachable endpoint stays visibly Mock", () => {
  const pending = requestCandidates(createSession(), "PM").session;
  const live = hire(pending, "pm-lin", templates, { createdBy: "hermes", reason: "created" });
  assert.equal(live.profile.createdBy, "hermes");
  assert.match(live.session.messages.at(-1).text, /Hermes 已建立 Bot/);
  assert.doesNotMatch(live.session.messages.at(-1).text, /Mock mode/);

  const down = hire(pending, "pm-lin", templates, { reason: "unreachable" });
  assert.equal(down.profile.createdBy, "mock-hermes");
  assert.match(down.session.messages.at(-1).text, /Mock mode：Hermes 連不上，這次沒有建立 Bot/);
});

test("@ address parses Tech Lead as one Role", () => {
  assert.deepEqual(parseAddress("@Tech Lead 分派"), { role: "Tech Lead", body: "分派" });
  assert.equal(parseAddress("Tech Lead"), null);
});

test("asking HR to hire FE proposes one candidate and one Hire", () => {
  const asked = handleHumanMessage(createSession(), "@HR 請幫我 hire FE", templates);
  assert.equal(asked.session.pendingCandidates.role, "FE");
  assert.equal(asked.session.pendingCandidates.options.length, 1);
  assert.equal(asked.session.pendingCandidates.options[0].id, "fe-wu");
  assert.match(asked.session.messages.at(-1).text, /吳像素/);
  assert.equal(asked.session.present.includes("FE"), false);
  const hired = hire(asked.session, "fe-wu", templates);
  assert.equal(hired.session.present.includes("FE"), true);
  const again = hire(hired.session, "fe-wu", templates);
  assert.match(again.session.messages.at(-1).text, /還沒有可以選定的 Candidate|已經在 Office/);
});

test("HR understands a natural hire request and offers choices when it cannot", () => {
  const hired = handleHumanMessage(createSession(), "@HR 請幫我 hire tech lead", templates);
  assert.equal(hired.session.pendingCandidates.role, "Tech Lead");
  assert.equal(handleHumanMessage(createSession(), "@HR techlead", templates).session.pendingCandidates.role, "Tech Lead");
  assert.equal(handleHumanMessage(createSession(), "@hr 技術主管", templates).session.pendingCandidates.role, "Tech Lead");
  assert.equal(handleHumanMessage(createSession(), "@HR 請找前端", templates).session.pendingCandidates.role, "FE");
  const hello = handleHumanMessage(createSession(), "@HR 你好", templates);
  assert.equal(hello.session.pendingCandidates, null);
  assert.deepEqual(hello.session.roleChoices, ["PM", "Tech Lead", "FE", "BE", "QA"]);
  const both = handleHumanMessage(createSession(), "@HR 請 FE 和 BE", templates);
  assert.equal(both.session.pendingCandidates, null);
  assert.deepEqual(both.session.roleChoices, ["FE", "BE"]);
  const typo = handleHumanMessage(createSession(), "@MR 請幫我 hire tech lead", templates);
  assert.match(typo.session.messages.find((message) => message.from === "system").text, /是不是要找 @HR/);
  assert.equal(typo.session.pendingCandidates.role, "Tech Lead");
});

test("templates are Hermes profiles with no hired name", () => {
  for (const role of ["HR", "PM", "Tech Lead", "FE", "BE", "QA"]) {
    assert.equal(templates[role].runtime, "hermes");
    assert.equal(templates[role].openCode, false);
    assert.equal(templates[role].displayName, null);
    assert.equal(templates[role].groupChat, "shared");
  }
  const raw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "templates", "pm.json"), "utf8");
  assert.equal(raw.includes("林可"), false);
});

test("draftIssue refuses to run without a PM", () => {
  const result = draftIssue(createSession(), "任何需求");
  assert.equal(result.issue, null);
});
