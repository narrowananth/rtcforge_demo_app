'use strict'

/** Runtime config for the massive/multi-region streaming backend. */

function int(name, fallback) {
    const raw = process.env[name]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) throw new Error(`Invalid integer for env ${name}: "${raw}"`)
    return n
}

function list(name) {
    return (process.env[name] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
}

const NODE_ENV = process.env.NODE_ENV || 'development'
const isProd = NODE_ENV === 'production'

const DEFAULT_SECRET = 'dev-insecure-secret-change-me'
const tokenSecret = process.env.TOKEN_SECRET || DEFAULT_SECRET
if (isProd && tokenSecret === DEFAULT_SECRET) {
    throw new Error('TOKEN_SECRET must be set to a strong random value in production.')
}

module.exports = {
    nodeEnv: NODE_ENV,
    isProd,

    // HTTP + WebSocket (app 5 slot = 3005).
    port: int('PORT', 3005),
    host: process.env.HOST || '0.0.0.0',

    tokenSecret,
    tokenTtlMs: int('TOKEN_TTL_MS', 6 * 60 * 60 * 1000),

    maxMessagesPerSecond: int('MAX_MESSAGES_PER_SECOND', 120),
    allowedOrigins: list('ALLOWED_ORIGINS'),

    stunUrls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),

    // Cluster: N co-located SFU nodes in this process (real cascade piping;
    // rtcforge ships the pipe primitives, and cross-process pipe RPC is the one
    // seam it does not — so the demo fabric is single-process, multi-node).
    cluster: {
        // How many SFU worker-nodes to run in this process.
        nodeCount: int('CLUSTER_NODES', 3),
        region: process.env.CLUSTER_REGION || 'local',
        // Optional SWIM gossip for the multi-PROCESS discovery/placement axis.
        udpPort: int('CLUSTER_UDP_PORT', 0) || null,
        advertiseHost: process.env.CLUSTER_ADVERTISE_HOST || undefined,
        seeds: list('CLUSTER_SEEDS'),
        secret: process.env.GOSSIP_SECRET || undefined,
    },

    sfu: {
        // Deliberately small so a handful of viewers forces a cascade edge in a
        // dev demo. Bump to hundreds/thousands per node in production.
        viewersPerNode: int('SFU_VIEWERS_PER_NODE', 3),
        cascadeFanout: int('SFU_CASCADE_FANOUT', 2),
        numWorkers: int('SFU_WORKERS_PER_NODE', 1) || 1,
        listenIp: process.env.SFU_LISTEN_IP || '127.0.0.1',
        announcedIp: process.env.SFU_ANNOUNCED_IP || undefined,
        // Each node gets a slice of this range (rtcMinPort..rtcMaxPort / nodeCount).
        rtcMinPort: int('SFU_RTC_MIN_PORT', 45000),
        rtcMaxPort: int('SFU_RTC_MAX_PORT', 49999),
    },

    // A stream lives in `stream:<id>`.
    streamPrefix: 'stream:',
}
