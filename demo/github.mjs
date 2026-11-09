import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAddress } from "./office.mjs";

export const DEFAULT_LABELS = {
  frontend: "FE",
  ui: "FE",
  backend: "BE",
  api: "BE",
  bug: "QA",
  test: "QA",
  design: "PM",
  spec: "PM",
  architecture: "Tech Lead",
};

const ROLES = ["Tech Lead", "FE", "BE", "QA", "PM"];

export function emptyGithubSettings() {
  return {
    owner: "codingXiang",
    repo: "HarnessOffice",
    token: "",
    pollSeconds: 60,
    autoPost: false,
    labels: { ...DEFAULT_LABELS },
  };
}

export function normalizeGithubSettings(raw) {
  const base = emptyGithubSettings();
  const poll = Number(raw?.pollSeconds);
  return {
    owner: String(raw?.owner || base.owner).trim(),
    repo: String(raw?.repo || base.repo).trim(),
    token: String(raw?.token || ""),
    pollSeconds: Number.isFinite(poll) ? Math.min(600, Math.max(15, poll)) : base.pollSeconds,
    autoPost: raw?.autoPost === true,
    labels: { ...base.labels, ...(raw?.labels ?? {}) },
  };
}

export function publicGithubSettings(settings) {
  const normalized = normalizeGithubSettings(settings);
  return {
    configured: Boolean(normalized.token && normalized.owner && normalized.repo),
    owner: normalized.owner,
    repo: normalized.repo,
    pollSeconds: normalized.pollSeconds,
    autoPost: normalized.autoPost,
    labels: normalized.labels,
    tokenSet: normalized.token !== "",
  };
}

export function resolveGithubFile({
  env = process.env,
  home = os.homedir(),
  cwd = process.cwd(),
  mkdirSync = fs.mkdirSync,
  accessSync = fs.accessSync,
} = {}) {
  if (env.HARNESS_GITHUB_SETTINGS) {
    const file = env.HARNESS_GITHUB_SETTINGS;
    mkdirSync(path.dirname(file), { recursive: true });
    return file;
  }
  const candidates = [
    "/home/box/harness-office-iac",
    path.join(home, "harness-office-iac"),
  ];
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, fs.constants.W_OK);
      return path.join(dir, "github.json");
    } catch {
      // Try the next directory the process can write.
    }
  }
  return path.resolve(cwd, ".github-settings.json");
}

export function loadGithubSettings(file, { readFileSync = fs.readFileSync } = {}) {
  if (!file) return emptyGithubSettings();
  try {
    return normalizeGithubSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return emptyGithubSettings();
    return emptyGithubSettings();
  }
}

export function saveGithubSettings(file, update, deps = {}) {
  const previous = loadGithubSettings(file, deps);
  const next = normalizeGithubSettings({
    ...previous,
    ...update,
    token: typeof update?.token === "string" && update.token !== "" ? update.token : previous.token,
    labels: { ...previous.labels, ...(update?.labels ?? {}) },
  });
  if (update?.clearToken) next.token = "";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return publicGithubSettings(next);
}

function githubHeaders(token, etag) {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "harness-office",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(etag ? { "if-none-match": etag } : {}),
  };
}

export function redactGithub(text, token) {
  let out = String(text ?? "");
  if (token && token.length > 3) out = out.split(token).join("[redacted]");
  return out.slice(0, 400);
}

export async function testGithubConnection(settings, fetchImpl, timeoutMs = 20000) {
  const normalized = normalizeGithubSettings(settings);
  if (!normalized.token) return { ok: false, detail: "尚未設定 GitHub token。" };
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${normalized.owner}/${normalized.repo}`, {
      headers: githubHeaders(normalized.token),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, detail: "連不到 GitHub。" };
  }
  const raw = await response.text();
  if (!response.ok) return { ok: false, status: response.status, detail: redactGithub(raw, normalized.token) };
  const body = JSON.parse(raw);
  return {
    ok: true,
    fullName: body.full_name,
    permissions: body.permissions ?? {},
    scopes: response.headers.get("x-oauth-scopes") || "",
  };
}

export function roleForLabels(labels, mapping = DEFAULT_LABELS) {
  for (const label of labels ?? []) {
    const name = String(label.name || label).toLowerCase();
    if (mapping[name]) return mapping[name];
  }
  return null;
}

export function toBoardIssue(issue, role) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state || "open",
    url: issue.html_url || issue.url,
    author: issue.user?.login || issue.author || "",
    labels: (issue.labels ?? []).map((label) => ({
      name: label.name || String(label),
      color: label.color ? `#${String(label.color).replace(/^#/, "")}` : "#d73a4a",
    })),
    assignees: role ? [role] : (issue.assignees ?? []).map((item) => item.login || item),
    taken: Boolean(role),
    createdAt: issue.created_at || issue.createdAt || "",
    updatedAt: issue.updated_at || issue.updatedAt || "",
    body: "",
    comments: issue.comments || 0,
    role: role || null,
  };
}

export async function fetchIssues({ settings, fetchImpl, etag, timeoutMs = 20000 }) {
  const normalized = normalizeGithubSettings(settings);
  if (!normalized.token) return { ok: false, detail: "尚未設定 GitHub token。" };
  let response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${normalized.owner}/${normalized.repo}/issues?state=open&per_page=30`,
      { headers: githubHeaders(normalized.token, etag), signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch {
    return { ok: false, detail: "連不到 GitHub。" };
  }
  if (response.status === 304) return { ok: true, notModified: true, etag };
  const raw = await response.text();
  if (!response.ok) return { ok: false, status: response.status, detail: redactGithub(raw, normalized.token) };
  const body = JSON.parse(raw);
  const issues = body.filter((item) => !item.pull_request).map((item) => toBoardIssue(item, roleForLabels(item.labels, normalized.labels)));
  return { ok: true, notModified: false, etag: response.headers.get("etag"), issues };
}

function canonicalRole(token) {
  const folded = String(token || "").trim().toLowerCase();
  return ROLES.find((role) => role.toLowerCase() === folded) || null;
}

export function parseGithubCommand(text) {
  const parsed = parseAddress(text);
  if (!parsed?.role) return null;
  const body = parsed.body || "";
  const give = body.match(/#(\d+)\s*給\s*(Tech Lead|FE|BE|QA|PM)/i);
  if (give) return { type: "assign", number: Number(give[1]), role: canonicalRole(give[2]), by: parsed.role };
  const look = body.match(/看一下\s*#(\d+)/);
  if (look) return { type: "assign", number: Number(look[1]), role: parsed.role, by: parsed.role };
  return null;
}

export function commentBody(role, displayName, text, marker) {
  const who = displayName && displayName !== role ? `${role} ${displayName}` : role;
  return `**${who}**\n\n${text}\n\n<!-- ${marker} -->`;
}

export async function publishComment({ settings, fetchImpl, owner, repo, number, body, marker, timeoutMs = 20000 }) {
  const normalized = normalizeGithubSettings({ ...settings, owner, repo });
  const listUrl = `https://api.github.com/repos/${normalized.owner}/${normalized.repo}/issues/${number}/comments?per_page=100`;
  const existing = await fetchImpl(listUrl, { headers: githubHeaders(normalized.token), signal: AbortSignal.timeout(timeoutMs) });
  if (existing.ok) {
    const comments = JSON.parse(await existing.text());
    const prior = comments.find((item) => String(item.body || "").includes(marker));
    if (prior) return { ok: true, duplicate: true, url: prior.html_url, id: prior.id };
  }
  const created = await fetchImpl(`https://api.github.com/repos/${normalized.owner}/${normalized.repo}/issues/${number}/comments`, {
    method: "POST",
    headers: { ...githubHeaders(normalized.token), "content-type": "application/json" },
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await created.text();
  if (!created.ok) return { ok: false, status: created.status, detail: redactGithub(raw, normalized.token) };
  const saved = JSON.parse(raw);
  return { ok: true, duplicate: false, url: saved.html_url, id: saved.id };
}

export function pullRequestPlan(issue, defaultBranch = "main") {
  const slug = String(issue.title || "issue")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "issue";
  const branch = `harness/${issue.number}-${slug}`;
  if (branch === defaultBranch || branch === "main" || branch === "master") {
    return { ok: false, detail: "不會推送到預設分支。" };
  }
  return {
    ok: true,
    branch,
    title: issue.title,
    body: `Closes #${issue.number}\n\n<!-- harness-office:pr-${issue.number} -->`,
    base: defaultBranch,
  };
}

export function opencodeCommand(worktree, issue) {
  return ["opencode", "run", "--dir", worktree, `Handle GitHub issue #${issue.number}: ${issue.title}. Do not push.`];
}

export function findOpencode(env = process.env) {
  const listed = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of listed) {
    const file = path.join(dir, "opencode");
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // Keep looking.
    }
  }
  return null;
}
