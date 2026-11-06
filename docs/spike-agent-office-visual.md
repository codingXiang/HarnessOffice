# Spike: agent-office as a visual layer

This is a spike. It may not merge. PixelOffice (`npm start`, port 4173) is unchanged and still the Mock mode demo. This page is a second, thinner view: the Vite + three.js client from [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) at tag **v0.1.211** (commit `852e2ab28c4f3f31bffdf4b20353bd119c9d3270`, MIT), pointed at a mock WebSocket that only knows HR and PM.

HarnessOffice stays GPL-3.0. The vendored client stays MIT. See [`vendor/agent-office/NOTICE.md`](../vendor/agent-office/NOTICE.md) and [`vendor/agent-office/LICENSE`](../vendor/agent-office/LICENSE).

## What is vendored

`vendor/agent-office/` has `src/client`, `src/shared`, and the upstream `vite.config.ts` (unchanged, including its proxy of `/api` and `/ws` to port 4600). `src/server` is not included. Nothing here starts Claude, Codex, OpenCode, a PTY, or a GitHub floor.

## Run

From the repo root. The spike HTTP server binds `0.0.0.0` unless `HOST` is set, so Tailscale can reach it. Default port is **4600** (`PORT` overrides).

```bash
npm install
npm run spike:office:client   # installs and vite-builds the vendored client
npm run spike:office          # http://0.0.0.0:4600  and  /ws
```

Restart the server after a client rebuild. The page is read from `vendor/agent-office/dist` on each request, but the welcome spawn lives in the Node process. Tailscale reaches this host on port 4600 (`HOST` defaults to `0.0.0.0`).

Open that URL. The camera is a fixed overhead spectator aimed at the north-west pod: **desk 1 (HR)** and **desk 2 (PM)**. WASD does not move that camera. The first visit still asks you to pick a character (the upstream client stores it in `localStorage` under `agent-office.profile`); that choice does not change the camera.

You are standing on the floor just south of that pod, not in the elevator shaft. `welcome.floor` is `harness`, so the shut-door path (`!store.floor`) does not run. A fresh welcome with that spot takes the client's `arrive('back')` path: doors open, you are already out of the car. Upstream only did that when this browser had a saved spot, and `placeInCar` pulled everyone else back into the shaft — including a peer the server had already stood outside it.

| How | What you get |
| --- | --- |
| Open `/` with no saved view | Spectator. A saved view from ⚙️ Settings is kept. |
| `?view=spectator` | Spectator for this load, even if a walk was saved. |
| `?view=first` | First-person WASD. `?view=third` follows your character. |
| **U** | Toggles spectator and first person, and saves the choice. |
| ⚙️ Settings → You | Spectator, first person, or third person. |

To walk: press **U** (or open `?view=first`), click the canvas, then WASD. W is toward where you are facing. The spawn faces the HR/PM pod.

If a reconnect puts you back in the car: wait for the ding, the doors slide open, then walk out toward **+Z** (south, into the room). E at the elevator opens the floor list; it does not hire anyone. Press E on an empty desk does not start an agent; a toast points at the mock API.

In another terminal, with the server still running:

```bash
npm run spike:office:demo
```

That script POSTs `/api/spike/roles` in this order:

| Step | Role | Phase | What the client is sent |
| --- | --- | --- | --- |
| 1 | HR | `appear` | `worker.update` status `idle` at `desk-1` |
| 2 | PM | `appear` | `worker.update` status `idle` at `desk-2` |
| 3 | HR | `waiting` | status `needs_input` (the waiting pose) |
| 4 | PM | `coding` | status `working`, action `edit` (typing) |
| 5 | PM | `pr` | status `done`, `worker.pr` number 102, `gh.pulls` with that PR `MERGED`, then `gong` `why: "merged"` so the awake workers dance |

`SPIKE_URL` (default `http://127.0.0.1:4600`) and `SPIKE_DELAY` (default `1200` ms) change the script. Only `HR` and `PM` are accepted, and only those four phases.

Each phase also puts that role's Mock Group Chat line on the card over their head (the vendored worker task card) and into the 3D chat. The sentences are the same ones PixelOffice speaks in `demo/office.mjs`: HR's opening line, the Role prompt, the Issue draft, the mock coding line, and the unsent Mock PR.

Say any line yourself:

```bash
curl -s -X POST http://127.0.0.1:4600/api/spike/say \
  -H 'content-type: application/json' \
  -d '{"role":"PM","text":"請核准，或先不要。"}'
```

`HR`, `PM`, `Tech Lead`, `FE`, `BE`, and `QA` get a desk and a card. Any other `role` is chat-only. The chat server on port 4173 is the authority: it pushes the Group Chat snapshot to `POST /api/spike/session`, and this page pulls `GET /api/session/visual` from `HARNESS_CHAT_URL` when a browser connects. The same message id is not spoken twice. Hermes is not called from this process. The endpoint and bot or group settings stay on the chat page. See [`docs/adr/0003-hermes-settings-come-from-the-ui.md`](adr/0003-hermes-settings-come-from-the-ui.md) and [`docs/hermes-settings.md`](hermes-settings.md).

Same call by hand:

```bash
curl -s -X POST http://127.0.0.1:4600/api/spike/roles \
  -H 'content-type: application/json' \
  -d '{"role":"HR","phase":"appear"}'
```

`GET /api/whoami` is always `200` with `{ "ok": true, "me": { "admin": false } }`, so the client does not redirect to `/login`. `GET /api/login` reports a shared office with no accounts, and `POST /api/login` succeeds, in case that page is opened anyway. There is no session cookie and no real password.

Optional hot reload, while `npm run spike:office` is already on 4600:

```bash
npm --prefix vendor/agent-office run dev
```

Vite listens on `0.0.0.0:5173` and proxies `/api` and `/ws` to `127.0.0.1:4600`. Use 5173 in the browser for that mode. The built server on 4600 is the one Tailscale should use.

`npm test` includes `spike/agent-office/server.test.mjs`. It does not need the client build.

## Protocol the mock actually speaks

Checked against v0.1.211 `src/shared/protocol/` and `src/client/state/`. Every WebSocket frame is one JSON object with a `t` field.

On connect the server sends one `welcome`, then the client is a renderer. Later frames used here:

- `worker.update` `{ worker }` replaces that worker in the store. The pose comes from `status` and `action`.
- `worker.remove` is in the client and unused by this spike.
- `gh.pulls` `{ state: { items, fetchedAt, loading } }` replaces the pull board. A worker's own PR counts as merged only when `worker.pr.number` matches an item whose `state` is `"MERGED"` (`src/shared/status.ts` `workerPr`). `"done"` alone celebrates (a spin) when the previous status was `working` or `needs_input`. The desk dance is a separate `gong` message: `{ t: "gong", why: "merged", pr }`.
- `pong` answers `ping`. The client sends five pings after welcome so the jukebox clock can line up.
- `floor.enter` answers `floor.go`. This spike has one floor (`harness`). Any other id gets the same floor back plus a toast.
- `peer.join` / `peer.move` / `peer.leave` for the people walking around. Moves are not echoed to the sender.

`GET /api/spike/state` returns the current workers and pulls.

## Welcome fields that are mandatory

The client applies `welcome` in `src/client/state/store.ts`: slices with `beforeFloor` run first (the map), then every slice `enter()` takes the floor view, then the other welcome handlers. A missing field throws in `enter` or on the first render that reads it. These were required for the page to get past welcome at v0.1.211. Optional ones the code already defaults are listed after.

Required on the welcome object itself:

- `you` (string id) and `peers` (array of `PeerInfo`, including yourself, each with `look`, a position, and `floor`)
- `floors` (array) and `projectsDir` (`{ dir, custom }`)
- `ice` (array; empty is fine), `chat` (array), `invites` (boolean)
- `version` (string; a later welcome with a different version shows the upgrade banner)
- `upgrade` with `phase` (`arrival.ts` reads `msg.upgrade.phase`)
- `usage.total` and `usage.today`, each with numeric `input`, `output`, `cacheWrite`, `cacheRead`, `cost`, `calls` (`renderUsage` reads `usage.total.calls`)
- `limits` (`{ windows: [], at: 0 }` is enough)
- `me` (`{ admin: false }` with no `account`, so the Claude sign-in modal stays closed)
- `notify` (object, `{}` is enough)
- `machine` including `history` as an array (`history.map` on the wall monitor). `cpu`, `cores`, `memUsed`, `memTotal`, `workers` are read too.
- `theme` with `active` (`null` or a holiday). Worker views read `store.theme.active` while seating.
- `sky` can be `null`. A full `SkyState` is what we send so the windows follow it.

Required on the floor view carried inside `welcome` (no `??` fallback in `enter`):

- `floor` (string; `null` means a building with no floors and the elevator doors stay shut)
- `project` (object or `null`)
- `workers` (array of `WorkerInfo`)
- `issues` and `pulls`: `{ items, fetchedAt, loading }`
- `queue`: `{ tasks, maxWorkers }`
- `decor` (array)
- `services`: `{ items, port }` — `items` is passed straight to the services board
- `jukebox`: `{ on, track, startedAt, elapsed }` — `enter` spreads it
- `cabinet`: `{ player, scores, frame }` — `enter` reads all three
- `whiteboard`: `{ elements, people }` — `enter` maps `elements`
- `meeting`: `{ current, past }`
- `dog`: a `DogState` or `null`. `null` still dismisses the loading screen (`firstReady` resolves when the first sync has no dog). We send a sitting corgi so the model loads.

The client already defaults these if they are missing: `map` (falls back to the office), `prompts`, `leaveOnMerge`, `plan`, `ball`, `cars` (empty array leaves the built cars where they were parked), `jail`.

`WorkerInfo` fields the pose and the name tag actually read: `id`, `deskId` (must be a real desk, `desk-1` …), `name`, `color`, `status`, `acked`, `kind`, `viewers` (the dog reads `viewers.length`), `action` (omit it unless they are typing, reading, testing, on the web, or failing), and `pr: { number, url }` when the merged-PR badge should show. `cols`, `rows`, `viewerIds`, `createdBy`, `createdAt` are part of the type and are sent so later panels do not trip on them.

## What broke, and what we did not adopt

Read from v0.1.211 `enter()` and the first render, then checked in headless Chrome (SwiftShader) against the built client. With the fields below present, the page stayed on `/`, the tab title became `HarnessOffice · Agent Office`, `store.floor` was `harness`, and there were no uncaught exceptions. After the role API, `workerViews` had HR at `desk-1` and PM at `desk-2`.

These throw or blank the office if they are missing. They are not optional at this tag, even when the protocol comments make them look decorative:

- `upgrade.phase` (`arrival.ts` reads it on every welcome)
- `usage.total.calls` and `usage.today` (the sidebar spend line)
- `machine.history` (the wall monitor calls `history.map`)
- `theme.active` (worker views read it while seating)
- `whiteboard.elements`, `cabinet.player` / `cabinet.scores` / `cabinet.frame`, `jukebox` (`on`, `track`, `startedAt`, `elapsed`), `services.items`, `meeting`, `decor`, `queue`, `issues`, `pulls`, `workers`, `project`, `floor`
- `peers` including yourself, each with `look` and a position. The elevator puts you in the car from that position.

`worker.status = "done"` does not dance by itself. The spin plays only when status changes into `done` from `working` or `needs_input`. The desk dance is a separate `gong` with `why: "merged"`. The merged badge also needs `gh.pulls` state `"MERGED"` for that `worker.pr.number`. Phase `pr` sends all three. Chrome showed the PM card change to "Mock PR merged" and the corner count to "1 done".

Other notes from that run, not protocol crashes:

- `GET /api/whoami` 200 kept the client off `/login`. No client fork was required for auth.
- WebGL came up, so the client did not bounce to `/lite?why=webgl`. A machine without WebGL still will; that redirect is upstream.
- The task card is prefixed `Custom ·` because these workers are `provider: "custom"`. The name tag over the head is still `HR` or `PM`.
- From in front of the desk the body sits behind the laptop. That is the upstream seat, not a missing field.
- The spike camera defaults to a fixed overhead view (`player.view === 'spectator'` in the vendored client). It is not an upstream mode. `U` or `?view=first` is the WASD walk.
- Pressing E to hire, opening a terminal, and riding the elevator to another floor or the roof do not start workers. `floor.go` is answered with this same floor so the doors open again.
- Login, lite, claim, and join HTML ship inside the vendored Vite build. They are not a second product.

## Out of scope

Hermes, replacing PixelOffice, and production polish. The spectator camera and the floor spawn are part of this spike.
