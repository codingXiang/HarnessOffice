/**
 * Hermes hire adapter.
 *
 * Hypothesis, checked against NousResearch/hermes-agent (2026-11):
 * the dashboard creates a Bot profile with POST /api/profiles and a
 * ProfileCreate body (`name`, `description`, `clone_from`, `provider`,
 * `model`). See hermes_cli/web_models.py and web_routers/profiles.py.
 * bot-forge's `create_agent` is an in-agent tool, not an HTTP route.
 * Group membership (`hermes group add`, gateway `groups.*`) has no
 * verified REST route here, so group settings are stored on the Bot
 * profile and are not a second request.
 *
 * The operator's endpoint is the full URL we GET (reachability: any
 * HTTP response) and POST. This file does not choose a host.
 */

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function emptySettings() {
  return {
    endpoint: "",
    token: "",
    bot: { cloneFrom: "", provider: "", model: "" },
    group: { name: "", roomId: "" },
  };
}

export function normalizeSettings(input) {
  const raw = input && typeof input === "object" ? input : {};
  const bot = raw.bot && typeof raw.bot === "object" ? raw.bot : {};
  const group = raw.group && typeof raw.group === "object" ? raw.group : {};
  return {
    endpoint: text(raw.endpoint),
    token: typeof raw.token === "string" ? raw.token : "",
    bot: {
      cloneFrom: text(bot.cloneFrom),
      provider: text(bot.provider),
      model: text(bot.model),
    },
    group: {
      name: text(group.name),
      roomId: text(group.roomId),
    },
  };
}

export function endpointError(endpoint) {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "bad-endpoint";
  } catch {
    return "bad-endpoint";
  }
  return null;
}

export function isConfigured(settings) {
  const normalized = normalizeSettings(settings);
  return normalized.endpoint !== "" && endpointError(normalized.endpoint) === null;
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

function authHeaders(settings) {
  if (!settings.token) return {};
  return {
    authorization: `Bearer ${settings.token}`,
    "x-hermes-session-token": settings.token,
  };
}

export async function probeHermes(settings, fetchImpl, { timeoutMs = 2500 } = {}) {
  const normalized = normalizeSettings(settings);
  if (!isConfigured(normalized)) return { reachable: false, reason: "unconfigured" };
  try {
    const response = await fetchImpl(normalized.endpoint, {
      method: "GET",
      headers: authHeaders(normalized),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reachable: true, status: response.status };
  } catch {
    return { reachable: false, reason: "unreachable" };
  }
}

export async function createHermesBot(settings, payload, fetchImpl, { timeoutMs = 8000 } = {}) {
  const normalized = normalizeSettings(settings);
  const response = await fetchImpl(normalized.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(normalized),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw: raw.slice(0, 200) };
    }
  }
  return { ok: response.status >= 200 && response.status < 300, status: response.status, body };
}

function withGroup(profile, settings) {
  if (!settings.group.name && !settings.group.roomId) return profile;
  return { ...profile, hermesGroup: { name: settings.group.name, roomId: settings.group.roomId } };
}

export async function hireWithHermes({
  settings,
  role,
  candidateId,
  displayName,
  template,
  fetchImpl,
  timeoutMs,
}) {
  const normalized = normalizeSettings(settings);
  const base = withGroup(
    {
      ...structuredClone(template),
      displayName,
      candidateId,
      createdBy: "mock-hermes",
    },
    normalized,
  );

  if (!isConfigured(normalized)) {
    return { ok: true, mode: "mock", reason: "unconfigured", profile: base };
  }

  const probe = await probeHermes(normalized, fetchImpl, { timeoutMs });
  if (!probe.reachable) {
    return { ok: true, mode: "mock", reason: "unreachable", profile: base };
  }

  const payload = profileCreateBody({ role, candidateId, displayName, template, settings: normalized });
  let created;
  try {
    created = await createHermesBot(normalized, payload, fetchImpl, { timeoutMs });
  } catch {
    return { ok: true, mode: "mock", reason: "unreachable", profile: base };
  }
  if (!created.ok) {
    return { ok: false, mode: "live", reason: "rejected", status: created.status, detail: created.body };
  }
  const name = typeof created.body?.name === "string" && created.body.name ? created.body.name : payload.name;
  return {
    ok: true,
    mode: "live",
    reason: "created",
    profile: {
      ...withGroup(
        {
          ...structuredClone(template),
          displayName,
          candidateId,
          createdBy: "hermes",
        },
        normalized,
      ),
      hermes: { name },
    },
  };
}
