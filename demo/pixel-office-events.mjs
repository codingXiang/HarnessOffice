const STATES = new Set([
  "idle",
  "thinking",
  "planning",
  "researching",
  "coding",
  "running",
  "waiting",
  "success",
  "failure",
]);

export function slugRole(role) {
  return String(role).trim().toLowerCase().replace(/\s+/g, "-");
}

export function harnessOfficeEvent({ agentId, state, activity, kind = "upsert", occurredAt = Date.now() }) {
  return {
    version: 1,
    provider: "harness-office",
    sessionId: "mock-office",
    agentId,
    projectId: "harness-office",
    projectLabel: "HarnessOffice",
    kind,
    state,
    activity,
    occurredAt,
  };
}

export function isAgentEvent(event) {
  if (!event || event.version !== 1) return false;
  if (!["upsert", "touch", "end"].includes(event.kind)) return false;
  if (typeof event.agentId !== "string" || event.agentId.length === 0) return false;
  if (event.kind === "upsert" && !STATES.has(event.state)) return false;
  return event.provider === "harness-office" && event.projectId === "harness-office";
}

function roleState(session, role) {
  const assigned = session.assignments?.some((item) => item.role === role) ?? false;
  if (assigned && session.phase === "coding") {
    return { state: "coding", activity: "mock-coding" };
  }
  if (assigned && session.phase === "pr") {
    return { state: "success", activity: "mock-pr" };
  }
  if (role === "PM" && session.issue?.status === "draft") {
    return { state: "waiting", activity: "approval" };
  }
  if (role === "Tech Lead" && session.issue?.status === "approved" && (session.assignments?.length ?? 0) === 0) {
    return { state: "thinking", activity: "assign" };
  }
  return { state: "idle", activity: "present" };
}

export function agentsForSession(session) {
  const agents = [];
  if (session.present?.includes("HR")) {
    agents.push({
      agentId: "hr",
      role: "HR",
      state: session.pendingCandidates ? "waiting" : "idle",
      activity: session.pendingCandidates ? "candidates" : "present",
    });
  }
  for (const role of ["PM", "Tech Lead", "FE", "BE", "QA"]) {
    if (!session.present?.includes(role)) continue;
    const status = roleState(session, role);
    agents.push({ agentId: slugRole(role), role, ...status });
  }
  return agents;
}

export function eventsForTransition(previous, next, occurredAt = Date.now()) {
  const before = new Map((previous ? agentsForSession(previous) : []).map((agent) => [agent.agentId, agent.state]));
  const events = [];
  for (const agent of agentsForSession(next)) {
    if (before.get(agent.agentId) === agent.state) continue;
    events.push(harnessOfficeEvent({
      agentId: agent.agentId,
      state: agent.state,
      activity: agent.activity,
      occurredAt,
    }));
  }
  return events;
}
