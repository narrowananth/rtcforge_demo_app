'use strict'

/**
 * Meeting tokens. A token binds identity + role to ONE meeting room. The room id
 * carries the meeting TYPE as its prefix (`call:` mesh, `room:`/`webinar:` SFU),
 * so both the signaling auth hook and the SFU publish policy can act on it.
 */

const { createTokens } = require('@forgechat/rtc-shared/server')
const config = require('./config')

const tokens = createTokens({ secret: config.tokenSecret })

const VALID_ROLES = new Set(['host', 'panelist', 'participant', 'audience'])
const PREFIXES = Object.values(config.types)

/**
 * @param {{ userId, name, type: 'call'|'room'|'webinar', meetingId, role }} claims
 */
function issueMeetingToken({ userId, name, type, meetingId, role }) {
    const prefix = config.types[type]
    if (!prefix) throw new Error(`Unknown meeting type: ${type}`)
    return tokens.mint({ userId, name, room: prefix + meetingId, role }, config.tokenTtlMs)
}

/** rtcforge signaling auth hook: token → { roomId, peerId, role, metadata }. */
function signalingAuth(token) {
    const p = tokens.verify(token)
    if (!PREFIXES.some((pre) => p.room?.startsWith(pre))) throw new Error('Token has no meeting')
    const role = VALID_ROLES.has(p.role) ? p.role : 'participant'
    return {
        roomId: p.room,
        peerId: p.userId,
        role,
        metadata: { name: p.name || 'anon', userId: p.userId },
    }
}

module.exports = { issueMeetingToken, signalingAuth, tokens }
