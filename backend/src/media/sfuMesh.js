'use strict'

/**
 * Cross-node cascade byte-relay — the media plane behind `rtcforge-sfu`'s
 * `CascadeTree`/`CascadeBridge`. It implements the `CascadePipeInterface`
 * (`pipeLink`/`unpipeLink`): when the cascade planner decides node A must relay a
 * room to node B, `pipeLink` wires a real mediasoup **pipe transport** pair
 * between the two nodes' `MediaRouter`s (rtcforge-media
 * `createPipeTransport`/`connectPipeTransport`) and pumps the room's producers
 * across it (`pipeConsume` → `pipeProduce`), so a producer on the origin node
 * appears on the edge node's router and its local viewers can consume it.
 *
 * Node resolution: each SFU node registers its `SfuService` here under its node
 * id. Two co-located nodes (same process — the cluster test, or a single-host
 * multi-worker deploy) pipe by calling both routers directly. For nodes in
 * SEPARATE processes/hosts the pipe-transport params must be exchanged over an
 * inter-node control channel — rtcforge ships the pipe primitives and the
 * membership gossip, but not that RPC, so a remote node that isn't registered
 * locally is logged and skipped (the seam where cross-host transport plugs in).
 */

const { MediaRouterEvent } = require('rtcforge-media')
const logger = require('../logger')

function roomLike(roomId) {
    // Minimal RoomLike so an edge node can attach a router for a room it isn't
    // hosting signaling for; the lifecycle events never fire for a piped room.
    return { id: roomId, on() {}, once() {}, off() {} }
}

class SfuMesh {
    constructor() {
        this._nodes = new Map() // nodeId -> SfuService
        this._links = new Map() // `${roomId}|${from}|${to}` -> link handle
    }

    /** Register a co-located SFU node's media service under its node id. */
    register(nodeId, sfuService) {
        this._nodes.set(nodeId, sfuService)
    }

    unregister(nodeId) {
        this._nodes.delete(nodeId)
    }

    _key(roomId, fromNodeId, toNodeId) {
        return `${roomId}|${fromNodeId}|${toNodeId}`
    }

    // --- CascadePipeInterface ----------------------------------------------

    /** Establish a cascade edge: relay `roomId` from `fromNodeId` to `toNodeId`. */
    pipeLink(roomId, fromNodeId, toNodeId) {
        const key = this._key(roomId, fromNodeId, toNodeId)
        if (this._links.has(key)) return
        const from = this._nodes.get(fromNodeId)
        const to = this._nodes.get(toNodeId)
        if (!from || !to) {
            // Remote node lives in another process — needs an inter-node control
            // channel to exchange pipe-transport params (not shipped by rtcforge).
            logger.info('cascade link deferred (remote node not co-located)', {
                roomId,
                fromNodeId,
                toNodeId,
            })
            return
        }
        // Reserve the slot synchronously so a re-entrant plan can't double-pipe.
        this._links.set(key, null)
        this._establish(key, roomId, from, to).catch((err) => {
            this._links.delete(key)
            logger.error('cascade pipe failed', { roomId, fromNodeId, toNodeId, err: err.message })
        })
    }

    /** Tear down a cascade edge. */
    unpipeLink(roomId, fromNodeId, toNodeId) {
        const key = this._key(roomId, fromNodeId, toNodeId)
        const link = this._links.get(key)
        this._links.delete(key)
        if (!link) return
        try {
            link.off?.()
        } catch {
            /* noop */
        }
    }

    async _establish(key, roomId, fromSvc, toSvc) {
        const fromRouter = await fromSvc.ensureRoom(roomLike(roomId))
        const toRouter = await toSvc.ensureRoom(roomLike(roomId))

        // Real mediasoup pipe transport pair, connected both directions.
        const fromPipe = await fromRouter.createPipeTransport()
        const toPipe = await toRouter.createPipeTransport()
        await fromRouter.connectPipeTransport(fromPipe.id, toPipe)
        await toRouter.connectPipeTransport(toPipe.id, fromPipe)

        const piped = new Set()
        const pump = (producer) => {
            this._pipeProducer(
                fromRouter,
                toRouter,
                fromPipe.id,
                toPipe.id,
                producer.id,
                piped,
            ).catch((err) => logger.warn('pipe producer failed', { roomId, err: err.message }))
        }
        // Pump producers added on the origin from here on. (rtcforge-media exposes
        // no producer enumeration, so producers created before the edge existed
        // are relayed on the origin's next ProducerAdded / re-plan.)
        fromRouter.on(MediaRouterEvent.ProducerAdded, pump)

        this._links.set(key, {
            off: () => fromRouter.off(MediaRouterEvent.ProducerAdded, pump),
        })
        logger.info('cascade edge established', {
            roomId,
            fromPipe: fromPipe.id,
            toPipe: toPipe.id,
        })
    }

    async _pipeProducer(fromRouter, toRouter, fromPipeId, toPipeId, producerId, piped) {
        if (piped.has(producerId)) return
        piped.add(producerId)
        const params = await fromRouter.pipeConsume(fromPipeId, producerId)
        await toRouter.pipeProduce(toPipeId, params)
    }

    /** For introspection / tests. */
    linkCount() {
        return this._links.size
    }

    hasLink(roomId, fromNodeId, toNodeId) {
        return this._links.has(this._key(roomId, fromNodeId, toNodeId))
    }
}

module.exports = { SfuMesh }
