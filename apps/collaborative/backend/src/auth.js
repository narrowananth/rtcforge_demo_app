'use strict'

/**
 * Board tokens. A token binds a member identity (name + display colour) to ONE
 * board room, so the signaling auth hook can trust who is who. Built on the
 * shared HMAC token primitives.
 */

const { createTokens } = require('@forgechat/rtc-shared/server')
const config = require('./config')

const tokens = createTokens({ secret: config.tokenSecret })

/**
 * @param {{ userId: string, name: string, color: string, boardId: string }} claims
 */
function issueBoardToken({ userId, name, color, boardId }) {
    return tokens.mint(
        { userId, name, color, room: config.boardPrefix + boardId },
        config.tokenTtlMs,
    )
}

/** rtcforge signaling auth hook: token → { roomId, peerId, role, metadata }. */
function signalingAuth(token) {
    const p = tokens.verify(token)
    if (!p.room?.startsWith(config.boardPrefix)) throw new Error('Token has no board')
    return {
        roomId: p.room,
        peerId: p.userId,
        role: 'member',
        metadata: { name: p.name || 'anon', color: p.color || '#7c5cff', userId: p.userId },
    }
}

module.exports = { issueBoardToken, signalingAuth }
