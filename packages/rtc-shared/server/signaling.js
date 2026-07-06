'use strict'

/**
 * Thin factory over rtcforge/server `SignalingServer` applying the safe defaults
 * every app wants (ping/pong heartbeat, rate limit, connection/room caps, audit
 * → logger) while leaving the app-specific seams — `auth`, `iceServersHook`,
 * `maxPeersPerRoom`, cluster — as explicit options. rtcforge owns the transport,
 * rooms, and relay; this just wires it consistently.
 */

const { SignalingServer } = require('rtcforge/server')

/**
 * @param {object} opts
 * @param {import('node:http').Server} opts.server            shared HTTP server (HTTP + WS)
 * @param {import('rtcforge/server').AuthFunction} opts.auth  token → { roomId, peerId, role, metadata }
 * @param {import('rtcforge/core').Logger} opts.logger
 * @param {import('rtcforge/core').MetricsCollector} [opts.metrics]
 * @param {(peerId: string, roomId: string) => (any[]|null)} [opts.iceServersHook]
 * @param {number} [opts.maxPeersPerRoom=512]
 * @param {number} [opts.maxMessagesPerSecond=120]
 * @param {number} [opts.pingInterval=25000]
 * @param {number} [opts.pongTimeout=60000]
 * @param {string[]} [opts.allowedOrigins]     CSWSH allowlist (empty ⇒ any, dev)
 * @param {number} [opts.maxConnections=10000]
 * @param {number} [opts.maxRooms=20000]
 * @param {{ selfId: string, membership: any }} [opts.cluster]
 * @returns {SignalingServer}
 */
function createSignaling(opts) {
    const signaling = new SignalingServer({
        server: opts.server,
        auth: opts.auth,
        logger: opts.logger,
        metrics: opts.metrics,
        maxPeersPerRoom: opts.maxPeersPerRoom ?? 512,
        pingInterval: opts.pingInterval ?? 25000,
        pongTimeout: opts.pongTimeout ?? 60000,
        rateLimit: { maxMessagesPerSecond: opts.maxMessagesPerSecond ?? 120 },
        allowedOrigins: opts.allowedOrigins?.length ? opts.allowedOrigins : undefined,
        maxConnections: opts.maxConnections ?? 10000,
        maxRooms: opts.maxRooms ?? 20000,
        iceServersHook: opts.iceServersHook,
        cluster: opts.cluster,
        // Security/compliance audit trail: peer & room join/leave/kick.
        auditLog: (event) => opts.logger?.info('audit', event),
    })
    signaling.on('error', (err) => opts.logger?.error('Signaling error', { err: err.message }))
    return signaling
}

module.exports = { createSignaling }
