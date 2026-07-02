import { ClientEvent, RTCForgeClient } from 'rtcforge-sdk'
import type { InboxEvent } from '../../../shared/types'
import { wsBaseUrl } from '../../../shared/utils'

// The signaling server rejects a bad/expired token by closing the socket with
// RFC 6455 policy-violation (1008). Reconnecting with the same token can never
// succeed, so we must stop the backoff loop instead of hammering the server.
const CLOSE_POLICY_VIOLATION = 1008

export interface InboxConnection {
    client: RTCForgeClient
    close: () => void
}

/**
 * Connect the user's single realtime inbox (`inbox:<userId>`). The server pushes
 * every message/conversation/presence/call/transfer event on the `inbox`
 * broadcast channel.
 *
 * @param onAuthError invoked when the socket is closed for an auth failure
 *   (expired/invalid token). The caller should clear the session and re-login;
 *   reconnecting is pointless. The client is torn down before this fires.
 */
export async function connectInbox(
    userId: string,
    token: string,
    onEvent: (event: InboxEvent) => void,
    onAuthError?: () => void,
): Promise<InboxConnection> {
    const client = new RTCForgeClient({ serverUrl: wsBaseUrl(), token, reconnect: true })
    const close = () => {
        client.leave().catch(() => undefined)
    }

    // Kill the reconnect loop on a permanent auth rejection. `leave()` cancels any
    // pending reconnect; without this the `reconnect: true` client retries an
    // already-expired token every backoff tick forever (even after logout).
    client.on(ClientEvent.Disconnected, (code: number) => {
        if (code === CLOSE_POLICY_VIOLATION) {
            close()
            onAuthError?.()
        }
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
