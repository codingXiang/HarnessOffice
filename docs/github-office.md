# GitHub on the office page

Settings live in `github.json` next to the Hermes settings. On the office host that directory is `/home/box/harness-office-iac/` when the process can write there. The file mode is `0600`. The browser only sees `tokenSet`, never the token.

A fine-grained PAT needs:

- Repository access to the configured repo (default `codingXiang/HarnessOffice`)
- Issues: read and write
- Contents: read and write
- Pull requests: read and write
- Metadata: read

**測試連線** calls `GET /repos/{owner}/{repo}` and shows the repo full name plus the `permissions` object GitHub returns. It does not print the token.

A Project is one Hermes group. It has its own Group Chat, its own roster, and its own assignments, drafts, and pull requests. It is bound to at least one GitHub repo. The settings drawer can create, edit, and delete projects: name, Hermes group name, repos, a token or the shared default, and a label map. A blank repo token uses the shared token. The public settings list `tokenSet` and never return a token.

An older `github.json` that only has `owner`, `repo`, and `token` — or a list of repos from the previous settings screen — is read as the default project `harness-office`, group name `HarnessOffice`, bound to those repos. On startup the current `session.json` (the office that already has HR and anyone who was hired) is wrapped into that same project. Messages, the roster, and GitHub assignments stay. Nothing is dropped.

Bots are hired per project. A role seated in one group is not seated in another. The default project keeps the profile names that already exist (`qa-he`, `pm-lin`, and the others), so a running Hermes session is not renamed. A later project hiring the same candidate uses the profile `<project id>--<candidate id>` and its own Hermes session, so the two groups do not share a transcript.

The panel shows the current project and a button for each one. The browser remembers the last project in `localStorage` under `ho-active-project` (the project id only). Switching loads that group's chat, the people in the 3D office, their head bubbles, and that group's issue board.

`owner/repo#12`, `alias#12`, and a GitHub issue URL that belong to another project switch to that group and deliver the message there. A new issue polled from another project's repo raises a notice. If the composer is empty, the panel follows it. If the person is still typing, the panel shows **切換到 …** and leaves the draft alone. A plain `#12` that exists in more than one group stays put and asks which group.

Enabled repos are polled one at a time with `If-None-Match`. Inside one project the board can show every bound repo or one of them. Each issue carries a repo badge. Comments and pull requests go to that issue's own repo. OpenCode gets a cached clone per repo under `harness-office-repos/<owner>/<repo>`.

Assignment stays on that project's record in `session.json`. `@PM 把 #12 給 FE` and `@FE 看一下 #12` assign a role that is already in that group. The character card then says `working on #12`.

A comment is a draft until someone presses **發布到 GitHub**. The body is signed with the role name and an HTML marker `harness-office:<draft id>`. Posting again finds that marker and does not add a second comment. **自動發布** defaults off.

**開 PR** is also a button. The branch is `harness/<issue>-<slug>`. The office never pushes `main` or `master`, never force-pushes, and never merges. The PR body contains `Closes #<issue>`.

OpenCode is invoked only after that confirmation, and only if `opencode` is on `PATH`:

```text
opencode run --dir <isolated worktree> "Handle GitHub issue #N: <title>. Do not push."
```

The office finds `opencode` by walking `PATH`. On the office host that includes `/home/box/.opencode/bin`. This VM does not have `opencode` (`command -v opencode` is empty, and `/home/box` is not on this machine). In that case the office says so and does not create a worktree or push a branch.
