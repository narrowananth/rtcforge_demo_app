'use strict'

/**
 * Call signaling orchestration (Phase 2).
 *
 * The media itself flows peer-to-peer via `rtcforge-media` `Call` (a mesh over a
 * shared signaling room). This service only manages the *lifecycle*: it creates
 * an ephemeral `call:<id>` room, rings the callees over their inboxes, mints the
 * short-lived call tokens that authorize joining that room, and relays
 * accept/decline/end signals. Call state is in-memory and disposable.
 */

const crypto = require('node:crypto')
const config = require('../config')
const { issueCallToken } = require('../auth/token')
const { ValidationError } = require('./userService')

function createCallService({ userStore, conversationStore, conversationService, hub }) {
    const calls = new Map() // callId -> call

    function tokenFor(user, callRoomId) {
        return issueCallToken({
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            roomId: callRoomId,
        })
    }

    async function place(callerId, convId, media) {
        if (media !== 'audio' && media !== 'video') throw new ValidationError('Invalid call type')
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, callerId))
            throw new ValidationError('Not allowed')
        if (conv.type === 'broadcast') throw new ValidationError('Cannot call a broadcast list')

        const caller = await userStore.getById(callerId)
        const callees = conv.members.filter((id) => id !== callerId)
        if (callees.length === 0) throw new ValidationError('No one to call')

        const callId = `c_${crypto.randomBytes(9).toString('hex')}`
        const callRoomId = `call:${callId}`
        const call = {
            callId,
            convId,
            media,
            callRoomId,
            fromId: callerId,
            fromName: caller.displayName,
            callees: new Set(callees),
            joined: new Set([callerId]),
            status: 'ringing',
            createdAt: Date.now(),
            timer: null,
        }
        calls.set(callId, call)

        hub.pushToUsers(callees, {
            type: 'call-incoming',
            callId,
            callRoomId,
            convId,
            media,
            from: { id: callerId, name: caller.displayName, avatar: caller.avatarColor },
        })

        call.timer = setTimeout(() => expire(callId), config.callRingMs)
        call.timer.unref?.()

        return { callId, callRoomId, media, token: tokenFor(caller, callRoomId) }
    }

    async function accept(callId, userId) {
        const call = calls.get(callId)
        if (!call) throw new ValidationError('Call not found or already ended')
        if (!call.callees.has(userId))
            throw new ValidationError('You were not invited to this call')
        clearTimeout(call.timer)
        call.status = 'active'
        call.callees.delete(userId)
        call.joined.add(userId)

        const user = await userStore.getById(userId)
        const notify = [...call.joined].filter((id) => id !== userId)
        hub.pushToUsers(notify, {
            type: 'call-accepted',
            callId,
            by: { id: userId, name: user.displayName },
        })

        return {
            callId,
            callRoomId: call.callRoomId,
            media: call.media,
            from: { id: call.fromId, name: call.fromName },
            token: tokenFor(user, call.callRoomId),
        }
    }

    function decline(callId, userId) {
        const call = calls.get(callId)
        if (!call) return
        call.callees.delete(userId)
        hub.pushToUser(call.fromId, { type: 'call-declined', callId, by: userId })
        if (call.callees.size === 0 && call.joined.size <= 1) end(callId, userId)
    }

    /** A participant leaves. When only one remains (or the caller ends), the call closes. */
    function end(callId, actorId) {
        const call = calls.get(callId)
        if (!call) return
        const audience = new Set([call.fromId, ...call.joined, ...call.callees])
        audience.delete(actorId)
        hub.pushToUsers([...audience], { type: 'call-ended', callId })
        clearTimeout(call.timer)
        calls.delete(callId)
    }

    function expire(callId) {
        const call = calls.get(callId)
        if (!call) return
        hub.pushToUsers([call.fromId, ...call.callees], {
            type: 'call-ended',
            callId,
            reason: 'missed',
        })
        calls.delete(callId)
    }

    return { place, accept, decline, end }
}

module.exports = { createCallService }
