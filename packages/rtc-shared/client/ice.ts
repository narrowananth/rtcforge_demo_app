import type { Room } from 'rtcforge/client'

// Fallback ICE if the signaling server delivers none (it normally does, via its
// iceServersHook → room-joined.iceServers).
const ICE_FALLBACK: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

/** Prefer server-delivered ICE (STUN + per-peer TURN creds); fall back otherwise. */
export function iceForRoom(room: Room): RTCIceServer[] {
    const fromServer = room.iceServers
    if (fromServer?.length) {
        return fromServer.map((s) => ({
            urls: s.urls,
            username: s.username,
            credential: s.credential,
        }))
    }
    return ICE_FALLBACK
}
