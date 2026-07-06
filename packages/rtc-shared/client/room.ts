import { createClient, type Room, type RTCForgeClient } from 'rtcforge/client'

export interface RoomConnection {
    client: RTCForgeClient
    room: Room
}

/**
 * Connect to a signaling backend and join a room. The token binds identity +
 * role + room server-side; `roomId` must match. This is the whole client-side
 * setup for any app that only needs the room message bus (chat, presence,
 * collaborative cursors/whiteboards/docs) — no media. rtcforge owns transport,
 * auth, and relay.
 */
export async function connectRoom(opts: {
    serverUrl: string
    token: string
    roomId: string
    reconnect?: boolean
}): Promise<RoomConnection> {
    const client = createClient({
        serverUrl: opts.serverUrl,
        token: opts.token,
        reconnect: opts.reconnect ?? true,
    })
    const room = await client.joinRoom(opts.roomId)
    return { client, room }
}
