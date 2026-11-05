# HarnessOffice

HarnessOffice 是一間有遊戲感的 AI 辦公室：HR、PM 等角色出現在像素風的 Office，Hermes 是這些角色的 runtime，OpenCode 負責寫程式，而 GitHub（以及之後的 GitLab）是 Issue 與 PR 的真實來源。

HarnessOffice is a game-like AI office. Roles such as HR and PM appear in a pixel Office, Hermes is their runtime, OpenCode does the coding, and GitHub — with GitLab as a later secondary tracker — is the source of truth for Issues and PRs.

## 開發流程

開發沿用 [Matt Pocock 的 engineering skills](https://github.com/mattpocock/skills)：

`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement-spec`

已定案的 grill 決定在 [`GLOSSARY.md`](GLOSSARY.md) 與 [`docs/adr/`](docs/adr/)。

Skills 以可編輯複本裝在 [`.agents/skills/`](.agents/skills/)（Cursor 的 installer 路徑；清單在 [`skills-lock.json`](skills-lock.json)）。一次性設定寫在 [`AGENTS.md`](AGENTS.md)：

- Issue tracker：此 repo 的 GitHub Issues（`codingXiang/HarnessOffice`）。GitLab 只是未來的次要 tracker。見 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。
- Triage 標籤：[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。
- 領域文件：根目錄 [`GLOSSARY.md`](GLOSSARY.md)，ADR 放在 [`docs/adr/`](docs/adr/)。說明見 [`docs/README.md`](docs/README.md) 與 [`docs/agents/domain.md`](docs/agents/domain.md)。

這裡還沒有產品程式，只有 skills 安裝與工程流程的骨架。授權見 [LICENSE](LICENSE)（GPL-3.0）。裝進來的 skills 來自 mattpocock/skills，保留其 MIT 授權（[`.agents/skills/LICENSE`](.agents/skills/LICENSE)）。
