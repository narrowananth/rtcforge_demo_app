import { ClientEvent, RTCForgeClient } from 'rtcforge/client'
import type { InboxEvent } from '../../../shared/types'
import { wsBaseUrl } from '../../../shared/utils'

export type InboxStatus = 'connected' | 'reconnecting' | 'terminated'

export interface InboxConnection {
    client: RTCForgeClient
    close: () => void
}

export interface InboxHandlers {
    /** A server→client inbox event arrived. */
    onEvent: (event: InboxEvent) => void
    /** Connection status changed (for a "reconnecting…" banner). */
    onStatus?: (status: InboxStatus, attempt?: number) => void
    /**
     * The socket re-established after a drop. Inbox events are fire-and-forget
     * (the server buffers nothing), so events during the gap were lost — the
     * caller should resync missed state (refetch conversations/messages).
     */
    onReconnect?: () => void
    /**
     * A permanent auth failure (expired/invalid token → 1008) or reconnect
     * exhaustion. The token can't work; clear the session and re-login. The
     * client is torn down before this fires.
     */
    onAuthError?: () => void
}

/**
 * Connect the user's single realtime inbox (`inbox:<userId>`), with automatic
 * reconnection and token refresh. The server pushes every
 * message/conversation/presence/call/transfer event on the `inbox` broadcast
 * channel.
 */
export async function connectInbox(
    userId: string,
    token: string,
    handlers: InboxHandlers,
): Promise<InboxConnection> {
    const { onEvent, onStatus, onReconnect, onAuthError } = handlers
    const client = new RTCForgeClient({
        serverUrl: wsBaseUrl(),
        token,
        reconnect: true,
        // Each reconnect re-auths with the freshest token from storage (a
        // re-login in another tab updates it); a stale/expired one closes with
        // 1008 → Terminated instead of looping on a token that can't work.
        tokenRefresh: async () => localStorage.getItem('fc_token') || token,
    })
    const close = () => {
        client.leave().catch(() => undefined)
    }

    let established = false
    client.on(ClientEvent.Connected, () => {
        onStatus?.('connected')
        // The first Connected is the initial join; any later one is a reconnect
        // after a drop → resync the state we missed while offline.
        if (established) onReconnect?.()
        else established = true
    })
    client.on(ClientEvent.Reconnecting, (attempt: number) => onStatus?.('reconnecting', attempt))
    client.on(ClientEvent.Terminated, () => {
        onStatus?.('terminated')
        close()
        onAuthError?.()
    })

    try {
        const room = await client.joinRoom(`inbox:${userId}`)
        room.on('broadcast', (_from: string, channel: string, data: unknown) => {
            if (channel === 'inbox') onEvent(data as InboxEvent)
        })
    } catch (err) {
        // Never leave the client dangling: an un-closed client keeps reconnecting
        // in the background even though the caller never got a handle to close it.
        close()
        throw err
    }

    return { client, close }
}
