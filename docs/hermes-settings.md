# Hermes 設定

Hermes 的 endpoint、Bot 與 Group Chat 設定由人在畫面上填，不寫死在 client、demo server 或 3D spike。這是 [ADR 0003](adr/0003-hermes-settings-come-from-the-ui.md)。空著就是 Mock mode。

## 填在哪

Chat 頁上方的 **Hermes 設定**。按「儲存設定」之後：

- 寫入操作者機器的 `~/harness-office-iac/hermes.json`（跟 IaC store 同一層，不在這個 repo）。
- 那個目錄不能寫時，改寫 `./.hermes-settings.json`（已在 `.gitignore`）。
- 瀏覽器同時把一份放進 `localStorage`（`harness-office.hermes-settings`）。Hire 讀的是檔案。若瀏覽器還留著 endpoint、檔案裡沒有，頁面會講明，而且仍是 Mock mode，直到你再按儲存。

重開 demo 會讀同一個檔。指定別的檔：`HARNESS_HERMES_SETTINGS=/你的/hermes.json`。

憑證存在那個檔（權限 `0600`）。`GET /api/hermes` 不回傳憑證。密碼欄留白代表沿用已存的憑證。

## 欄位

**Hermes endpoint** 是 Hire 要打的完整網址。程式不會自己補 host，也不會預設 localhost 或 Tailscale。Nous Research Hermes 的 dashboard 建立 profile 的路由是：

```text
https://<你的 Hermes>/api/profiles
```

把 `<你的 Hermes>` 換成你自己的位址。欄位空白就維持 Mock mode。

**Bot** 對應 dashboard 的 `ProfileCreate`：

| 畫面上的欄位 | POST 的欄位 |
| --- | --- |
| 從哪個 profile 複製 | `clone_from` |
| provider | `provider` |
| model | `model` |

`name` 用 Candidate id（例如 `pm-lin`）。`description` 是 Role、顯示名稱，以及範本上的職責。

**Group Chat 名稱** 與 **Group Chat id**（存成 Hermes 的 `roomId`）會寫進 IaC store 的 Bot profile（`hermesGroup`）。目前沒有第二支已核對過的 HTTP，所以不會另外打一通 group API。

**憑證** 會以 `Authorization: Bearer …` 與 `X-Hermes-Session-Token` 送出。Dashboard 依閘門吃其中一種。這支 adapter 不打 API server 的 `/v1/chat/completions`。

## Hire 怎麼分支

```text
沒有 endpoint
  Mock Hire（跟以前一樣）
有 endpoint，連不上
  Mock Hire，Group Chat 寫明「Hermes 連不上」
有 endpoint，有 HTTP 回應，POST 成功
  Hermes 建立 Bot，然後寫 IaC、Office 出現 Role、加入 Group Chat
有 endpoint，有 HTTP 回應，POST 失敗
  這次不 Hire
```

連線檢查是對你填的那個網址發 GET。任何 HTTP 狀態（含 401、405）都算連得上；連線失敗才算 Mock。OpenCode 不啟動，GitHub 不寫入。

## 這支 HTTP 是假設，已對過公開來源

2026-11 對過 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)：

- Dashboard 的 `POST /api/profiles` 是 `profiles.create` 的 HTTP 版。Body 是 `hermes_cli/web_models.py` 的 `ProfileCreate`。實作在 `hermes_cli/web_routers/profiles.py`。
- [bot-forge](https://hermes-agent.nousresearch.com/docs/plugins/bot-forge) 的 `create_agent` 是 agent 裡的工具，不是這支 demo 打的 HTTP。
- Group room 由 `hermes group` 與 gateway 的 `groups.*` 管理。沒有核對到穩定的「把 Bot 加進 room」REST，所以 group 設定只進 Bot profile。
- Dashboard 的存活檢查是 `GET /api/health`。這裡改打你存下來的網址，這樣 endpoint 不一定要是那條 health 路徑。
