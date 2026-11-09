# HarnessOffice

HarnessOffice 是一間有遊戲感的 AI 辦公室：HR、PM 等角色出現在像素風的 Office，Hermes 是這些角色的 runtime，OpenCode 負責寫程式，而 GitHub（以及之後的 GitLab）是 Issue 與 PR 的真實來源。

HarnessOffice is a game-like AI office. Roles such as HR and PM appear in a pixel Office, Hermes is their runtime, OpenCode does the coding, and GitHub — with GitLab as a later secondary tracker — is the source of truth for Issues and PRs.

## 開發流程

開發沿用 [Matt Pocock 的 engineering skills](https://github.com/mattpocock/skills)：

`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement-spec`

已定案的 grill 決定在 [`GLOSSARY.md`](GLOSSARY.md) 與 [`docs/adr/`](docs/adr/)。

## 跑 Mock mode demo

畫面分兩塊。瀏覽器是 Group Chat（Hire、核准、Mock PR）。像素辦公室是 [PixelOffice](https://github.com/KalebKE/PixelOffice) 的桌面視窗，授權是 Apache-2.0（見 [`vendor/README.md`](vendor/README.md)）。Chat 把 AgentEvent 轉送到同一台機器的 `127.0.0.1:3003`（HTTP）和 `127.0.0.1:9997`（UDP）。沒有 Hermes 設定時不會呼叫 Hermes。不會呼叫 OpenCode，也不寫 GitHub。

PixelOffice 沒有 npm 套件。它是 submodule：

```bash
git submodule update --init --depth 1 vendor/PixelOffice
```

需要 JDK 17。開兩個行程：

```bash
./scripts/run-pixel-office.sh
```

```bash
npm start
```

`npm start` 就是 `node demo/server.mjs`。Chat 預設聽 `0.0.0.0:4173`。本機打開 http://127.0.0.1:4173 。Tailscale 用這台機器的位址，同一個 port。只給本機：`HOST=127.0.0.1 npm start`。

PixelOffice 的事件 port 留在 loopback，因為轉送的是本機的 demo server，不是瀏覽器。對應是：Hire 讓角色出現（`upsert`），HR 在等人選 Candidate 時是 `waiting`，寫程式動畫是 `coding`，Mock PR 是 `success`。

Bot profile 仍寫到 `~/harness-office-iac/bots/`。那個目錄不可寫時，改寫 `./.iac-bots/`（已在 `.gitignore`）。指定目錄：`HARNESS_IAC_BOTS=/你的/bots npm start`。

行為測試：`npm test`

## 接上 Hermes（仍不寫 GitHub、不啟動 OpenCode）

Mock mode 仍是預設。Chat 與 3D 一起開：

```bash
npm install
npm run spike:office:client
./scripts/run-harness-office.sh
```

主頁是 `http://127.0.0.1:4600/?view=spectator`。對話、Hire、Hermes 設定都在這一頁。`http://127.0.0.1:4173` 仍是同一份 Group Chat 的後台頁，不必打開。`HOST` 預設 `0.0.0.0`，所以 Tailscale 打得到同一個 `/?view=spectator`。`CHAT_PORT` 與 `VISUAL_PORT` 可改。

在 chat 頁填 **API base**（只有來源，例如 `https://<你的 Hermes>`），不要在程式裡寫死 host。空著就繼續 Mock。設定與 Group Chat 紀錄在 `~/harness-office-iac/`（不能寫時在 repo 旁的隱藏檔），重開還在，憑證不進瀏覽器。

路由、multiplex、為什麼不呼叫 `groups.send`，寫在 [`docs/hermes-settings.md`](docs/hermes-settings.md)。決定本身是 [ADR 0003](docs/adr/0003-hermes-settings-come-from-the-ui.md)。

連得上且 multiplex 有開：Hire 建立 Bot profile 與穩定的 API session，`@Role` 走到 `chat/stream`，同一則文字出現在 Group Chat 和 3D 頭上。連不上是明示的 Mock。憑證錯誤、拒絕、毀損、取消都不會裝成成功。

建議走一遍：PixelOffice 裡先看到 HR → 在 chat `@HR PM` 再按 Hire → 同樣 Hire Tech Lead、FE、BE → `@PM 做一個像素 Office` → 核准 Issue → `@Tech Lead 分派` → 播放寫程式動畫。動畫結束是一張沒有送出的 Mock PR，FE 與 BE 在 PixelOffice 裡變成 success。

Skills 以可編輯複本裝在 [`.agents/skills/`](.agents/skills/)（Cursor 的 installer 路徑；清單在 [`skills-lock.json`](skills-lock.json)）。一次性設定寫在 [`AGENTS.md`](AGENTS.md)：

- Issue tracker：此 repo 的 GitHub Issues（`codingXiang/HarnessOffice`）。GitLab 只是未來的次要 tracker。見 [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)。
- Triage 標籤：[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)。
- 領域文件：根目錄 [`GLOSSARY.md`](GLOSSARY.md)，ADR 放在 [`docs/adr/`](docs/adr/)。說明見 [`docs/README.md`](docs/README.md) 與 [`docs/agents/domain.md`](docs/agents/domain.md)。

沒有填 Hermes 設定時，跑的就是上面的 Mock mode。OpenCode 與 GitHub 寫入仍不在這一步。授權見 [LICENSE](LICENSE)（GPL-3.0）。裝進來的 skills 來自 mattpocock/skills，保留其 MIT 授權（[`.agents/skills/LICENSE`](.agents/skills/LICENSE)）。

## 3D spike（agent-office 視覺層）

PixelOffice 的 Mock mode 還在：`npm start` 沒有改。旁邊另有一層薄的 3D 畫面，借用 [agent-office](https://github.com/AgentSystemLabs/agent-office) **v0.1.211**（commit `852e2ab`，MIT）的 Vite + three.js client。沒有接 Claude、Codex、OpenCode、GitHub floors 或 PTY。執行步驟、`/ws` 裡哪些 welcome 欄位是必填、以及這個 spike 不打算合併的範圍，寫在 [`docs/spike-agent-office-visual.md`](docs/spike-agent-office-visual.md)。Vendored 程式與 MIT 聲明在 [`vendor/agent-office/`](vendor/agent-office/)。
