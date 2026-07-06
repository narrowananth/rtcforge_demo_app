---
name: verify
description: End-to-end verification of ForgeChat's real-time features (broadcast, calls, P2P file transfer) against the running app + real mediasoup SFU. Use when asked to verify calls/broadcast/file-transfer work, confirm the media plane after a change, or smoke-test the RTCForge integration. Boots the app and drives it — a Node signaling driver plus real-browser drives with fake media devices.
---

# verify — drive the real app end-to-end

Two layers, both against the **real** server (real mediasoup workers):

1. **Node signaling driver** (`verify-live.cjs`) — boots its own server, drives a
   broadcaster + two viewers over `rtcforge/client` (Node). Covers the backend
   fixes that don't need a browser: SFU control-plane RPC, broadcast lifecycle
   (viewer-leave keeps the stream; broadcaster-leave ends it and notifies over
   both the SFU signal channel and the inbox), and `/healthz` metrics.

2. **Browser drives** (`browser/drive-*.mjs`) — headless Chromium with fake media
   devices, two contexts, session injected via `localStorage` (no login UI). Proves
   **real media bytes** flow and the UI behaves:
   - `drive-broadcast.mjs` — broadcaster publishes, viewer decodes live frames,
     broadcaster hangs up → viewer sees "the broadcaster ended the live stream".
   - `drive-call.mjs` — 2-party video call, bidirectional produce↔consume, teardown.
   - `drive-filetransfer.mjs` — 80 KiB file over the data channel via
     `FileTransferManager`, SHA-256 verified, blob rendered on the receiver.

## Run everything

```bash
bash .claude/skills/verify/run.sh
```

`run.sh` builds the frontend if `frontend/dist` is missing, runs the Node driver
(self-contained), then boots the built app on `:3001` and runs the three browser
drives. Screenshots land in `.claude/skills/verify/browser/shots/`. Exit code is
non-zero if any drive fails.

## Run one layer

```bash
# Node signaling driver only (self-contained, boots + tears down its own server):
node .claude/skills/verify/verify-live.cjs

# Browser drives only — needs the app already serving on $BASE (default :3001):
cd .claude/skills/verify/browser && npm i && npx playwright install chromium
BASE=http://localhost:3001 node drive-broadcast.mjs   # or drive-call / drive-filetransfer
```

## What made it work (don't drop these)

- **Fake media**: Chromium args `--use-fake-device-for-media-stream`,
  `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`,
  and context `permissions: ['camera','microphone']`. Without these, getUserMedia
  blocks and remote `<video>` never plays.
- **Skip the login UI**: the app restores a session from `localStorage.fc_token` +
  `fc_me` (validated against `/me`). `addInitScript` seeds both before app JS runs.
- **Real-media assertion**: `video.readyState >= 2 && video.videoWidth > 0` — an
  attached srcObject isn't enough; this confirms frames actually decoded (i.e.
  produce→consume→resume worked).
- **Selectors are stable aria-labels**: "Go live (broadcast)", "Video call",
  "Accept", "Hang up"; the composer file input is the only `input[type="file"]`.
- **SFU listen IP**: `SFU_LISTEN_IP=127.0.0.1` so mediasoup transports bind loopback
  for local runs.

If this skill fails on mechanics unrelated to your change (e.g. a moved selector),
refresh it via `/run-skill-generator`.
