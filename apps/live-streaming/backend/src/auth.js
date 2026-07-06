'use strict'

/**
 * Stream tokens. A token binds a viewer/broadcaster identity to ONE stream room
 * and a role, so the signaling server's auth hook (and the SFU publish policy)
 * can trust who is allowed to publish without any shared session state. Built on
 * the shared HMAC token primitives — no bespoke crypto here.
 */

const { createTokens } = require('@forgechat/rtc-shared/server')
const config = require('./config')

const tokens = createTokens({ secret: config.tokenSecret })

/**
 * Mint a token for a stream participant.
 * @param {{ userId: string, name: string, streamId: string, role: 'broadcaster'|'viewer' }} claims
 */
function issueStreamToken({ userId, name, streamId, role }) {
    return tokens.mint(
        { userId, name, room: config.streamPrefix + streamId, role },
        config.tokenTtlMs,
    )
}

/**
 * rtcforge signaling auth hook: token → { roomId, peerId, role, metadata }.
 * Returning anything without a peerId rejects the connection.
 */
function signalingAuth(token) {
    const p = tokens.verify(token)
    if (!p.room?.startsWith(config.streamPrefix)) throw new Error('Token has no stream')
    return {
        roomId: p.room,
        peerId: p.userId,
        role: p.role === 'broadcaster' ? 'broadcaster' : 'viewer',
        metadata: { name: p.name || 'anon', userId: p.userId },
    }
}

module.exports = { issueStreamToken, signalingAuth }
