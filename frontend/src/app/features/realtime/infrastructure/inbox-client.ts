import { RTCForgeClient } from 'rtcforge-sdk'
import type { InboxEvent } from '../../../shared/types'
import { wsBaseUrl } from '../../../shared/utils'

export interface InboxConnection {
    client: RTCForgeClient
    close: () => void
}

/**
 * Connect the user's single realtime inbox (`inbox:<userId>`). The server pushes
 * every message/conversation/presence/call/transfer event on the `inbox`
 * broadcast channel.
 */
export async function connectInbox(
    userId: string,
    token: string,
    onEvent: (event: InboxEvent) => void,
): Promise<InboxConnection> {
    const client = new RTCForgeClient({ serverUrl: wsBaseUrl(), token, reconnect: true })
    const room = await client.joinRoom(`inbox:${userId}`)
    room.on('broadcast', (_from: string, channel: string, data: unknown) => {
        if (channel === 'inbox') onEvent(data as InboxEvent)
    })
    return {
        client,
        close: () => {
            client.leave().catch(() => undefined)
        },
    }
}
