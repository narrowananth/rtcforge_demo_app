'use strict'

/**
 * Peer-to-peer media transfer sessions.
 *
 * When a DM peer is online, media bytes are sent directly browser→browser over a
 * WebRTC data channel (rtcforge-media `Call`) — no server hop for the payload.
 * This service only brokers the session: it creates an ephemeral `p2p:<id>`
 * room, mints the room-scoped tokens both sides need to join, and rings the
 * recipient over their inbox. If the peer is offline (or it's not a DM), it
 * reports `p2p:false` and the client falls back to the HTTP media store.
 */

const { newId, clock, InvalidArgumentError } = require('../rtc')
const { issueCallToken } = require('../auth/token')

function createTransferService({ userStore, conversationStore, conversationService, hub }) {
    const sessions = new Map() // transferId -> { timer }
    const TTL_MS = 60000

    function tokenFor(user, roomId) {
        return issueCallToken({
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            roomId,
        })
    }

    async function offer(senderId, convId, meta) {
        const conv = await conversationStore.get(convId)
        if (!conv || !conversationService.isMember(conv, senderId))
            throw new InvalidArgumentError('Not allowed')

        // P2P is 1:1 only; groups/broadcast use the HTTP store.
        if (conv.type !== 'dm') return { p2p: false }
        const otherId = conv.members.find((id) => id !== senderId)
        if (!otherId || !hub.isOnline(otherId)) return { p2p: false }

        const sender = await userStore.getById(senderId)
        const recipient = await userStore.getById(otherId)
        const transferId = newId('t_')
        const roomId = `p2p:${transferId}`

        const timer = clock.setTimeout(() => sessions.delete(transferId), TTL_MS)
        timer.unref?.()
        sessions.set(transferId, { timer })

        // The recipient's own room-scoped token is pushed to them — no accept
        // round-trip needed for a background file transfer.
        hub.pushToUser(otherId, {
            type: 'p2p-incoming',
            transferId,
            roomId,
            token: tokenFor(recipient, roomId),
            meta: sanitizeMeta(meta),
            from: { id: sender.id, name: sender.displayName },
            convId,
        })

        return { p2p: true, transferId, roomId, token: tokenFor(sender, roomId) }
    }

    function sanitizeMeta(meta) {
        meta = meta || {}
        return {
            filename: String(meta.filename || 'file').slice(0, 200),
            mime: String(meta.mime || 'application/octet-stream').slice(0, 100),
            size: Number(meta.size) || 0,
        }
    }

    return { offer }
}

module.exports = { createTransferService }
