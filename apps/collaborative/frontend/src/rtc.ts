import { connectRoom, type RoomConnection } from '@rtc-shared/client'

export function wsUrl(): string {
    return import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3003`
}

/** Connect + join a board room. The token binds identity/board server-side. */
export function joinBoardRoom(token: string, boardId: string): Promise<RoomConnection> {
    return connectRoom({ serverUrl: wsUrl(), token, roomId: `board:${boardId}` })
}
