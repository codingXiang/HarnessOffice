/**
 * Hermes runtime adapter. Routes are the ones NousResearch/hermes-agent
 * documents for external callers (checked 2026-11 against gateway/platforms/api_server.py
 * and hermes_cli/web_routers/profiles.py):
 *
 *   GET  {apiBase}/health
 *   GET  {apiBase}/v1/capabilities          Bearer API_SERVER_KEY
 *   GET  {apiBase}/p/__ho_probe__/health    404 means multiplex is on; 200 means the prefix is ignored
 *   POST {dashboardBase}/api/profiles       ProfileCreate
 *   POST {apiBase}/p/{profile}/api/sessions
 *   POST {apiBase}/p/{profile}/api/sessions/{id}/chat/stream
 *
 * The canonical gateway groups.* methods are metadata. Gateway Internals says
 * that surface reports driver:false and does not run a group turn, so this
 * adapter does not call groups.send or invent a room-membership route.
 * HarnessOffice keeps the Group Chat transcript and delivers each Role's
 * line to that profile's API session.
 *
 * apiBase and dashboardBase come from the operator. This file has no host.
 */

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function emptySettings() {
  return {
    apiBase: "",
    dashboardBase: "",
    token: "",
    dashboardToken: "",
    bot: { cloneFrom: "", provider: "", model: "" },
    group: { name: "" },
  };
}

function asOrigin(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return raw;
    return url.origin;
  } catch {
    return raw;
  }
}

export function normalizeSettings(input) {
  const raw = input && typeof input === "object" ? input : {};
  const bot = raw.bot && typeof raw.bot === "object" ? raw.bot : {};
  const group = raw.group && typeof raw.group === "object" ? raw.group : {};
  const apiBase = asOrigin(raw.apiBase) || asOrigin(raw.endpoint);
  const dashboardBase = asOrigin(raw.dashboardBase) || apiBase;
  return {
    apiBase,
    dashboardBase,
    token: typeof raw.token === "string" ? raw.token : "",
    dashboardToken: typeof raw.dashboardToken === "string" ? raw.dashboardToken : "",
    bot: {
      cloneFrom: text(bot.cloneFrom),
      provider: text(bot.provider),
      model: text(bot.model),
    },
    group: { name: text(group.name) },
  };
}

export function endpointError(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "bad-endpoint";
  } catch {
    return "bad-endpoint";
  }
  return null;
}

export function isConfigured(settings) {
  const normalized = normalizeSettings(settings);
  return normalized.apiBase !== "" && endpointError(normalized.apiBase) === null && endpointError(normalized.dashboardBase) === null;
}

export function profileCreateBody({ role, candidateId, displayName, template, settings }) {
  const normalized = normalizeSettings(settings);
  const duties = Array.isArray(template?.responsibilities) ? template.responsibilities.filter(Boolean).join("；") : "";
  const description = duties ? `${role}：${displayName}。${duties}` : `${role}：${displayName}`;
  const body = { name: candidateId, description };
  if (normalized.bot.cloneFrom) body.clone_from = normalized.bot.cloneFrom;
  if (normalized.bot.provider) body.provider = normalized.bot.provider;
  if (normalized.bot.model) body.model = normalized.bot.model;
  return body;
}

export function botSessionId(profileName) {
  return `ho-${profileName}`;
}

export function redactSecrets(value, settings) {
  let out = String(value ?? "");
  const normalized = normalizeSettings(settings);
  for (const secret of [normalized.token, normalized.dashboardToken]) {
    if (secret.length > 3) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 400);
}

function bearer(token) {
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

export function dashboardSessionTokenFromHtml(html) {
  const match = String(html ?? "").match(/__HERMES_SESSION_TOKEN__\s*=\s*(?:"([^"]+)"|'([^']+)')/);
  return match?.[1] || match?.[2] || "";
}

function dashboardHeaders(token) {
  if (!token) return { "content-type": "application/json" };
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-hermes-session-token": token,
  };
}

async function readBody(response) {
  const raw = await response.text();
  if (!raw) return { raw: "", json: null };
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: null };
  }
}

function alreadyExists(status, parsed) {
  if (status === 409) return true;
  if (status !== 400) return false;
  return JSON.stringify(parsed.json ?? parsed.raw).toLowerCase().includes("exist");
}

export async function inspectRuntime(settings, fetchImpl, { timeoutMs = 2500 } = {}) {
  const normalized = normalizeSettings(settings);
  if (!isConfigured(normalized)) return { state: "unconfigured", multiplex: null };
  const signal = () => AbortSignal.timeout(timeoutMs);
  let health;
  try {
    health = await fetchImpl(`${normalized.apiBase}/health`, { method: "GET", signal: signal() });
  } catch {
    return { state: "offline", multiplex: null };
  }
  if (!health.ok) return { state: "offline", status: health.status, multiplex: null };
  let capabilities;
  try {
    capabilities = await fetchImpl(`${normalized.apiBase}/v1/capabilities`, {
      method: "GET",
      headers: bearer(normalized.token),
      signal: signal(),
    });
  } catch {
    return { state: "offline", multiplex: null };
  }
  if (capabilities.status === 401 || capabilities.status === 403) {
    return { state: "auth", status: capabilities.status, multiplex: null };
  }
  if (!capabilities.ok) return { state: "unavailable", status: capabilities.status, multiplex: null };
  let probe;
  try {
    probe = await fetchImpl(`${normalized.apiBase}/p/__ho_probe__/health`, { method: "GET", signal: signal() });
  } catch {
    return { state: "offline", multiplex: null };
  }
  const multiplex = probe.status === 404 ? true : probe.ok ? false : null;
  return { state: "live", multiplex, status: capabilities.status };
}

export async function probeHermes(settings, fetchImpl, options) {
  const inspected = await inspectRuntime(settings, fetchImpl, options);
  return {
    reachable: inspected.state === "live" || inspected.state === "auth" || inspected.state === "unavailable",
    state: inspected.state,
    multiplex: inspected.multiplex,
    status: inspected.status ?? null,
    reason: inspected.state === "offline" ? "unreachable" : inspected.state,
  };
}

export async function hireWithHermes({
  settings,
  role,
  candidateId,
  displayName,
  template,
  fetchImpl,
  timeoutMs = 8000,
}) {
  const normalized = normalizeSettings(settings);
  const localProfile = (createdBy, hermes) => ({
    ...structuredClone(template),
    displayName,
    candidateId,
    createdBy,
    ...(normalized.group.name ? { hermesGroup: { name: normalized.group.name } } : {}),
    ...(hermes ? { hermes } : {}),
  });

  if (!isConfigured(normalized)) {
    return { ok: true, mode: "mock", reason: "unconfigured", profile: localProfile("mock-hermes") };
  }
  const inspected = await inspectRuntime(normalized, fetchImpl, { timeoutMs });
  if (inspected.state === "offline") {
    return { ok: true, mode: "mock", reason: "unreachable", profile: localProfile("mock-hermes") };
  }
  if (inspected.state === "auth") {
    return { ok: false, mode: "live", reason: "auth", status: inspected.status ?? 401 };
  }
  if (inspected.state !== "live") {
    return { ok: false, mode: "live", reason: inspected.state, status: inspected.status ?? 502 };
  }

  const payload = profileCreateBody({ role, candidateId, displayName, template, settings: normalized });
  const postProfile = (token) => fetchImpl(`${normalized.dashboardBase}/api/profiles`, {
    method: "POST",
    headers: dashboardHeaders(token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let dashToken = normalized.dashboardToken;
  let created;
  try {
    created = await postProfile(dashToken);
  } catch {
    return { ok: true, mode: "mock", reason: "unreachable", profile: localProfile("mock-hermes") };
  }
  // A loopback `hermes dashboard` rejects the API server key. Its own session
  // token is injected into the HTML for the page. Use that once, and do not store it.
  if (created.status === 401 && !normalized.dashboardToken) {
    try {
      const page = await fetchImpl(`${normalized.dashboardBase}/`, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const found = dashboardSessionTokenFromHtml(await page.text());
      if (found) {
        dashToken = found;
        created = await postProfile(found);
      }
    } catch {
      // leave the 401
    }
  }
  const createdBody = await readBody(created);
  if (created.status === 401 || created.status === 403) {
    return { ok: false, mode: "live", reason: "auth", status: created.status };
  }
  if (!created.ok && !alreadyExists(created.status, createdBody)) {
    return {
      ok: false,
      mode: "live",
      reason: "rejected",
      status: created.status,
      detail: redactSecrets(createdBody.raw, normalized),
    };
  }
  const profileName = payload.name;
  if (inspected.multiplex !== true) {
    return {
      ok: true,
      mode: "live",
      reason: "profile-only",
      profile: localProfile("hermes", { name: profileName, sessionId: null, route: "unavailable" }),
    };
  }

  const sessionId = botSessionId(profileName);
  let session;
  try {
    session = await fetchImpl(`${normalized.apiBase}/p/${encodeURIComponent(profileName)}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(normalized.token) },
      body: JSON.stringify({
        id: sessionId,
        title: normalized.group.name ? `Group: ${normalized.group.name}` : `Group: ${role}`,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, mode: "live", reason: "unreachable", status: 0 };
  }
  const sessionBody = await readBody(session);
  if (session.status === 401 || session.status === 403) {
    return {
      ok: false,
      mode: "live",
      reason: "auth",
      status: session.status,
      detail: "這個 profile 不接受這把 API 憑證。每個 secondary profile 要有自己的 API_SERVER_KEY。",
    };
  }
  if (!session.ok && !alreadyExists(session.status, sessionBody)) {
    return {
      ok: false,
      mode: "live",
      reason: "session-rejected",
      status: session.status,
      detail: redactSecrets(sessionBody.raw, normalized),
    };
  }
  return {
    ok: true,
    mode: "live",
    reason: "created",
    profile: localProfile("hermes", { name: profileName, sessionId, route: "multiplex" }),
  };
}

function parseSseChunk(buffer) {
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() ?? "";
  const events = [];
  for (const part of parts) {
    if (!part.trim() || part.trimStart().startsWith(":")) continue;
    let event = "message";
    const dataLines = [];
    for (const line of part.split(/\n/)) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join("\n");
    try {
      events.push({ event, data: JSON.parse(raw), malformed: false });
    } catch {
      events.push({ event, data: null, malformed: true, raw });
    }
  }
  return { events, rest };
}

export async function streamBotTurn({
  settings,
  profileName,
  sessionId,
  input,
  instructions,
  fetchImpl,
  signal,
  onEvent,
  timeoutMs = 60000,
}) {
  const normalized = normalizeSettings(settings);
  const url = `${normalized.apiBase}/p/${encodeURIComponent(profileName)}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(normalized.token) },
      body: JSON.stringify({ input, instructions }),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "offline" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "auth", status: response.status };
  if (!response.ok) {
    const body = await readBody(response);
    return { ok: false, reason: "rejected", status: response.status, detail: redactSecrets(body.raw, normalized) };
  }
  const contentType = response.headers.get?.("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await readBody(response);
    const text = body.json?.message?.content;
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "malformed" };
    return { ok: true, text };
  }
  let buffer = "";
  let completed = null;
  let completedFlag = null;
  let terminal = null;
  let malformed = false;
  const consume = (events) => {
    for (const item of events) {
      if (item.malformed) {
        malformed = true;
        terminal = { ok: false, reason: "malformed" };
        continue;
      }
      if (malformed) continue;
      if (item.event === "tool.started") onEvent?.({ type: "tool", name: item.data?.tool_name ?? "" });
      if (item.event === "assistant.delta") onEvent?.({ type: "delta" });
      if (item.event === "assistant.completed" && typeof item.data?.content === "string") {
        completed = item.data.content;
        if (typeof item.data.completed === "boolean") completedFlag = item.data.completed;
      }
      if (item.event === "run.completed" && item.data?.completed !== false && completedFlag !== false) terminal = { ok: true };
      if (item.event === "run.failed" || item.event === "error") {
        const upstream = item.data?.message || item.data?.error || (completedFlag === false ? completed : "") || "stream error";
        terminal = { ok: false, reason: "stream-error", detail: redactSecrets(upstream, normalized) };
      }
      if (item.event === "run.cancelled") terminal = { ok: false, reason: "cancelled" };
    }
  };
  if (!response.body?.getReader) {
    const parsed = parseSseChunk(`${await response.text()}\n\n`);
    consume(parsed.events);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!terminal || terminal.ok) {
        const step = await reader.read();
        if (step.done) {
          const parsed = parseSseChunk(`${buffer}\n\n`);
          consume(parsed.events);
          break;
        }
        buffer += decoder.decode(step.value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        consume(parsed.events);
        if (terminal && !terminal.ok) break;
      }
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, reason: "cancelled" };
      return { ok: false, reason: "interrupted" };
    }
  }
  if (malformed) return { ok: false, reason: "malformed" };
  if (terminal && terminal.ok === false) return { ok: false, reason: terminal.reason, detail: terminal.detail };
  if (!terminal || typeof completed !== "string") return { ok: false, reason: "interrupted" };
  return { ok: true, text: completed };
}
