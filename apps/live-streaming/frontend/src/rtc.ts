import { createClient, type Room, type RTCForgeClient } from 'rtcforge/client'

/** Direct WS URL to the signaling backend (not proxied — avoids Vite HMR clash). */
export function wsUrl(): string {
    return import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3002`
}

export interface StreamConnection {
    client: RTCForgeClient
    room: Room
}

/**
 * Connect to the signaling backend and join a stream room. The token already
 * binds the identity + role + room server-side; the room id must match
 * (`stream:<id>`). rtcforge owns the transport/auth/relay — this is just the join.
 */
export async function joinStreamRoom(token: string, streamId: string): Promise<StreamConnection> {
    const client = createClient({ serverUrl: wsUrl(), token })
    const room = await client.joinRoom(`stream:${streamId}`)
    return { client, room }
}
