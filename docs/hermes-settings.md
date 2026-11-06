# Hermes 設定與 Group Chat

設定由 chat 頁填，不寫死 host。這是 [ADR 0003](adr/0003-hermes-settings-come-from-the-ui.md)。空著就是 Mock mode。憑證只寫進操作者機器上的設定檔，API 不回傳，日誌與畫面也不印出。

## 填在哪

Chat 頁的 **Hermes 設定**。儲存後寫入 `~/harness-office-iac/hermes.json`（不能寫時是 `./.hermes-settings.json`，已 gitignore）。同一個目錄的 `session.json` 是這間 Group Chat 的權威紀錄：誰在場、每則訊息的 id、每個 Bot 的 profile 名稱與 API session id。重開 demo 會讀回，不會再建立同一個 profile 或同一則已完成的訊息。

上一則還標成「正在回覆」的訊息，重開會改成中斷，而且不會自動重送，避免同一則打兩次模型。

瀏覽器不再保存憑證。

## 欄位

| 欄位 | 意義 |
| --- | --- |
| API base | Hermes API server 的來源，例如 `https://hermes.example`。不要加路徑。 |
| Dashboard base | 留白表示跟 API base 相同。`POST /api/profiles` 打這裡。 |
| API 憑證 | `API_SERVER_KEY`。只放設定檔。新 profile 的同一把 key 由 server 寫入。 |
| Dashboard 憑證 | `HERMES_DASHBOARD_SESSION_TOKEN`。建立 profile 與寫入 `API_SERVER_KEY` 都用它。留白不會讀頁面。 |
| Bot clone from / provider / model | dashboard `ProfileCreate` 的 `clone_from`、`provider`、`model`。 |
| Group Chat 名稱 | 寫進該 Bot 的 API session 標題：`Group: 名稱`。 |

舊檔若只有 `endpoint: https://host/api/profiles`，會當成 API base `https://host`。舊的 `roomId` 不再送出。

## 實際打的路由

對過 NousResearch/hermes-agent 的公開程式（`gateway/platforms/api_server.py`、`hermes_cli/web_routers/profiles.py`）與 [API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)、[Gateway Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals)：

```text
GET  {apiBase}/health
GET  {apiBase}/v1/capabilities                         Bearer
GET  {apiBase}/p/__ho_probe__/health                   404 = multiplex 有開；200 = 前綴被忽略
POST {dashboardBase}/api/profiles                      ProfileCreate
PUT  {dashboardBase}/api/env                           EnvVarUpdate，profile 在 body 或 query
POST {apiBase}/p/{profile}/api/sessions                id 固定為 ho-{profile}
POST {apiBase}/p/{profile}/api/sessions/{id}/chat/stream
```

`/health` 不需憑證，用來分出「連不上」。`/v1/capabilities` 回 401/403 是 API server 憑證錯誤。`POST /api/profiles` 只用畫面上的 Dashboard 憑證，對應你自己設在 Hermes 的 `HERMES_DASHBOARD_SESSION_TOKEN`（見 Hermes 的 [Web Dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)）。留白就不會建立 profile，也不會去讀 dashboard 的 HTML、cookie 或頁面裡的 token。API 憑證不會拿去當 dashboard 憑證。兩把憑證都只寫在設定檔，GET 不回傳。

`clone_from=default` 不會把 `.env` 的 `API_SERVER_KEY` 複製到新 profile。新 profile 建立成功之後、開 session 之前，Hire 用同一把 Dashboard 憑證呼叫 `PUT /api/env`，body 是 `{"key":"API_SERVER_KEY","value":"<畫面上的 API 憑證>","profile":"<candidate id>"}`。這是 dashboard 的 [EnvVarUpdate](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/web_models.py)。寫入失敗就停止，不會開 session，也不會編成回覆。

同名 profile 若不是這個 HarnessOffice 建立的，不寫它的 key，並在對話裡說明衝突。已經由這裡建立、session 仍拒絕憑證的 profile，才會再寫一次同一把 API 憑證然後重試 session。

`chat/stream` 若沒有模型供應者，上游會先送 `assistant.completed` 且 `completed: false`，接著 `run.failed`。那段警告不是 Role 的回覆，畫面只把它當成失敗。

Profile 名稱用 Candidate id（例如 `pm-lin`）。遠端回 409，或 400 且內容含 already exists，視為同一個 Bot，不另取名字。Session id 也是固定的；409 代表沿用。

`/p/<profile>/` 只有在 Hermes 開了 `gateway.multiplex_profiles` 才會進到那個 profile。沒開時，前綴會被 API server 忽略、請求落到 default profile。那種情況只建立 profile，Group Chat **不會**把 default profile 的回覆當成這個 Role，也不會改回 Mock 劇本。

## 為什麼沒有 groups.send

Gateway Internals 寫明：canonical WebSocket 的 `groups.*` 是房間中繼資料。該表面回報 `driver: false`，不執行群組裡的一輪對話，也不廣告 send。bot-forge 的 `create_agent` 是 agent 內部工具，不是 HTTP。所以這裡不呼叫那些路由，也不把自編的 room id 說成 Hermes 已註冊的房間。

Group Chat 的權威紀錄在 HarnessOffice 的 `session.json`。每一則 `@Role`（向 HR 要 Candidate 除外）送到該 Bot 自己的 API session。回覆寫回同一份紀錄，並推到 3D 頁。

## Hire / 對話怎麼分支

```text
沒有 API base
  Mock Hire，Mock 劇本
連不上 /health
  Mock Hire，對話寫明連不上
憑證 401/403、profile 或 session 被拒、串流錯誤、內容毀損、取消、中斷
  不當成成功回覆，也不改口說 Mock 成功
profile 建立了，但 multiplex 沒開
  Bot 出現在 Office，對話明講送不進該 profile
multiplex 有開，session 建立成功
  @Role 走 chat/stream；tool.started 時 3D 角色是 working / reading
  assistant.completed 且 run.completed 才把文字放到頭上
```

3D（port 4600）只顯示這份紀錄。`HARNESS_VISUAL_URL`（預設 `http://127.0.0.1:4600`）接收快照。3D 連上時也會向 `HARNESS_CHAT_URL`（預設 `http://127.0.0.1:4173`）拉一次 `/api/session/visual`。同一個 message id 不會講第二次。

## 在目前 upstream 上核對過的部分

2026-11-06 用官方安裝腳本 `install.sh --channel main --non-interactive --skip-browser --skip-computer-use` 裝了 NousResearch/hermes-agent `9242ce464b4a84fb8b7a81df18400099d2a1a790`（Hermes Agent v0.23.0+125.g9242ce4）。在這台雲端 VM 上對本機 gateway `127.0.0.1:8642` 與 dashboard `127.0.0.1:9119` 打過，沒有登入任何模型供應者：

- `GET /health` → 200 `{"status":"ok","platform":"hermes-agent","version":"0.23.0"}`
- `GET /v1/capabilities` 無憑證 → 401 `gateway_auth_failed`；帶 Bearer → 200，且 `session_chat` / `session_chat_streaming` 為 true
- `GET /p/__ho_probe__/health` → 404 `Unknown or unconfigured profile`（`gateway.multiplex_profiles: true`）
- `POST /api/profiles` 沒有另外設定的 dashboard session token → 401。HarnessOffice 不從頁面取出 token。操作者把 `HERMES_DASHBOARD_SESSION_TOKEN` 填進 Dashboard 憑證之後，同一個名字建立成功是 200，再送一次是 400，detail 含 `already exists`
- `POST /api/profiles` 帶 `clone_from=default` 之後，新 profile 的 `.env` 沒有 `API_SERVER_KEY`。同一支 dashboard 的 `PUT /api/env`（`EnvVarUpdate`：`key`、`value`、`profile`；query 的 `profile` 也行）用 Dashboard session token（`Authorization: Bearer` 或 `X-Hermes-Session-Token`）寫入。寫完之後用那把 key `POST /p/<profile>/api/sessions` → 201；default 的 key 對這個 profile 仍是 401。沒有呼叫 `chat/stream`，也沒有複製 `auth.json`
- 該 profile 沒有自己的 `API_SERVER_KEY` 時，`POST /p/<profile>/api/sessions` → 401。寫上同一把 key 之後 → 201，session id 就是我們送的 `ho-<profile>`。再送一次 → 409 `session_exists`。`GET` 仍看得到同一筆
- `POST .../chat/stream` 沒有模型憑證 → HTTP 200 的 SSE，`assistant.completed` 的 `completed` 是 false，接著 `run.failed`。runtime 的 provider 與 model 都是空的。沒有模型回覆

還沒有的是模型供應者憑證（`hermes model` / 對應的 API key，或 Nous Portal 登入）。沒有它就不會有真正的 Bot 回話。契約替身測試仍然在 `npm test` 裡，和這次上游程序是分開的。

OpenCode 與 GitHub 寫入不在這一步。
