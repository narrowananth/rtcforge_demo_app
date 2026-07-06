'use strict'

/**
 * Call & live-broadcast lifecycle.
 *
 * Media flows through the server SFU (`rtcforge/media`, see ../media/*): every
 * participant PRODUCES and CONSUMES over a `call:<id>` room, or — for a broadcast
 * list — the owner PRODUCES into a `bcast:<id>` room and every recipient CONSUMES
 * (one → many). This service manages the *lifecycle*: it creates the room, rings
 * the invitees over their inboxes, and mints the short-lived, role-bound call
 * tokens that authorise joining. Call state is in-memory and disposable.
 *
 *   call      → mode 'call'      → room 'call:<id>'  → all peers publish
 *   broadcast → mode 'broadcast' → room 'bcast:<id>' → only the owner publishes
 */

const config = require('../config')
const { newId, clock, InvalidArgumentError } = require('../rtc')
const { issueCallToken } = require('../auth/token')

function createCallService({ userStore, conversationStore, conversationService, hub }) {
    const calls = new Map() // callId -> call

    function tokenFor(user, callRoomId, role) {
        return issueCallToken({
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            roomId: callRoomId,
            role,
        })
    }

    async function place(callerId, convId, media) {
        if (media !== 'audio' && media !== 'video')
            throw new InvalidArgumentError('Invalid call type')
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, callerId))
            throw new InvalidArgumentError('Not allowed')

        const caller = await userStore.getById(callerId)
        const isBroadcast = conv.type === 'broadcast'
        // For a broadcast list `members` are the recipients (the owner is tracked
        // via `admins`); for calls, everyone but the caller is rung.
        const invitees = isBroadcast ? conv.members : conv.members.filter((id) => id !== callerId)
        if (invitees.length === 0) throw new InvalidArgumentError('No one to call')

        const callId = newId('c_')
        const callRoomId = `${isBroadcast ? 'bcast:' : 'call:'}${callId}`
        const call = {
            callId,
            convId,
            media,
            mode: isBroadcast ? 'broadcast' : 'call',
            callRoomId,
            fromId: callerId,
            fromName: caller.displayName,
            callees: new Set(invitees),
            joined: new Set([callerId]),
            status: 'ringing',
            createdAt: clock.now(),
            timer: null,
        }
        calls.set(callId, call)

        hub.pushToUsers(invitees, {
            type: isBroadcast ? 'broadcast-incoming' : 'call-incoming',
            callId,
            callRoomId,
            convId,
            media,
            mode: call.mode,
            from: { id: callerId, name: caller.displayName, avatar: caller.avatarColor },
        })

        call.timer = clock.setTimeout(() => expire(callId), config.callRingMs)
        call.timer.unref?.()

        // The owner of a broadcast is the sole publisher; a caller publishes too.
        const ownerRole = isBroadcast ? 'broadcaster' : 'member'
        return {
            callId,
            callRoomId,
            media,
            mode: call.mode,
            produce: true,
            token: tokenFor(caller, callRoomId, ownerRole),
        }
    }

    async function accept(callId, userId) {
        const call = calls.get(callId)
        if (!call) throw new InvalidArgumentError('Call not found or already ended')
        if (!call.callees.has(userId))
            throw new InvalidArgumentError('You were not invited to this call')
        clock.clearTimeout(call.timer)
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

        // Broadcast recipients are view-only; call participants publish.
        const joinerRole = call.mode === 'broadcast' ? 'viewer' : 'member'
        return {
            callId,
            callRoomId: call.callRoomId,
            media: call.media,
            mode: call.mode,
            produce: call.mode !== 'broadcast',
            from: { id: call.fromId, name: call.fromName },
            token: tokenFor(user, call.callRoomId, joinerRole),
        }
    }

    function decline(callId, userId) {
        const call = calls.get(callId)
        if (!call) return
        call.callees.delete(userId)
        hub.pushToUser(call.fromId, { type: 'call-declined', callId, by: userId })
        if (call.callees.size === 0 && call.joined.size <= 1) end(callId, userId)
    }

    /**
     * A participant leaves. Whether that ends the session depends on the mode:
     *
     *  - broadcast: the broadcaster is the master. A VIEWER leaving never ends
     *    the stream — the signaling room's `peerLeft` closes that viewer's
     *    transports, so their tile disappears for everyone while the broadcast
     *    stays live. Only the BROADCASTER leaving ends it, and every remaining
     *    invitee is told with `reason: 'broadcaster-left'` so their UI can show
     *    "the broadcaster ended the live stream".
     *  - call: a group call stays up while ≥2 participants remain, and winds
     *    down (call-ended) once only one is left.
     */
    function end(callId, actorId) {
        const call = calls.get(callId)
        if (!call) return
        call.callees.delete(actorId)
        call.joined.delete(actorId)

        const broadcasterLeft = call.mode === 'broadcast' && actorId === call.fromId

        // Non-terminal leaves — the session lives on for everyone else.
        if (call.mode === 'broadcast' && !broadcasterLeft) return
        if (call.mode === 'call' && call.joined.size >= 2) return

        const audience = new Set([call.fromId, ...call.joined, ...call.callees])
        audience.delete(actorId)
        hub.pushToUsers([...audience], {
            type: 'call-ended',
            callId,
            reason: broadcasterLeft ? 'broadcaster-left' : undefined,
        })
        clock.clearTimeout(call.timer)
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
