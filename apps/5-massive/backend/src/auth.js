'use strict'

/** Stream tokens (broadcaster/viewer), scoped to one stream room. */

const { createTokens } = require('@forgechat/rtc-shared/server')
const config = require('./config')

const tokens = createTokens({ secret: config.tokenSecret })

function issueStreamToken({ userId, name, streamId, role }) {
    return tokens.mint(
        { userId, name, room: config.streamPrefix + streamId, role },
        config.tokenTtlMs,
    )
}

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
