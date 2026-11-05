---
status: accepted
---

# Hermes and OpenCode stay separate layers

Every Role in the Office is a Hermes Bot. One Project is one Hermes Group Chat — the product's Shared chat — and every Role in that Office participates. Coding and shipping stay on OpenCode, with OpenChamber as the workspace around that runtime. The two layers are not merged into one agent.

Hire stays on Hermes: HR generates Candidates, the human selects, and Hermes creates the new Bot through its bot-forge/API. The Bot profile still lands in the IaC store. OpenCode is not involved in Candidates or Hire. It enters only when there is a coding need, after the PM's Issue is approved and the Tech Lead has assigned the work.

One agent would look simpler and would force chat, Hire, and pull requests through a single process. Separate layers let a Role exist without a coding session, and let Mock mode animate coding through to a PR without starting OpenCode.

## Considered options

- One runtime that both speaks for every Role and writes the code.
- OpenCode as the only runtime, with Roles as sessions inside it.
- Letting OpenCode generate Candidates or create Bots.
