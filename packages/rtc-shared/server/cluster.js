'use strict'

/**
 * Cluster membership for a node, built entirely on rtcforge/core + rtcforge/sfu.
 *
 * The returned `membership` is handed to both `SignalingServer({ cluster })` (so
 * its RoomRouter consistent-hashes rooms to an owner) and `SfuCluster` (so media
 * and signaling agree on topology).
 *
 * Default: `MemoryMembership` (single node, heartbeated). Pass `udpPort` to
 * switch to SWIM gossip (`GossipMembership`) over `rtcforge/sfu/udp`'s
 * `UdpGossipTransport` and shard across a real multi-host cluster — no
 * Redis/etcd, no app changes. Fully parameterized.
 */

const { MemoryMembership } = require('./core')

/**
 * @param {object} opts
 * @param {string} opts.selfId
 * @param {string} [opts.region='local']
 * @param {number|null} [opts.udpPort]      gossip port (null → single-node memory)
 * @param {string} [opts.advertiseHost]
 * @param {string[]} [opts.seeds]           gossip seed addresses "host:port"
 * @param {string} [opts.secret]            gossip HMAC secret (untrusted networks)
 * @param {import('rtcforge/core').Logger} [opts.logger]
 */
function createCluster(opts) {
    const { selfId, region = 'local', udpPort, advertiseHost, seeds = [], secret, logger } = opts
    const self = {
        id: selfId,
        region,
        address: udpPort ? `${advertiseHost || '127.0.0.1'}:${udpPort}` : undefined,
        metadata: {},
    }

    if (udpPort) {
        const { GossipMembership } = require('rtcforge/core')
        const { UdpGossipTransport } = require('rtcforge/sfu/udp')
        const transport = new UdpGossipTransport({ port: udpPort, advertiseHost, secret, logger })
        const membership = new GossipMembership(self, transport, { seeds })
        return {
            self,
            membership,
            mode: 'gossip',
            async start() {
                await transport.listen()
                await membership.register(self)
                membership.start()
                logger?.info('Cluster membership: gossip', { self: self.id, port: udpPort, seeds })
            },
            async stop() {
                membership.stop()
                transport.close?.()
            },
        }
    }

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
                        logger?.warn('membership heartbeat failed', { err: err.message }),
                    )
            }, TTL_MS / 3)
            heartbeat.unref?.()
            logger?.info('Cluster membership: single-node', { self: self.id })
        },
        async stop() {
            if (heartbeat) clearInterval(heartbeat)
            await membership.deregister(self.id).catch(() => undefined)
        },
    }
}

module.exports = { createCluster }
