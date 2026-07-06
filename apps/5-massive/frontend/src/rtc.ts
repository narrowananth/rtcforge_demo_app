import { connectRoom, type RoomConnection } from '@rtc-shared/client'

export function wsUrl(): string {
    return import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3005`
}

/** Join a stream room. The cluster routes the peer to a node transparently. */
export function joinStreamRoom(token: string, streamId: string): Promise<RoomConnection> {
    return connectRoom({ serverUrl: wsUrl(), token, roomId: `stream:${streamId}` })
}
