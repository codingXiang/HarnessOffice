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

const PROJECT_COLORS = ["#118ab2", "#ef476f", "#06d6a0", "#ffd166", "#9b5de5", "#f78c6b"];

export function emptyGithubSettings() {
  return {
    owner: "codingXiang",
    repo: "HarnessOffice",
    token: "",
    pollSeconds: 60,
    autoPost: false,
    labels: { ...DEFAULT_LABELS },
    projects: [projectRecord({ owner: "codingXiang", repo: "HarnessOffice", alias: "ho" }, 0)],
  };
}

function projectRecord(raw, index) {
  const owner = String(raw?.owner || "").trim();
  const repo = String(raw?.repo || "").trim();
  return {
    id: String(raw?.id || (owner && repo ? `${owner}/${repo}` : `project-${index}`)),
    alias: String(raw?.alias || "").trim(),
    owner,
    repo,
    token: String(raw?.token || ""),
    enabled: raw?.enabled !== false,
    labels: raw?.labels && typeof raw.labels === "object" ? { ...raw.labels } : null,
    color: PROJECT_COLORS[index % PROJECT_COLORS.length],
  };
}

export function normalizeGithubSettings(raw) {
  const base = emptyGithubSettings();
  const poll = Number(raw?.pollSeconds);
  const source = Array.isArray(raw?.projects)
    ? raw.projects
    : [{ owner: raw?.owner || base.owner, repo: raw?.repo || base.repo, alias: raw?.alias || "ho" }];
  const projects = source.map(projectRecord).filter((item) => item.owner && item.repo);
  const list = projects.length > 0 ? projects : base.projects;
  return {
    owner: list[0].owner,
    repo: list[0].repo,
    token: String(raw?.token || ""),
    pollSeconds: Number.isFinite(poll) ? Math.min(600, Math.max(15, poll)) : base.pollSeconds,
    autoPost: raw?.autoPost === true,
    labels: { ...base.labels, ...(raw?.labels ?? {}) },
    projects: list,
  };
}

export function publicGithubSettings(settings) {
  const normalized = normalizeGithubSettings(settings);
  return {
    configured: normalized.projects.some((project) => project.enabled && (project.token || normalized.token)),
    owner: normalized.owner,
    repo: normalized.repo,
    pollSeconds: normalized.pollSeconds,
    autoPost: normalized.autoPost,
    labels: normalized.labels,
    tokenSet: normalized.token !== "",
    projects: normalized.projects.map((project) => ({
      id: project.id,
      alias: project.alias,
      owner: project.owner,
      repo: project.repo,
      enabled: project.enabled,
      color: project.color,
      labels: project.labels,
      tokenSet: project.token !== "",
      usesSharedToken: project.token === "",
    })),
  };
}

export function tokenFor(settings, project) {
  return project?.token || normalizeGithubSettings(settings).token || "";
}

export function labelsFor(settings, project) {
  const normalized = normalizeGithubSettings(settings);
  return { ...normalized.labels, ...(project?.labels || {}) };
}

export function nextEnabledProject(projects, cursor = 0) {
  const enabled = (projects ?? []).filter((project) => project.enabled !== false);
  if (enabled.length === 0) return null;
  return enabled[((cursor % enabled.length) + enabled.length) % enabled.length];
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

function mergeProjectList(previous, update) {
  if (Array.isArray(update?.projects)) {
    return update.projects.map((item) => {
      const prior = previous.projects.find((project) => project.id === item.id || (project.owner === item.owner && project.repo === item.repo));
      return { ...prior, ...item, token: item.token ? item.token : (prior?.token || ""), labels: item.labels ?? prior?.labels ?? null };
    });
  }
  if (update?.owner || update?.repo) {
    const first = previous.projects[0] || {};
    const owner = update.owner || first.owner;
    const repo = update.repo || first.repo;
    return [{ ...first, owner, repo, id: `${owner}/${repo}` }];
  }
  return previous.projects;
}

export function saveGithubSettings(file, update, deps = {}) {
  const previous = loadGithubSettings(file, deps);
  const next = normalizeGithubSettings({
    ...previous,
    ...update,
    token: update?.clearToken ? "" : (typeof update?.token === "string" && update.token !== "" ? update.token : previous.token),
    labels: { ...previous.labels, ...(update?.labels ?? {}) },
    projects: mergeProjectList(previous, update),
  });
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

export async function fetchIssues({ settings, project, fetchImpl, etag, timeoutMs = 20000 }) {
  const normalized = normalizeGithubSettings(settings);
  const target = project || normalized.projects[0];
  const token = tokenFor(normalized, target);
  if (!token) return { ok: false, detail: "尚未設定 GitHub token。" };
  let response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${target.owner}/${target.repo}/issues?state=open&per_page=30`,
      { headers: githubHeaders(token, etag), signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch {
    return { ok: false, detail: "連不到 GitHub。" };
  }
  if (response.status === 304) return { ok: true, notModified: true, etag, projectId: target.id };
  const raw = await response.text();
  if (!response.ok) return { ok: false, status: response.status, detail: redactGithub(raw, token) };
  const body = JSON.parse(raw);
  const issues = body.filter((item) => !item.pull_request).map((item) => {
    const board = toBoardIssue(item, roleForLabels(item.labels, labelsFor(normalized, target)));
    board.labels = [{ name: target.alias || target.repo, color: String(target.color || "#118ab2").replace("#", "") }, ...board.labels];
    return {
      ...board,
      projectId: target.id,
      alias: target.alias,
      owner: target.owner,
      repo: target.repo,
      color: target.color,
    };
  });
  return { ok: true, notModified: false, etag: response.headers.get("etag"), projectId: target.id, issues };
}

export function parseIssueRef(text) {
  const source = String(text || "");
  const url = source.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i);
  if (url) return { owner: url[1], repo: url[2], number: Number(url[3]) };
  const full = source.match(/(?:^|\s)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)/);
  if (full) return { owner: full[1], repo: full[2], number: Number(full[3]) };
  const alias = source.match(/(?:^|\s)([A-Za-z][A-Za-z0-9_.-]*)#(\d+)/);
  if (alias) return { alias: alias[1], number: Number(alias[2]) };
  const plain = source.match(/#(\d+)/);
  if (plain) return { number: Number(plain[1]) };
  return null;
}

export function resolveProject(ref, { projects = [], issues = [], activeProjectId = null, botProjectId = null } = {}) {
  const enabled = projects.filter((project) => project.enabled !== false);
  if (ref?.owner && ref?.repo) {
    const hit = enabled.find((project) => project.owner.toLowerCase() === ref.owner.toLowerCase() && project.repo.toLowerCase() === ref.repo.toLowerCase());
    return hit ? { project: hit } : { missing: true };
  }
  if (ref?.alias) {
    const hit = enabled.find((project) => project.alias.toLowerCase() === ref.alias.toLowerCase());
    return hit ? { project: hit } : { missing: true };
  }
  const holders = issues.filter((issue) => issue.number === ref?.number);
  const ids = [...new Set(holders.map((issue) => issue.projectId).filter(Boolean))];
  const preferred = botProjectId || activeProjectId;
  if (ids.length === 1) return { project: enabled.find((project) => project.id === ids[0]) || { id: ids[0] } };
  if (ids.length > 1) {
    if (preferred && ids.includes(preferred)) return { project: enabled.find((project) => project.id === preferred) };
    return { ambiguous: holders.map((issue) => ({ projectId: issue.projectId, alias: issue.alias, owner: issue.owner, repo: issue.repo, number: issue.number, title: issue.title })) };
  }
  if (preferred) {
    const hit = enabled.find((project) => project.id === preferred);
    if (hit) return { project: hit };
  }
  if (enabled.length === 1) return { project: enabled[0] };
  return { ambiguous: enabled.map((project) => ({ projectId: project.id, alias: project.alias, owner: project.owner, repo: project.repo, number: ref?.number })) };
}

export function repoWorktree(owner, repo, root = path.join(os.tmpdir(), "harness-office-repos")) {
  return path.join(root, owner, repo);
}

function canonicalRole(token) {
  const folded = String(token || "").trim().toLowerCase();
  return ROLES.find((role) => role.toLowerCase() === folded) || null;
}

export function parseGithubCommand(text) {
  const parsed = parseAddress(text);
  if (!parsed?.role) return null;
  const body = parsed.body || "";
  const ref = parseIssueRef(body);
  const give = body.match(/#(\d+)\s*給\s*(Tech Lead|FE|BE|QA|PM)/i);
  if (give) return { type: "assign", number: Number(give[1]), role: canonicalRole(give[2]), by: parsed.role, ref };
  if (/看一下/.test(body) && ref) return { type: "assign", number: ref.number, role: parsed.role, by: parsed.role, ref };
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
