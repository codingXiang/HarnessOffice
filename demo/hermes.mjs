/**
 * Hermes runtime adapter. Routes are the ones NousResearch/hermes-agent
 * documents for external callers (checked 2026-11 against gateway/platforms/api_server.py
 * and hermes_cli/web_routers/profiles.py):
 *
 *   GET  {apiBase}/health
 *   GET  {apiBase}/v1/capabilities          Bearer API_SERVER_KEY
 *   GET  {apiBase}/p/__ho_probe__/health    404 means multiplex is on; 200 means the prefix is ignored
 *   POST {dashboardBase}/api/profiles       ProfileCreate
 *   PUT  {dashboardBase}/api/env            {"key":"API_SERVER_KEY","value","profile"}
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

async function writeProfileApiKey(settings, profileName, fetchImpl, timeoutMs) {
  if (!settings.dashboardToken) {
    return {
      ok: false,
      status: 401,
      detail: "請在 Hermes 設定填 Dashboard 憑證（HERMES_DASHBOARD_SESSION_TOKEN），才能把 API_SERVER_KEY 寫進新 profile。留白不會讀取 dashboard 頁面。",
    };
  }
  if (!settings.token) {
    return {
      ok: false,
      status: 401,
      detail: "請在 Hermes 設定填 API 憑證，才能寫入新 profile 的 API_SERVER_KEY。",
    };
  }
  let response;
  try {
    response = await fetchImpl(`${settings.dashboardBase}/api/env`, {
      method: "PUT",
      headers: dashboardHeaders(settings.dashboardToken),
      body: JSON.stringify({ key: "API_SERVER_KEY", value: settings.token, profile: profileName }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: 0, offline: true };
  }
  const parsed = await readBody(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      detail: response.status === 401 || response.status === 403
        ? "Dashboard 拒絕了這把憑證。沒有寫入 API_SERVER_KEY。"
        : redactSecrets(parsed.raw, settings),
    };
  }
  return { ok: true, status: response.status };
}

async function openBotSession(settings, profileName, role, fetchImpl, timeoutMs) {
  const sessionId = botSessionId(profileName);
  let session;
  try {
    session = await fetchImpl(`${settings.apiBase}/p/${encodeURIComponent(profileName)}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(settings.token) },
      body: JSON.stringify({
        id: sessionId,
        title: settings.group.name ? `Group: ${settings.group.name}` : `Group: ${role}`,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, offline: true, status: 0, sessionId };
  }
  const sessionBody = await readBody(session);
  return { ok: session.ok || alreadyExists(session.status, sessionBody), status: session.status, sessionId, body: sessionBody };
}

export async function hireWithHermes({
  settings,
  role,
  candidateId,
  displayName,
  template,
  fetchImpl,
  ownsProfile = false,
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
  let created;
  try {
    created = await fetchImpl(`${normalized.dashboardBase}/api/profiles`, {
      method: "POST",
      headers: dashboardHeaders(normalized.dashboardToken),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: true, mode: "mock", reason: "unreachable", profile: localProfile("mock-hermes") };
  }
  const createdBody = await readBody(created);
  if (created.status === 401 || created.status === 403) {
    const detail = normalized.dashboardToken
      ? "Dashboard 拒絕了這把憑證。請改填 Hermes 的 HERMES_DASHBOARD_SESSION_TOKEN。API 憑證不會拿去當 dashboard 憑證。"
      : "請在 Hermes 設定填 Dashboard 憑證（HERMES_DASHBOARD_SESSION_TOKEN）。留白不會讀取 dashboard 頁面。這次沒有 Hire。";
    return { ok: false, mode: "live", reason: "auth", status: created.status, detail };
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
  const createdFresh = created.ok;
  if (!createdFresh && !ownsProfile) {
    return {
      ok: false,
      mode: "live",
      reason: "conflict",
      status: created.status,
      detail: "Hermes 裡已有同名 profile，但不是這個 HarnessOffice 建立的。沒有改它的 API_SERVER_KEY，也沒有 Hire。",
    };
  }
  if (createdFresh) {
    const keyed = await writeProfileApiKey(normalized, profileName, fetchImpl, timeoutMs);
    if (!keyed.ok) {
      return {
        ok: false,
        mode: "live",
        reason: keyed.offline ? "unreachable" : keyed.status === 401 || keyed.status === 403 ? "auth" : "key-provision",
        status: keyed.status,
        detail: keyed.detail,
        ownedProfile: profileName,
      };
    }
  }
  if (inspected.multiplex !== true) {
    return {
      ok: true,
      mode: "live",
      reason: "profile-only",
      ownedProfile: profileName,
      profile: localProfile("hermes", { name: profileName, sessionId: null, route: "unavailable" }),
    };
  }

  let opened = await openBotSession(normalized, profileName, role, fetchImpl, timeoutMs);
  if (!createdFresh && (opened.status === 401 || opened.status === 403)) {
    const keyed = await writeProfileApiKey(normalized, profileName, fetchImpl, timeoutMs);
    if (!keyed.ok) {
      return {
        ok: false,
        mode: "live",
        reason: keyed.offline ? "unreachable" : "auth",
        status: keyed.status,
        detail: keyed.detail,
        ownedProfile: profileName,
      };
    }
    opened = await openBotSession(normalized, profileName, role, fetchImpl, timeoutMs);
  }
  if (opened.offline) {
    return { ok: false, mode: "live", reason: "unreachable", status: 0, ownedProfile: profileName };
  }
  if (opened.status === 401 || opened.status === 403) {
    return {
      ok: false,
      mode: "live",
      reason: "auth",
      status: opened.status,
      detail: "這個 profile 不接受這把 API 憑證。寫入 API_SERVER_KEY 之後仍然拒絕。沒有把失敗當成回覆。",
      ownedProfile: profileName,
    };
  }
  if (!opened.ok) {
    return {
      ok: false,
      mode: "live",
      reason: "session-rejected",
      status: opened.status,
      detail: redactSecrets(opened.body?.raw, normalized),
      ownedProfile: profileName,
    };
  }
  return {
    ok: true,
    mode: "live",
    reason: "created",
    ownedProfile: profileName,
    profile: localProfile("hermes", { name: profileName, sessionId: opened.sessionId, route: "multiplex" }),
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
