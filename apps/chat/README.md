# App 1 — ForgeChat

A WhatsApp-style messenger on the **rtcforge** stack — DMs, groups, broadcast
lists, replies, reactions, edit/delete, multimedia (P2P-first), presence, and
audio/video calls with screen share. **No database** — the backend persists to
JSON files.

```
apps/chat/
  backend/    Node + Express + rtcforge/server  (HTTP API + inbox WebSocket)
  frontend/   Vite + React 18 + TypeScript + Chakra UI v3  (SPA)
```

> Part of the [RTCForge apps monorepo](../../README.md). Run it with `pnpm dev:1`
> from the repo root (backend :3001, Vite :5173).

## Stack

Every layer the rtcforge stack *can* own, it owns. Domain logic (users,
conversations, messages), JSON persistence, password auth, and REST routing have
no rtcforge equivalent and stay hand-rolled — everything else is rtcforge.

**Backend** — `rtcforge/server` (per-user inbox rooms + fanout, call/broadcast
rooms, cluster sharding via `RoomRouter`); `rtcforge/media` **SFU** (mediasoup:
`MediaService`/`MediaRouter`/`SfuSignalHandler` — real server-side
produce/consume, one → many); `rtcforge/sfu` (`SfuCluster` + `CascadeTree`
broadcast fanout planner); `rtcforge/core` primitives throughout (`Clock`,
`IdGenerator`, `RtcForgeError`, `Logger`, `EventEmitter`, `MessageBus` fanout,
`MemoryLock`, `HashRing`, `Membership`); `rtcforge/sfu/udp` (SWIM gossip
transport for multi-node); Express + file-based stores.

**Frontend** — React 18, **Chakra UI v3**, TanStack Query, Axios, Framer Motion,
lucide-react, Vite + TypeScript. `rtcforge/client` (inbox + call-room client) +
**`mediasoup-client`** (SFU produce/consume) + `rtcforge/media` `PeerConnection`
(data-channel file transfer). The browser SFU client (`SfuClient`) and ICE
helper are shared via [`@rtc-shared/client`](../../packages/rtc-shared).

## Frontend architecture

Feature-oriented clean architecture + atomic UI:

```
frontend/src/app/
  api/            axios client, endpoints, errors, types
  contexts/       chakra, query, toast, auth, realtime, chat, call providers
  styles/themes/  Chakra v3 theme (tokens + semantic tokens)
  shared/         domain types, utils, emoji
  features/
    auth/ contacts/ conversations/ messages/ calls/ transfer/ realtime/
  ui/
    atoms/ molecules/ organisms/
  page/           AuthPage, ChatPage
```

State: `RealtimeProvider` owns the single inbox WebSocket and fans events to
subscribers; `ChatProvider` (useReducer store) and `CallProvider` consume them.

## Test

```bash
pnpm test:1      # from repo root — backend end-to-end:
                 #   smoke (accounts, DM/group/broadcast, edit/delete/react/reply,
                 #     media, inbox fanout, presence)
                 #   sfu   (boots the real mediasoup worker, drives produce/consume,
                 #     checks broadcast publish gating)
                 #   cascade (two SFU nodes, CascadeTree → real pipe edge)
```

The full media byte path (DTLS/ICE, real RTP) needs a browser with a camera/mic
and is verified manually — open two browsers, place a call, go live.

## How it works (recap)

- **Inbox + fanout** — each user holds one signaling connection to
  `inbox:<userId>`; `pushToUser` publishes to a `rtcforge/core` `MessageBus`
  topic and the node hosting that inbox peer delivers it. Commands go over HTTP;
  realtime events over the inbox socket. Rooms consistent-hash to an owning node
  via the signaling `RoomRouter` + a `Membership` (in-memory single-node, SWIM
  gossip when `CLUSTER_UDP_PORT` is set).
- **Calls & broadcasts** — real **SFU** over `rtcforge/media` (mediasoup). A
  caller/broadcaster PRODUCES its tracks once into a per-room `MediaRouter` and
  every other member CONSUMES them (one → many). Calls use a `call:<id>` room
  (everyone publishes); a broadcast list uses a `bcast:<id>` room where only the
  `broadcaster`-role token may publish. The browser drives produce/consume with
  `mediasoup-client` via rtcforge's `SfuSignalHandler` protocol over the
  signaling `signal` channel (reserved peer id `sfu`); screen share is an extra
  video producer. `rtcforge/sfu`'s `CascadeTree` plans multi-node viewer fanout.
- **File transfer** — P2P-first: in a DM with an online peer the bytes stream
  over a `rtcforge/media` data channel (no server); otherwise the HTTP media
  store, which persists and reaches offline users.

## Configuration

Backend env (see `backend/.env.example`): `TOKEN_SECRET` (**required in prod**),
`PORT`, `STUN_URLS`, `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`, `DATA_DIR`.
Frontend dev env (`frontend/.env.development`): `VITE_WS_URL` (signaling socket).
