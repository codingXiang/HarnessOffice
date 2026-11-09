import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commentBody,
  fetchIssues,
  findOpencode,
  parseGithubCommand,
  publicGithubSettings,
  publishComment,
  pullRequestPlan,
  roleForLabels,
  saveGithubSettings,
  testGithubConnection,
} from "./github.mjs";

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("GitHub settings stay on disk and the public view has no token", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ho-gh-"));
  const file = path.join(dir, "github.json");
  const saved = saveGithubSettings(file, { owner: "codingXiang", repo: "HarnessOffice", token: "ghp-fixture", pollSeconds: 5, autoPost: true });
  assert.equal(saved.tokenSet, true);
  assert.equal(Object.hasOwn(saved, "token"), false);
  assert.equal(saved.pollSeconds, 15);
  assert.equal(saved.autoPost, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, "utf8").includes("ghp-fixture"), true);
  const kept = saveGithubSettings(file, { token: "" });
  assert.equal(kept.tokenSet, true);
  assert.equal(publicGithubSettings({ token: "ghp-fixture" }).configured, true);
});

test("fixture issues use ETag and map labels to roles", async () => {
  assert.equal(roleForLabels([{ name: "frontend" }]), "FE");
  assert.equal(roleForLabels([{ name: "bug" }]), "QA");
  const calls = [];
  const first = await fetchIssues({
    settings: { token: "ghp-fixture", owner: "codingXiang", repo: "HarnessOffice" },
    etag: null,
    fetchImpl: async (url, init) => {
      calls.push({ url, etag: init.headers["if-none-match"] || "" });
      return json(200, [{ number: 12, title: "fixture：看板", html_url: "https://github.com/codingXiang/HarnessOffice/issues/12", labels: [{ name: "backend", color: "ededed" }], user: { login: "octo" }, pull_request: undefined }], { etag: "W/\"fixture\"" });
    },
  });
  assert.equal(first.issues[0].role, "BE");
  assert.equal(first.issues[0].number, 12);
  const second = await fetchIssues({
    settings: { token: "ghp-fixture" },
    etag: "W/\"fixture\"",
    fetchImpl: async (_url, init) => {
      calls.push({ etag: init.headers["if-none-match"] });
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(second.notModified, true);
  assert.equal(calls[1].etag, "W/\"fixture\"");
});

test("chat assigns an issue and a comment posts once", async () => {
  assert.deepEqual(parseGithubCommand("@PM 把 #12 給 FE"), { type: "assign", number: 12, role: "FE", by: "PM" });
  assert.deepEqual(parseGithubCommand("@FE 看一下 #12"), { type: "assign", number: 12, role: "FE", by: "FE" });
  assert.equal(parseGithubCommand("@HR PM"), null);
  const body = commentBody("FE", "吳像素", "fixture：這則草稿不是模型回覆。", "harness-office:d12-FE");
  assert.match(body, /FE 吳像素/);
  assert.match(body, /harness-office:d12-FE/);
  let posts = 0;
  const result = await publishComment({
    settings: { token: "ghp-fixture" },
    owner: "codingXiang",
    repo: "HarnessOffice",
    number: 12,
    body,
    marker: "harness-office:d12-FE",
    fetchImpl: async (url, init) => {
      if (init.method === "POST") {
        posts += 1;
        assert.equal(url.endsWith("/issues/12/comments"), true);
        return json(201, { id: 9, html_url: "https://github.com/codingXiang/HarnessOffice/issues/12#issuecomment-9" });
      }
      return json(200, [{ id: 9, body, html_url: "https://github.com/codingXiang/HarnessOffice/issues/12#issuecomment-9" }]);
    },
  });
  assert.equal(result.duplicate, true);
  assert.equal(posts, 0);
});

test("a pull request plan never targets the default branch", () => {
  const plan = pullRequestPlan({ number: 12, title: "Fixture board" }, "main");
  assert.equal(plan.ok, true);
  assert.equal(plan.branch, "harness/12-fixture-board");
  assert.match(plan.body, /Closes #12/);
  assert.equal(pullRequestPlan({ number: 1, title: "main" }, "harness/1-main").ok, false);
});

test("a connection check reports the repo and not the token", async () => {
  const result = await testGithubConnection({ token: "ghp-fixture", owner: "codingXiang", repo: "HarnessOffice" }, async () => json(200, {
    full_name: "codingXiang/HarnessOffice",
    permissions: { pull: true, push: true },
  }, { "x-oauth-scopes": "repo" }));
  assert.equal(result.fullName, "codingXiang/HarnessOffice");
  assert.equal(result.permissions.push, true);
  assert.equal(JSON.stringify(result).includes("ghp-fixture"), false);
  assert.equal(findOpencode({ PATH: "" }), null);
});
