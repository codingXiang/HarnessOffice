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
Office 裡的一個位子，而且就是一個 Hermes Bot。HR 開場就在；其餘經 Hire 才出現。
_Avoid_: OpenCode session, user, 純像素、背後沒有 Hermes Bot 的角色

**HR**:
開場時唯一固定在場的 Hermes Bot。人在 Group Chat 以 @ 請它提出 Candidate；沒有人的確認就沒有 Hire。
_Avoid_: recruiter, OpenCode

**PM**:
受雇的 Hermes Bot。把需求收成一份帶驗收條件的 Issue。人核准該 Issue 之前，不算可以開始寫程式。
_Avoid_: PO, product owner, OpenCode

**Tech Lead**:
受雇的 Hermes Bot。面對已核准的 Issue，負責把工作拆開並分派給 Engineer（FE、BE 等）。
_Avoid_: architect, engineering manager, OpenCode

**Engineer**:
受雇的專職 Hermes Bot，分成 FE 與 BE。
_Avoid_: OpenCode, coder runtime

**FE**:
負責畫面的 Engineer。
_Avoid_: frontend, UI dev

**BE**:
負責服務與資料的 Engineer。
_Avoid_: backend, API dev

**QA**:
受雇的專職 Hermes Bot，負責品質。
_Avoid_: tester, QC, OpenCode

### Hiring

**Candidate**:
HR 這個 Hermes Bot 為某個 Role 產生、供人挑選的一組選項。沒有可用的模型時，改由 Mock mode 提供假選項。OpenCode 不產生 Candidate。
_Avoid_: resume, prompt, persona, OpenCode session

**Hire**:
人在 HR 提出的 Candidate 中作出的選擇。選擇成立時，由 Hermes 建立新的 Hermes Bot：該人出現在 Office，且有一份 Bot profile 寫入 IaC store。OpenCode 不參與。
_Avoid_: onboard, deploy, OpenCode

**Bot profile**:
一個 Hermes Bot 的 Role 設定，在 Hire 時由 Hermes 建立。它住在 IaC store，不在 HarnessOffice 這個 repo。
_Avoid_: persona, system prompt, OpenCode config

### Collaboration

**Project**:
一件要組團隊來做的工作。一個 Project 對應一個 Group Chat，有自己的在場 Bot、對話、指派、草稿和 PR。Bot 不跨 Project 共用。一個 Project 可以綁一個或多個 GitHub repo。
_Avoid_: repo, workspace, Office

**Group Chat**:
一個 Project 的 Hermes 群組對話。Office 裡的每個 Role 都在其中。用 @Role 對某人說話。產品裡把這個對話叫 Shared chat。
_Avoid_: channel, thread, DM, Slack, 每人一間的私聊

**Shared chat**:
Group Chat 在產品裡的名字：一個 Project 的那一個 Hermes 群組對話。
_Avoid_: 另一種聊天室, OpenCode session

### Work records

**Issue**:
MVP 時工作的真實來源，住在 GitHub（之後可以改到 GitLab）。它帶驗收條件；人核准之前，它不是可開工的工作。
_Avoid_: ticket, card, spec

**PR**:
MVP 時程式變更的真實來源，住在 GitHub（之後可以改到 GitLab）。
_Avoid_: MR, patch, diff

### Runtimes and stores

**Hermes**:
每一個 Role 的 runtime。它持有 Project 的 Group Chat，並在 Hire 時建立新的 Hermes Bot。它不寫程式。
_Avoid_: OpenCode

**OpenCode**:
寫程式的 runtime。只有在出現寫程式需求時才進入，而且是在 PM 起草的 Issue 經人核准、Tech Lead 分派之後。它不產生 Candidate，也不建立 Bot。展示時只模擬從寫程式到 PR 的動畫，不真的送出。
_Avoid_: Hermes, Hire, IDE

**OpenChamber**:
建在 OpenCode 上、用來觀看與交付程式工作的工作場所。展示同樣只模擬那條動畫。
_Avoid_: Office, Shared chat

**IaC store**:
Bot profile 的家，在 HarnessOffice repo 之外。MVP 是操作者機器上的 `~/harness-office-iac/bots/`；之後可以變成自己的 git repo。
_Avoid_: in-repo config, app database
