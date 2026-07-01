# ForgeChat

A WhatsApp-style messenger on the **RTCForge** stack — DMs, groups, broadcast
lists, replies, reactions, edit/delete, multimedia (P2P-first), presence, and
audio/video calls with screen share. **No database** — the backend persists to
JSON files.

Monorepo: a Node backend and a React frontend in one repo.

```
backend/    Node + Express + rtcforge-signaling  (HTTP API + inbox WebSocket)
frontend/   Vite + React 18 + TypeScript + Chakra UI v3  (SPA)
```

## Stack

**Backend** — `rtcforge-signaling` (per-user inbox rooms + fanout, call/p2p
rooms, ICE via `iceServersHook`), `rtcforge-sdk`, `rtcforge-core`, Express,
file-based stores.

**Frontend** — React 18, **Chakra UI v3** (design tokens + semantic tokens),
TanStack Query, Axios, Framer Motion, lucide-react, Vite + TypeScript.
`rtcforge-sdk` (inbox client) + `rtcforge-media` `Call` (mesh A/V + data-channel
file transfer) run in the browser.

## Frontend architecture

Feature-oriented clean architecture + atomic UI, mirroring the reference project:

```
frontend/src/app/
  api/            axios client, endpoints, errors, types
  contexts/       chakra, query, toast, auth, realtime, chat, call providers
  styles/themes/  Chakra v3 theme (tokens + semantic tokens)
  shared/         domain types, utils, emoji
  features/
    auth/         { domain, infrastructure }
    contacts/     { application (known-people), infrastructure }
    conversations/{ infrastructure }
    messages/     { infrastructure }
    calls/        { infrastructure }
    transfer/     { infrastructure (P2P data-channel engine) }
    realtime/     { infrastructure (inbox client, webrtc ICE) }
  ui/
    atoms/        Avatar, IconChip, Modal
    molecules/    MessageBubble, ChatListItem, ComposerBar, MediaView,
                  ReactionBar, MessageMenu, VideoTile
    organisms/    Sidebar, ConversationPane, CallOverlay, modals
  page/           AuthPage, ChatPage
```

State: `RealtimeProvider` owns the single inbox WebSocket and fans events to
subscribers; `ChatProvider` (useReducer store) and `CallProvider` consume them.

## Run

```bash
# one-time: install both packages
pnpm -C backend install     # (or npm) — backend deps
pnpm -C frontend install

# dev — backend on :3001, Vite on :5173 (proxies /api + /media to backend)
pnpm dev
# open http://localhost:5173

# production — build the SPA, backend serves it on :3001
pnpm build
pnpm start
# open http://localhost:3001
```

Two browsers (or one + incognito), register two users, add each other, chat.
Try a group, a broadcast list, replies/reactions/edit/delete, send a photo or
voice note, and place an audio/video call with screen share.

## Test

```bash
pnpm test        # backend end-to-end (accounts, DM/group/broadcast, edit/delete/
                 # react/reply, media, inbox fanout, presence)
```

## Lint & format

[Biome](https://biomejs.dev) handles linting, formatting, and import sorting for
**both** packages from a single root `biome.json` — no ESLint or Prettier. House
style: 4-space indent, single quotes, semicolons as-needed, trailing commas,
`lineWidth` 100, organized imports, and Biome's recommended lint rules.

```bash
pnpm check       # lint + format check across backend + frontend (CI-safe, no writes)
pnpm check:fix   # apply formatting + safe fixes (add --unsafe for the rest)
pnpm lint        # lint only
pnpm format      # format only (writes)
```

Each package exposes the same scripts scoped to itself — e.g.
`pnpm -C backend check`, `pnpm -C frontend format`. All resolve the same root
config, so style is identical across the monorepo.

## How it works (recap)

- **Inbox + fanout** — each user holds one signaling connection to
  `inbox:<userId>`; the server persists every message and pushes it to each
  member's inbox. Commands go over HTTP; realtime events over the inbox socket.
- **Calls** — `rtcforge-media` `Call` mesh over an ephemeral `call:<id>` room
  joined with a short-lived call token; ICE (STUN/TURN) delivered by the
  signaling `iceServersHook`; `room.bindCall` manages lifecycle; screen share via
  `getDisplayMedia` + `addScreenTrack`.
- **Media** — P2P-first: in a DM with an online peer the bytes stream over a
  `rtcforge-media` data channel (no server); otherwise HTTP media store, which
  persists and reaches offline users.

## Configuration

Backend env (see `backend/.env.example`): `TOKEN_SECRET` (**required in prod**),
`PORT`, `STUN_URLS`, `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`, `DATA_DIR`.
Frontend dev env (`frontend/.env.development`): `VITE_WS_URL` (signaling socket).
