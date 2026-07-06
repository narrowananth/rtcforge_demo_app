'use strict'

/**
 * Cluster membership for this node, built entirely on rtcforge/core.
 *
 * The returned `membership` (a `Membership`) is handed to:
 *   - `SignalingServer({ cluster: { selfId, membership } })` — its internal
 *     `RoomRouter` consistent-hashes each room to an owning node.
 *   - `SfuCluster({ membership })` — SFU nodes are discovered/reconciled from the
 *     same source, so media routing and signaling agree on topology.
 *
 * Default: `MemoryMembership` (single node, heartbeated to stay live). Set
 * `CLUSTER_UDP_PORT` to switch to SWIM gossip (`GossipMembership`) over
 * `rtcforge/sfu/udp`'s `UdpGossipTransport` and shard across a real cluster —
 * no Redis/etcd, no app code changes.
 */

const config = require('../config')
const logger = require('../logger')
const { MemoryMembership } = require('../rtc')

/** This node's identity in the ring. */
function selfNode() {
    return {
        id: config.cluster.selfId,
        region: config.cluster.region,
        address: config.cluster.udpPort
            ? `${config.cluster.advertiseHost || '127.0.0.1'}:${config.cluster.udpPort}`
            : undefined,
        metadata: {},
    }
}

function createCluster() {
    const self = selfNode()

    if (config.cluster.udpPort) {
        // Multi-node: SWIM gossip over UDP.
        const { GossipMembership } = require('rtcforge/core')
        const { UdpGossipTransport } = require('rtcforge/sfu/udp')
        const transport = new UdpGossipTransport({
            port: config.cluster.udpPort,
            advertiseHost: config.cluster.advertiseHost,
            logger,
        })
        const membership = new GossipMembership(self, transport, { seeds: config.cluster.seeds })
        return {
            self,
            membership,
            mode: 'gossip',
            async start() {
                await transport.listen()
                await membership.register(self)
                membership.start()
                logger.info('Cluster membership: gossip', {
                    self: self.id,
                    port: config.cluster.udpPort,
                    seeds: config.cluster.seeds,
                })
            },
            async stop() {
                membership.stop()
                transport.close?.()
            },
        }
    }

    // Single node: keep self registered in an in-memory ring with a heartbeat so
    // it never ages out of `MemoryMembership`'s TTL sweep.
    const membership = new MemoryMembership()
    const TTL_MS = 30000
    let heartbeat = null
    return {
        self,
        membership,
        mode: 'memory',
        async start() {
            await membership.register(self, TTL_MS)
            heartbeat = setInterval(() => {
                membership
                    .register(self, TTL_MS)
                    .catch((err) =>
                        logger.warn('membership heartbeat failed', { err: err.message }),
                    )
            }, TTL_MS / 3)
            heartbeat.unref?.()
            logger.info('Cluster membership: single-node', { self: self.id })
        },
        async stop() {
            if (heartbeat) clearInterval(heartbeat)
            await membership.deregister(self.id).catch(() => undefined)
        },
    }
}

module.exports = { createCluster }
