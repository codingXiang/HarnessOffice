# Docs

領域語言與架構決策。Domain language and architecture decisions for HarnessOffice.

Grill 已定案的詞彙與決策在 [`GLOSSARY.md`](../GLOSSARY.md) 與 [`docs/adr/`](adr/)。

- [`GLOSSARY.md`](../GLOSSARY.md)（repo 根目錄）是共用詞彙。
- [`docs/adr/`](adr/) 放 Architecture Decision Records。目前有：Bot profile 住在 repo 外的 IaC store，Hermes 與 OpenCode 分層、不合併，以及 Hermes 連線設定由 UI 提供、不寫死。怎麼填 endpoint，見 [`docs/hermes-settings.md`](hermes-settings.md)。
- Agent 怎麼讀這些文件、issue tracker 與 triage 標籤，見 [`docs/agents/`](agents/)。
