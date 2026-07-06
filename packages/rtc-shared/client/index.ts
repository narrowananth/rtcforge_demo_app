/**
 * @forgechat/rtc-shared/client — browser-side rtcforge helpers shared by every
 * app's frontend. Consumed as aliased TypeScript source (Vite `resolve.alias` +
 * tsconfig `paths`), so no build step. Everything here is a thin ergonomics
 * layer over rtcforge/client + rtcforge/media — no hand-rolled transport/media.
 */

export { iceForRoom } from './ice'
export { SfuClient } from './sfu-client'
