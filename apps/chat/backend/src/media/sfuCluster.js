'use strict'

/**
 * Broadcast fanout topology, powered by `rtcforge/sfu`.
 *
 * `SfuCluster` tracks SFU nodes — discovered from the shared `Membership` (the
 * same gossip cluster the signaling RoomRouter uses), so signaling and media
 * agree on topology. `CascadeTree` plans how one broadcaster's stream fans out to
 * many viewers across those nodes (origin → relay → edge), respecting per-node
 * `viewersPerNode` capacity and a branching `fanout`. `CascadeBridge` turns the
 * tree's link decisions into real media pipes via the `SfuMesh`
 * (createPipeTransport → pipeConsume → pipeProduce).
 *
 * Single node → a one-node origin plan, no links (all media on the local
 * router). Add nodes (CLUSTER_UDP_PORT gossip) → the tree grows edges and the
 * bridge pipes the room across them.
 */

const {
    SfuCluster,
    CascadeTree,
    CascadeBridge,
    SfuNode,
    LeastLoadedStrategy,
} = require('rtcforge/sfu')
const config = require('../config')
const logger = require('../logger')

class SfuTopology {
    /**
     * @param {{
     *   self: import('rtcforge/core').NodeInfo,
     *   mesh?: import('./sfuMesh').SfuMesh,
     *   membership?: import('rtcforge/core').Membership,
     * }} opts
     */
    constructor({ self, mesh, membership }) {
        this._selfId = self.id
        const region = self.region || config.cluster.region
        const nodeFactory = (info) =>
            new SfuNode(info.id, info.region || region, {
                logger,
                capacity: config.sfu.viewersPerNode,
            })

        this._cluster = new SfuCluster({
            logger,
            placementStrategy: new LeastLoadedStrategy(),
            // Discover peer SFU nodes from the same gossip membership as signaling.
            membership,
            nodeFactory,
        })
        // With no membership (tests) the reconciler won't seed the local node, so
        // add it explicitly; with membership, self arrives via reconciliation.
        if (!membership && !this._cluster.nodes.some((n) => n.id === self.id)) {
            this._cluster.addNode(nodeFactory(self))
        }

        this._tree = new CascadeTree(this._cluster, {
            fanout: config.sfu.cascadeFanout,
            viewersPerNode: config.sfu.viewersPerNode,
            logger,
        })
        // Wire tree link decisions → real media pipes.
        this._bridge = mesh ? new CascadeBridge(this._tree, mesh) : null
        this._bridge?.attach()
    }

    get cluster() {
        return this._cluster
    }

    get tree() {
        return this._tree
    }

    /**
     * Plan (or re-plan) the fanout tree for a broadcast room. Best-effort: a
     * failure never blocks the broadcast (media still flows via the local
     * router). Emitting a link fires `CascadeBridge` → `SfuMesh.pipeLink`.
     * @returns {import('rtcforge/sfu').CascadePlan | null}
     */
    planBroadcast(roomId, viewerCount) {
        try {
            const plan = this._tree.build(roomId, this._selfId, Math.max(0, viewerCount | 0))
            logger.info('broadcast fanout planned', {
                roomId,
                viewers: viewerCount,
                tiers: plan.tiers,
                edges: plan.edges.length,
                servedViewers: plan.servedViewers,
                unmetViewers: plan.unmetViewers,
            })
            return plan
        } catch (err) {
            logger.warn('cascade plan skipped', { roomId, err: err.message })
            return null
        }
    }

    detach(roomId) {
        this._tree.detach(roomId)
    }

    dispose() {
        this._bridge?.detach()
        this._tree.dispose()
        this._cluster.dispose()
    }
}

module.exports = { SfuTopology }
