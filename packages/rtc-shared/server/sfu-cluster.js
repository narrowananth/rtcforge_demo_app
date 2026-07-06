'use strict'

/**
 * Broadcast fan-out topology, powered by `rtcforge/sfu`.
 *
 * `SfuCluster` tracks SFU nodes (discovered from the shared `Membership` — the
 * same gossip cluster the signaling RoomRouter uses, so signaling + media agree
 * on topology). `CascadeTree` plans how one broadcaster's stream fans out across
 * those nodes (origin → relay → edge) within per-node `capacity` and a branching
 * `fanout`. `CascadeBridge` turns the tree's link decisions into real media pipes
 * via the injected `SfuMesh`.
 *
 * Single node → a one-node origin plan, no links. Add nodes → the tree grows
 * edges and the bridge pipes the room across them. Fully parameterized (logger,
 * capacity, fanout, placement strategy injected).
 */

const {
    SfuCluster,
    CascadeTree,
    CascadeBridge,
    SfuNode,
    LeastLoadedStrategy,
} = require('rtcforge/sfu')

class SfuTopology {
    /**
     * @param {object} opts
     * @param {import('rtcforge/core').NodeInfo} opts.self
     * @param {import('./sfu-mesh').SfuMesh} [opts.mesh]
     * @param {import('rtcforge/core').Membership} [opts.membership]
     * @param {import('rtcforge/core').Logger} [opts.logger]
     * @param {number} [opts.capacity=500]  viewers per node
     * @param {number} [opts.fanout=4]      cascade branching factor
     * @param {any} [opts.placementStrategy] defaults to LeastLoadedStrategy
     */
    constructor({ self, mesh, membership, logger, capacity = 500, fanout = 4, placementStrategy }) {
        this._selfId = self.id
        this._logger = logger
        this._capacity = capacity
        const region = self.region || 'local'
        const nodeFactory = (info) =>
            new SfuNode(info.id, info.region || region, { logger, capacity })

        this._cluster = new SfuCluster({
            logger,
            placementStrategy: placementStrategy || new LeastLoadedStrategy(),
            membership,
            nodeFactory,
        })
        // Without membership (tests) the reconciler won't seed the local node.
        if (!membership && !this._cluster.nodes.some((n) => n.id === self.id)) {
            this._cluster.addNode(nodeFactory(self))
        }

        this._tree = new CascadeTree(this._cluster, { fanout, viewersPerNode: capacity, logger })
        this._bridge = mesh ? new CascadeBridge(this._tree, mesh) : null
        this._bridge?.attach()
    }

    get cluster() {
        return this._cluster
    }
    get tree() {
        return this._tree
    }

    /** Add a co-located node to the ring explicitly (single-process multi-node). */
    addNode(id, region = 'local') {
        if (!this._cluster.nodes.some((n) => n.id === id)) {
            this._cluster.addNode(
                new SfuNode(id, region, { logger: this._logger, capacity: this._capacity }),
            )
        }
    }

    /** Plan (or re-plan) the fan-out tree for a broadcast room. Best-effort. */
    planBroadcast(roomId, originNodeId, viewerCount) {
        try {
            const plan = this._tree.build(roomId, originNodeId, Math.max(0, viewerCount | 0))
            this._logger?.info('broadcast fan-out planned', {
                roomId,
                origin: originNodeId,
                viewers: viewerCount,
                tiers: plan.tiers,
                edges: plan.edges.length,
                links: plan.links.length,
                servedViewers: plan.servedViewers,
                unmetViewers: plan.unmetViewers,
            })
            return plan
        } catch (err) {
            this._logger?.warn('cascade plan skipped', { roomId, err: err.message })
            return null
        }
    }

    detach(roomId) {
        this._tree.detach(roomId)
    }

    /** Node list for a cluster status view. */
    nodes() {
        return this._cluster.nodes.map((n) => ({
            id: n.id,
            region: n.region,
            capacity: n.capacity ?? this._capacity,
        }))
    }

    dispose() {
        this._bridge?.detach()
        this._tree.dispose()
        this._cluster.dispose()
    }
}

module.exports = { SfuTopology }
