---
status: accepted
---

# Hermes settings come from the UI

Hermes is not connected. Mock mode still speaks for every Role. When Hermes is connected, the person chooses it in the UI: the endpoint, and the bot or group settings. Those values are not hard-coded in the client, the mock server, or the 3D spike.

A Tailscale address or a local port will change between machines. A setting the person can edit survives that. A constant in the repo does not.

The 3D spike only repeats Mock Group Chat lines. It does not open a Hermes socket, and it does not invent an endpoint.
