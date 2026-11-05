import assert from "node:assert/strict";
import test from "node:test";
import { createSession, hire, requestCandidates, startMockCoding, finishMockPr, draftIssue, approveIssue, assignWork } from "./office.mjs";
import { agentsForSession, eventsForTransition, isAgentEvent } from "./pixel-office-events.mjs";
import { loadTemplates } from "./server.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templates = loadTemplates(path.join(path.dirname(fileURLToPath(import.meta.url)), "templates"));

test("opening the office makes HR appear as an idle PixelOffice agent", () => {
  const events = eventsForTransition(null, createSession(), 1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "upsert");
  assert.equal(events[0].agentId, "hr");
  assert.equal(events[0].state, "idle");
  assert.equal(isAgentEvent(events[0]), true);
  assert.equal(events[0].version, 1);
});

test("candidates put HR in waiting, and Hire makes the new role appear", () => {
  const start = createSession();
  const asked = requestCandidates(start, "PM").session;
  const waiting = eventsForTransition(start, asked, 2000);
  assert.deepEqual(waiting.map((event) => [event.agentId, event.state]), [["hr", "waiting"]]);

  const hired = hire(asked, "pm-lin", templates).session;
  const appeared = eventsForTransition(asked, hired, 3000);
  assert.deepEqual(
    appeared.map((event) => [event.agentId, event.state]),
    [
      ["hr", "idle"],
      ["pm", "idle"],
    ],
  );
});

test("a drafted Issue waits, coding is coding, and the mock PR is success", () => {
  let session = hire(requestCandidates(createSession(), "PM").session, "pm-lin", templates).session;
  session = hire(requestCandidates(session, "Tech Lead").session, "tl-chen", templates).session;
  session = hire(requestCandidates(session, "FE").session, "fe-wu", templates).session;
  session = hire(requestCandidates(session, "BE").session, "be-huang", templates).session;
  const drafted = draftIssue(session, "做一個像素 Office").session;
  assert.equal(agentsForSession(drafted).find((agent) => agent.agentId === "pm").state, "waiting");

  const approved = approveIssue(drafted).session;
  assert.equal(agentsForSession(approved).find((agent) => agent.agentId === "tech-lead").state, "thinking");

  const assigned = assignWork(approved).session;
  const coding = startMockCoding(assigned).session;
  assert.deepEqual(
    agentsForSession(coding).filter((agent) => agent.state === "coding").map((agent) => agent.agentId),
    ["fe", "be"],
  );
  const pr = finishMockPr(coding).session;
  const finished = eventsForTransition(coding, pr, 4000);
  assert.deepEqual(
    finished.map((event) => [event.agentId, event.state]),
    [
      ["fe", "success"],
      ["be", "success"],
    ],
  );
  assert.equal(finished.every((event) => event.activity === "mock-pr"), true);
});
