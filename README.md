# RTCForge apps

Five distinct real-time products, one monorepo, all built on the
[**rtcforge**](https://www.npmjs.com/package/rtcforge) stack — rtcforge owns the
transport (signaling, rooms, relay, P2P + SFU media, gossip cluster); each app
owns only *what the bytes mean*. No hand-rolled signaling / media / transport.

| # | App | What it is | rtcforge surface | Ports |
|---|-----|-----------|------------------|-------|
| 1 | **[chat](apps/chat)** | WhatsApp-style messenger — messages, presence, notifications, audio/video calls, multimedia file sharing, broadcast lists | `server` · `client` · `media` (SFU + P2P) · `filetransfer` | 3001 / 5173 |
| 2 | **live-streaming** | one broadcaster → many viewers | `server` · `client` · `media` (SFU) | 3002 / 5174 |
| 3 | **collaborative** | whiteboard · live cursors · shared docs (no media) | `server` · `client` (broadcast + directed signal) | 3003 / 5175 |
| 4 | **meet** | 1:1 & small-group calls (P2P mesh) + rooms/webinars (SFU) + host controls | `server` · `client` · `media` (mesh **and** SFU) | 3004 / 5176 |
| 5 | **massive** | one stream → thousands of viewers across a multi-node SFU cluster with cascade fan-out + ops dashboard | `server` · `client` · `media` · `sfu` · `sfu/udp` · `core` | 3005 / 5177 |

rtcforge's model is **additive**: the room/client code is identical from app 1 →
app 5; only the media plane changes (none → P2P mesh → single-node SFU →
multi-node cascade cluster). That progression is exactly what the apps
demonstrate, and what `packages/rtc-shared` encodes once.

## Layout

```
apps/
  chat/            backend/  frontend/     # the original forgechat, moved here
  live-streaming/  backend/  frontend/
  collaborative/   backend/  frontend/
  meet/            backend/  frontend/
  massive/         backend/  frontend/
packages/
  rtc-shared/
    client/   SfuClient · MeshCall · connectRoom · iceForRoom   (Vite frontends, aliased TS source)
    server/   createSignaling · SfuService · createSfuSignaling · createTokens ·
              SfuMesh · SfuTopology · createCluster · createLogger · Metrics · core
```

Every app is its own rtcforge `SignalingServer` on its own port. `rtc-shared`
holds the wiring they all reuse — thin, parameterized layers over rtcforge, so
no app re-implements core logic. The frontend half is consumed as aliased TS
source (`@rtc-shared/client`, no build step); the backend half as a workspace
package (`@forgechat/rtc-shared/server`).

## Run

pnpm workspace. mediasoup builds a native SFU worker on install (allowed via
`onlyBuiltDependencies` in `pnpm-workspace.yaml`).

```bash
pnpm install            # installs all apps + packages, builds the mediasoup worker

pnpm dev:1              # app 1 (chat)        — backend :3001, Vite :5173
pnpm dev:2              # app 2 (live)        — :3002 / :5174
pnpm dev:3              # app 3 (collab)      — :3003 / :5175
pnpm dev:4              # app 4 (meet)        — :3004 / :5176
pnpm dev:5              # app 5 (massive)     — :3005 / :5177

pnpm build:<n>          # build one app's frontend    (pnpm -r build for all)
pnpm start:<n>          # run one app's backend (serves its built frontend)
```

Open two browser tabs (or one + incognito) per app: chat between two users;
broadcast a stream and watch it in another tab; draw on a board from two tabs;
place a mesh call / join an SFU room; open several viewer tabs on app 5 and watch
the cluster dashboard fill nodes and grow cascade edges.

## Test

```bash
pnpm test               # every app's backend test suite (test:1 … test:5)
pnpm test:5             # one app
```

Each backend test drives rtcforge with real fake-signaling peers and, for the
media apps, boots the **real mediasoup SFU** — verifying the control plane
(caps → transport → produce/consume), role/publish policies, host controls, and
(app 5) multi-node placement + a real cross-node cascade pipe edge.

The actual RTP byte path (DTLS/ICE, live video) needs a browser with a
camera/mic and is verified by running the app (see **Run**).

## Lint & format

[Biome](https://biomejs.dev) — one root `biome.json` for the whole workspace.

```bash
pnpm check              # lint + format check (CI-safe, no writes)
pnpm check:fix          # apply formatting + safe fixes
```

## Per-app docs

App 1 (chat) has the deepest domain and its own detailed README:
**[apps/chat/README.md](apps/chat/README.md)**. Apps 2–5 are documented by
the header comment in each `backend/src/server.js` (the wiring) and each app's
`frontend/src` components.
