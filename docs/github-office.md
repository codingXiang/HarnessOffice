# GitHub on the office page

Settings live in `github.json` next to the Hermes settings. On the office host that directory is `/home/box/harness-office-iac/` when the process can write there. The file mode is `0600`. The browser only sees `tokenSet`, never the token.

A fine-grained PAT needs:

- Repository access to the configured repo (default `codingXiang/HarnessOffice`)
- Issues: read and write
- Contents: read and write
- Pull requests: read and write
- Metadata: read

**測試連線** calls `GET /repos/{owner}/{repo}` and shows the repo full name plus the `permissions` object GitHub returns. It does not print the token.

Several projects can be stored in the same file. An older file that only has `owner`, `repo`, and `token` is read as one project, and the token stays the shared default. Each project can have its own token, alias, enabled flag, and label map. A blank project token uses the shared one. The public settings list `tokenSet` per project and never return a token.

Enabled projects are polled one at a time with `If-None-Match`. The panel can show all of them or one project. Each issue carries a repo badge. The same list is pushed to the 3D board as `gh.issues`.

`owner/repo#12`, `alias#12`, and a GitHub issue URL select that project. A plain `#12` uses the active project, or the assigned bot's project. If the number exists in more than one project and there is no context, the office asks which one and the panel shows a button per project. The active project follows the last issue a person or bot touched. The panel shows it and a click on a project name overrides it.

Assignment stays in `session.json` (`github.assignments`, keyed by project and number). `@PM 把 #12 給 FE` and `@FE 看一下 #12` assign a role that is already in the office. The character card then says `working on #12`. Comments and pull requests are sent to that issue's own repo. OpenCode gets a cached clone per repo under the host temp directory `harness-office-repos/<owner>/<repo>`.

A comment is a draft until someone presses **發布到 GitHub**. The body is signed with the role name and an HTML marker `harness-office:<draft id>`. Posting again finds that marker and does not add a second comment. **自動發布** defaults off.

**開 PR** is also a button. The branch is `harness/<issue>-<slug>`. The office never pushes `main` or `master`, never force-pushes, and never merges. The PR body contains `Closes #<issue>`.

OpenCode is invoked only after that confirmation, and only if `opencode` is on `PATH`:

```text
opencode run --dir <isolated worktree> "Handle GitHub issue #N: <title>. Do not push."
```

The office finds `opencode` by walking `PATH`. On the office host that includes `/home/box/.opencode/bin`. This VM does not have `opencode` (`command -v opencode` is empty, and `/home/box` is not on this machine). In that case the office says so and does not create a worktree or push a branch.
