---
status: accepted
---

# Bot profiles live in the IaC store

A Bot profile is Hermes config for one hired Role, not product source. It lives in the IaC store — for the MVP, `~/harness-office-iac/bots/` on the operator VM — and not in the HarnessOffice repo. That store may later become its own git repo.

Committing profiles here would mix one operator's hired team with the app everyone runs. Leaving them only inside Hermes, with no path this product may write, would make a Hire unable to place a profile. The directory is operator state: Hire writes it, and this repo does not version it.

## Considered options

- Commit Bot profiles under the HarnessOffice repo.
- Keep them only in Hermes's private config, with no path HarnessOffice is allowed to write.
