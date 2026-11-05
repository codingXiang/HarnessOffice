# agent-office visual client

Upstream: https://github.com/AgentSystemLabs/agent-office

Pinned at tag **v0.1.211**, commit `852e2ab28c4f3f31bffdf4b20353bd119c9d3270`.

License: MIT. See [LICENSE](LICENSE). Copyright (c) 2026 AgentSystemLabs.

This directory vendors only the Vite + three.js client and the shared protocol and layout modules it imports (`src/client`, `src/shared`), plus the upstream Vite and TypeScript config needed to build that client. `vite.config.ts` is unchanged from the tag, including its `/api` and `/ws` proxy to port 4600.

It does not include `src/server`. HarnessOffice does not run agent-office's workers, PTY host, or GitHub floors.

The client is the v0.1.211 sources plus two spike patches: a `spectator` camera (fixed overhead of desk 1 and desk 2), and a welcome arrival that stands a peer the server already placed on the floor instead of pulling them back into the elevator. Neither is in the upstream tag.

HarnessOffice itself stays GPL-3.0. These vendored files stay MIT. Do not strip the MIT notice.
