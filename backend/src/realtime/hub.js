'use strict'

/**
 * Realtime fanout hub — built on rtcforge-core `EventEmitter` + `MessageBus`.
 *
 * Every logged-in user holds ONE signaling connection to their personal inbox
 * room (`inbox:<userId>`, peerId = userId). Server→client events are delivered
 * through a `MessageBus`: `pushToUser` publishes to the topic `inbox:<userId>`,
 * and the node that locally hosts that user's inbox peer holds the matching
 * subscription and pushes the event down the signaling socket.
 *
 * With the default in-process `LocalMessageBus` this is a single-node app. Swap
 * in a cluster-aware `MessageBus` (backed by gossip / a shared log) and the exact
 * same code fans out across nodes — a node can `pushToUser` a user it doesn't
 * host and the owning node delivers. No app code changes.
 *
 * Presence transitions are emitted as an EventEmitter `'presence'` event.
 *
 * Wire event shape (client sees):
 *   { type:'broadcast', from:'server', channel:'inbox', data:<event>, ts }
 */

const config = require('../config')
const logger = require('../logger')
const { EventEmitter, LocalMessageBus, clock } = require('../rtc')

class RealtimeHub extends EventEmitter {
    /**
     * @param {import('rtcforge-signaling').SignalingServer} signaling
     * @param {{ bus?: import('rtcforge-core').MessageBus }} [opts]
     */
    constructor(signaling, { bus } = {}) {
        super()
        this._signaling = signaling
        this._bus = bus || new LocalMessageBus()
        this._subs = new Map() // userId -> unsubscribe fn for its inbox topic
    }

    /** Wire signaling lifecycle → inbox subscriptions + presence transitions. */
    bind() {
        this._signaling.on('roomCreated', (room) => {
            if (!room.id.startsWith(config.inboxPrefix)) return
            const userId = room.id.slice(config.inboxPrefix.length)
            this._subscribeInbox(userId)
            this._emitPresence(userId, true)
            room.on('peerJoined', () => this._emitPresence(userId, true))
            room.on('peerLeft', () => {
                if (room.getPeerCount() === 0) {
                    this._unsubscribeInbox(userId)
                    this._emitPresence(userId, false)
                }
            })
        })
    }

    _topic(userId) {
        return config.inboxPrefix + userId // 'inbox:<userId>'
    }

    _subscribeInbox(userId) {
        if (this._subs.has(userId)) return
        const unsubscribe = this._bus.subscribe(this._topic(userId), (event) =>
            this._deliverLocal(userId, event),
        )
        this._subs.set(userId, unsubscribe)
    }

    _unsubscribeInbox(userId) {
        const unsubscribe = this._subs.get(userId)
        if (unsubscribe) {
            unsubscribe()
            this._subs.delete(userId)
        }
    }

    _inboxPeer(userId) {
        const room = this._signaling.getRoom(config.inboxPrefix + userId)
        return room ? room.getPeer(userId) : undefined
    }

    /** MessageBus subscriber: push the event onto this node's local inbox socket. */
    _deliverLocal(userId, event) {
        const peer = this._inboxPeer(userId)
        if (!peer) return
        try {
            peer.send({
                type: 'broadcast',
                from: 'server',
                channel: config.inboxChannel,
                data: event,
                ts: clock.now(),
            })
        } catch (err) {
            logger.warn('Inbox push failed', { userId, err: err.message })
        }
    }

    isOnline(userId) {
        return !!this._inboxPeer(userId)
    }

    /**
     * Publish an event to a user's inbox topic. Returns whether the user is
     * online on THIS node (best-effort liveness hint; actual delivery is async
     * via the bus and may happen on another node in a cluster).
     */
    pushToUser(userId, event) {
        const online = this.isOnline(userId)
        Promise.resolve(this._bus.publish(this._topic(userId), event)).catch((err) =>
            logger.warn('Inbox publish failed', { userId, err: err.message }),
        )
        return online
    }

    /** Push to many users; returns the set that were online on this node. */
    pushToUsers(userIds, event) {
        const delivered = new Set()
        for (const id of new Set(userIds)) {
            if (this.pushToUser(id, event)) delivered.add(id)
        }
        return delivered
    }

    /** Subscribe to presence transitions: cb(userId, online). */
    onPresence(cb) {
        this.on('presence', (userId, online) =>
            Promise.resolve(cb(userId, online)).catch((err) =>
                logger.error('presence handler failed', { userId, err: err.message }),
            ),
        )
    }

    _emitPresence(userId, online) {
        this.emit('presence', userId, online)
    }
}

module.exports = { RealtimeHub }
