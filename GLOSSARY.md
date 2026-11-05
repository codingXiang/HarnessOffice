# HarnessOffice

用來組一支軟體團隊的遊戲感 AI 辦公室：角色在 Office 裡現身，工作的真實來源是 Issue 與 PR。

## Language

### Product

**HarnessOffice**:
組裝軟體團隊的產品。它是遊戲感的 AI 辦公室介面，加上把角色編成一隊的編排。
_Avoid_: dashboard, agent framework, 控制台

**Office**:
角色現身並顯示狀態的像素工作場所。
_Avoid_: board, map, dashboard, OpenChamber

**Mock mode**:
不真的使用 Hermes 或 OpenCode、也不真的寫入 GitHub 的展示方式。
_Avoid_: dry-run, fixture, stub

### Roles

**Role**:
Office 裡的一個位子。HR 開場就在；其餘角色經 Hire 才出現。
_Avoid_: bot, agent, user

**HR**:
開場時唯一固定在場的 Role。人在 Shared chat 以 @ 請它提出 Candidate；沒有人的確認就沒有 Hire。
_Avoid_: recruiter, Hermes

**PM**:
受雇的 Role。把需求收成一份帶驗收條件的 Issue。人核准該 Issue 之前，不算可以開始寫程式。
_Avoid_: PO, product owner, spec bot

**Tech Lead**:
受雇的 Role。面對已核准的 Issue，負責把工作拆開並分派給 Engineer（FE、BE 等）。
_Avoid_: architect, engineering manager

**Engineer**:
受雇的專職 Role，分成 FE 與 BE。
_Avoid_: developer bot, coder

**FE**:
負責畫面的 Engineer。
_Avoid_: frontend, UI dev

**BE**:
負責服務與資料的 Engineer。
_Avoid_: backend, API dev

**QA**:
受雇的專職 Role，負責品質。
_Avoid_: tester, QC

### Hiring

**Candidate**:
為某個 Role 產生、供人挑選的一組選項，由模型產出。沒有可用的模型時，改由 Mock mode 提供假選項。
_Avoid_: resume, prompt, persona

**Hire**:
人在 HR 提出的 Candidate 中作出的選擇。選擇成立時，該人出現在 Office，且有一份 Bot profile 寫入 IaC store。
_Avoid_: onboard, deploy, recruit

**Bot profile**:
面向 Hermes 的 Role 設定。它住在 IaC store，不在 HarnessOffice 這個 repo。
_Avoid_: persona, system prompt, skill file

### Collaboration

**Shared chat**:
全辦公室共用的單一對話視窗。用 @Role 對某人說話。之後可以拆成多個視窗。
_Avoid_: channel, thread, DM, Slack

### Work records

**Issue**:
MVP 時工作的真實來源，住在 GitHub（之後可以改到 GitLab）。它帶驗收條件；人核准之前，它不是可開工的工作。
_Avoid_: ticket, card, spec

**PR**:
MVP 時程式變更的真實來源，住在 GitHub（之後可以改到 GitLab）。
_Avoid_: MR, patch, diff

### Runtimes and stores

**Hermes**:
Role 與協作的 runtime。Bot profile 面向它。它不寫程式。
_Avoid_: OpenCode, the Role itself

**OpenCode**:
寫程式的 runtime。展示時只模擬從寫程式到 PR 的動畫，不真的送出。
_Avoid_: Hermes, IDE

**OpenChamber**:
建在 OpenCode 上、用來觀看與交付程式工作的工作場所。展示同樣只模擬那條動畫。
_Avoid_: Office, Shared chat

**IaC store**:
Bot profile 的家，在 HarnessOffice repo 之外。MVP 是操作者機器上的 `~/harness-office-iac/bots/`；之後可以變成自己的 git repo。
_Avoid_: in-repo config, app database
