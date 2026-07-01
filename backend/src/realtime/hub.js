'use strict'

/**
 * Realtime fanout hub.
 *
 * Every logged-in user holds ONE signaling connection to their personal inbox
 * room (`inbox:<userId>`, peerId = userId). The server pushes events to a user
 * by sending on that peer. This is the WhatsApp-style model: a message sent to
 * any conversation is fanned out to each member's inbox in real time, while the
 * durable copy lives in the message store.
 *
 * Events are delivered as a signaling `broadcast` message on the `inbox`
 * channel: { type:'broadcast', from:'server', channel:'inbox', data:<event> }.
 */

const config = require('../config')
const logger = require('../logger')

class RealtimeHub {
    constructor(signaling) {
        this._signaling = signaling
        this._onPresence = null
    }

    /** Wire signaling lifecycle → presence transitions. */
    bind() {
        this._signaling.on('roomCreated', (room) => {
            if (!room.id.startsWith(config.inboxPrefix)) return
            const userId = room.id.slice(config.inboxPrefix.length)
            this._emitPresence(userId, true)
            room.on('peerJoined', () => this._emitPresence(userId, true))
            room.on('peerLeft', () => {
                if (room.getPeerCount() === 0) this._emitPresence(userId, false)
            })
        })
    }

    _inboxPeer(userId) {
        const room = this._signaling.getRoom(config.inboxPrefix + userId)
        return room ? room.getPeer(userId) : undefined
    }

    isOnline(userId) {
        return !!this._inboxPeer(userId)
    }

    /** @returns {boolean} whether the event was delivered live */
    pushToUser(userId, event) {
        const peer = this._inboxPeer(userId)
        if (!peer) return false
        try {
            peer.send({
                type: 'broadcast',
                from: 'server',
                channel: config.inboxChannel,
                data: event,
                ts: Date.now(),
            })
            return true
        } catch (err) {
            logger.warn('Inbox push failed', { userId, err: err.message })
            return false
        }
    }

    /** Push to many users; returns the set that were online. */
    pushToUsers(userIds, event) {
        const delivered = new Set()
        for (const id of new Set(userIds)) {
            if (this.pushToUser(id, event)) delivered.add(id)
        }
        return delivered
    }

    onPresence(cb) {
        this._onPresence = cb
    }

    _emitPresence(userId, online) {
        if (this._onPresence) {
            Promise.resolve(this._onPresence(userId, online)).catch((err) =>
                logger.error('presence handler failed', { userId, err: err.message }),
            )
        }
    }
}

module.exports = { RealtimeHub }
