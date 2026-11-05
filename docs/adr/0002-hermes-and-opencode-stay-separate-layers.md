---
status: accepted
---

# Hermes and OpenCode stay separate layers

Roles and collaboration run on Hermes. Coding and shipping run on OpenCode, with OpenChamber as the workspace around that runtime. The two layers are not merged into one agent.

One agent would look simpler and would force chat, Hire, and pull requests through a single process. Separate layers let a Role exist without a coding session, and let Mock mode animate coding through to a PR without starting OpenCode. A Bot profile stays Hermes-oriented; it is not OpenCode config.

## Considered options

- One runtime that both speaks for every Role and writes the code.
- OpenCode as the only runtime, with Roles as sessions inside it.
