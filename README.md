# HarnessOffice

HarnessOffice 是一間有遊戲感的 AI 辦公室：HR、PM 等角色出現在像素風的 Office，Hermes 是這些角色的 runtime，OpenCode 負責寫程式，而 GitHub（以及之後的 GitLab）是 Issue 與 PR 的真實來源。

HarnessOffice is a game-like AI office. Roles such as HR and PM appear in a pixel Office, Hermes is their runtime, OpenCode does the coding, and GitHub — with GitLab as a later secondary tracker — is the source of truth for Issues and PRs.

## 開發流程

開發沿用 [Matt Pocock 的 engineering skills](https://github.com/mattpocock/skills)：

`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement-spec`

已定案的 grill 決定在 [`GLOSSARY.md`](GLOSSARY.md) 與 [`docs/adr/`](docs/adr/)。

## 跑 Mock mode demo

靜態頁不能把 Bot profile 寫進 IaC store，所以 demo 用一個沒有相依套件的本機 server。它只模擬：不呼叫 Hermes、OpenCode，也不寫 GitHub。

```bash
npm start
```

同等指令：`node demo/server.mjs`

預設聽 `0.0.0.0:4173`，同一台機器用 http://127.0.0.1:4173 ，Tailscale 用這台機器的位址。只給本機：`HOST=127.0.0.1 npm start`

預設把 Hire 的 Bot profile 寫到 `~/harness-office-iac/bots/`。那個目錄不可寫時，改寫到專案裡的 `./.iac-bots/`（已在 `.gitignore`，不要提交）。頁尾會寫出實際路徑。要指定目錄：

```bash
HARNESS_IAC_BOTS=/你的/bots npm start
```

行為測試：`npm test`

建議走一遍：開場只有 HR → `@HR PM` 再按 Hire → 同樣 Hire Tech Lead、FE、BE → `@PM 做一個像素 Office` → 核准 Issue → `@Tech Lead 分派` → 播放寫程式動畫。動畫結束是一張沒有送出的 Mock PR。

Skills 以可編輯複本裝在 [`.agents/skills/`](.agents/skills/)（Cursor 的 installer 路徑；清單在 [`skills-lock.json`](skills-lock.json)）。一次性設定寫在 [`AGENTS.md`](AGENTS.md)：

- Issue tracker：此 repo 的 GitHub Issues（`codingXiang/HarnessOffice`）。GitLab 只是未來的次要 tracker。見 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。
- Triage 標籤：[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。
- 領域文件：根目錄 [`GLOSSARY.md`](GLOSSARY.md)，ADR 放在 [`docs/adr/`](docs/adr/)。說明見 [`docs/README.md`](docs/README.md) 與 [`docs/agents/domain.md`](docs/agents/domain.md)。

產品本體還沒有接上 Hermes 或 OpenCode。現在能跑的是上面的 Mock mode demo。授權見 [LICENSE](LICENSE)（GPL-3.0）。裝進來的 skills 來自 mattpocock/skills，保留其 MIT 授權（[`.agents/skills/LICENSE`](.agents/skills/LICENSE)）。
