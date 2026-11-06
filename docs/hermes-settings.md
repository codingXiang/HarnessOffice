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
| API 憑證 | `API_SERVER_KEY`。只放設定檔。 |
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
POST {apiBase}/p/{profile}/api/sessions                id 固定為 ho-{profile}
POST {apiBase}/p/{profile}/api/sessions/{id}/chat/stream
```

`/health` 不需憑證，用來分出「連不上」。`/v1/capabilities` 回 401/403 是憑證錯誤，Hire 與回覆都失敗，不會改口說 Mock 成功。

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

## 還沒在這台雲端跑過的部分

這份 repo 的測試用的是實作上述路由的契約替身，不是一組已付費、已登入模型的 Hermes。要在你的機器上看到模型真的回話，還需要你自己的 Hermes：

1. API server 開著，`API_SERVER_KEY` 填進畫面上的憑證。
2. `gateway.multiplex_profiles` 開啟，這樣 `/p/<profile>/` 才是那個 Bot。
3. 每個 secondary profile 有自己的 `API_SERVER_KEY`（Hermes 不接受用 default 的 key 打別人的前綴）。目前這份設定檔只有一把憑證；若 secondary profile 的 key 不同，對話會以 401 停住，不會假裝成功。
4. 模型供應者的憑證在 Hermes 那一側。沒有它時，profile 與 session 仍可建立，`chat/stream` 會失敗，畫面顯示拒絕或中斷，不會編成一段假回覆。

OpenCode 與 GitHub 寫入不在這一步。
