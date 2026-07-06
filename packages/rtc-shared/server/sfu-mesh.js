'use strict'

/**
 * Cross-node cascade byte-relay — the media plane behind `rtcforge/sfu`'s
 * `CascadeTree`/`CascadeBridge`. Implements `CascadePipeInterface`
 * (`pipeLink`/`unpipeLink`): when the cascade planner decides node A must relay a
 * room to node B, `pipeLink` wires a real mediasoup **pipe transport** pair
 * between the two nodes' `MediaRouter`s and pumps the room's producers across it
 * (`pipeConsume` → `pipeProduce`) — a producer on the origin appears on the edge
 * router so the edge's local viewers can consume it.
 *
 * Co-located nodes (same process — cluster tests, or a single-host multi-worker
 * deploy) pipe by calling both routers directly. A node in a SEPARATE
 * process/host needs an inter-node control channel to exchange pipe-transport
 * params — rtcforge ships the pipe primitives + membership gossip but NOT that
 * RPC, so a remote node that isn't registered locally is logged and skipped
 * (the documented seam where cross-host transport plugs in).
 *
 * Parameterized: inject a logger; otherwise pure rtcforge/media.
 */

const { MediaRouterEvent } = require('rtcforge/media')

function roomLike(roomId) {
    return { id: roomId, on() {}, once() {}, off() {} }
}

class SfuMesh {
    /** @param {{ logger?: import('rtcforge/core').Logger }} [opts] */
    constructor(opts = {}) {
        this._logger = opts.logger
        this._nodes = new Map() // nodeId -> SfuService
        this._links = new Map() // `${roomId}|${from}|${to}` -> link handle
        this._producerSource = null // (roomId) => Iterable<producerId>
    }

    /** Supply the producer ids currently live in a room (so a freshly established
     * edge can backfill producers that predate the pipe). */
    setProducerSource(fn) {
        this._producerSource = fn
    }

    _existingProducerIds(roomId) {
        if (!this._producerSource) return []
        try {
            return [...this._producerSource(roomId)]
        } catch {
            return []
        }
    }

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

    pipeLink(roomId, fromNodeId, toNodeId) {
        const key = this._key(roomId, fromNodeId, toNodeId)
        if (this._links.has(key)) return
        const from = this._nodes.get(fromNodeId)
        const to = this._nodes.get(toNodeId)
        if (!from || !to) {
            this._logger?.info('cascade link deferred (remote node not co-located)', {
                roomId,
                fromNodeId,
                toNodeId,
            })
            return
        }
        this._links.set(key, null) // reserve slot synchronously against re-entrant plans
        this._establish(key, roomId, from, to).catch((err) => {
            this._links.delete(key)
            this._logger?.error('cascade pipe failed', {
                roomId,
                fromNodeId,
                toNodeId,
                err: err.message,
            })
        })
    }

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
            ).catch((err) =>
                this._logger?.warn('pipe producer failed', { roomId, err: err.message }),
            )
        }
        // Listener FIRST, then backfill existing producers — the shared `piped`
        // set makes the overlap idempotent (no double-pipe, no miss).
        fromRouter.on(MediaRouterEvent.ProducerAdded, pump)
        for (const producerId of this._existingProducerIds(roomId)) {
            this._pipeProducer(
                fromRouter,
                toRouter,
                fromPipe.id,
                toPipe.id,
                producerId,
                piped,
            ).catch((err) =>
                this._logger?.warn('pipe existing producer failed', {
                    roomId,
                    err: err.message,
                }),
            )
        }

        this._links.set(key, { off: () => fromRouter.off(MediaRouterEvent.ProducerAdded, pump) })
        this._logger?.info('cascade edge established', {
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

    linkCount() {
        return this._links.size
    }

    hasLink(roomId, fromNodeId, toNodeId) {
        return this._links.has(this._key(roomId, fromNodeId, toNodeId))
    }

    /** Snapshot of live cascade edges (for cluster status / dashboards). */
    links() {
        return [...this._links.keys()].map((k) => {
            const [roomId, from, to] = k.split('|')
            return { roomId, from, to }
        })
    }
}

module.exports = { SfuMesh }
