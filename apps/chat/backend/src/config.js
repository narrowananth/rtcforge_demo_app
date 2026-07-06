'use strict'

/**
 * Central runtime configuration. All values come from the environment with
 * sane production defaults. Fail fast in production if a required secret is
 * left at its insecure default.
 */

const path = require('node:path')
const { newId } = require('./rtc')

function int(name, fallback) {
    const raw = process.env[name]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) {
        throw new Error(`Invalid integer for env ${name}: "${raw}"`)
    }
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
    throw new Error(
        'TOKEN_SECRET must be set to a strong random value in production. ' +
            "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    )
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data')

const config = {
    nodeEnv: NODE_ENV,
    isProd,

    // HTTP + WebSocket share a single server bound to this port.
    port: int('PORT', 3001),
    host: process.env.HOST || '0.0.0.0',

    // Token signing.
    tokenSecret,
    tokenTtlMs: int('TOKEN_TTL_MS', 12 * 60 * 60 * 1000), // 12h
    callTokenTtlMs: int('CALL_TOKEN_TTL_MS', 60 * 60 * 1000), // 1h — scoped to one call room
    callRingMs: int('CALL_RING_MS', 45000),

    // Signaling server limits. SFU produce/consume handshakes burst many small
    // control messages, so this is higher than a plain chat app would need.
    maxMessagesPerSecond: int('MAX_MESSAGES_PER_SECOND', 120),
    pingInterval: int('PING_INTERVAL_MS', 25000),
    pongTimeout: int('PONG_TIMEOUT_MS', 60000),
    // CSWSH defense: only these browser Origins may open the signaling socket.
    // Empty allows any origin (dev / non-browser clients) — set in production.
    allowedOrigins: list('ALLOWED_ORIGINS'),
    // Hard capacity caps (defence-in-depth against connection/room floods).
    maxConnections: int('MAX_CONNECTIONS', 10000),
    maxRooms: int('MAX_ROOMS', 20000),

    // Persistence layout.
    dataDir,
    usersDir: path.join(dataDir, 'users'),
    conversationsDir: path.join(dataDir, 'conversations'),
    messagesDir: path.join(dataDir, 'messages'),
    mediaDir: path.join(dataDir, 'media'),
    usernameIndexFile: path.join(dataDir, 'username-index.json'),

    maxStoredMessagesPerConversation: int('MAX_STORED_MESSAGES_PER_CONVERSATION', 2000),
    flushIntervalMs: int('FLUSH_INTERVAL_MS', 800),

    // Application constraints (mirror client-side for UX).
    maxMessageLength: int('MAX_MESSAGE_LENGTH', 4000),
    maxUsernameLength: int('MAX_USERNAME_LENGTH', 32),
    minUsernameLength: 3,
    minPasswordLength: int('MIN_PASSWORD_LENGTH', 6),
    maxDisplayNameLength: int('MAX_DISPLAY_NAME_LENGTH', 48),
    maxGroupTitleLength: int('MAX_GROUP_TITLE_LENGTH', 60),
    maxGroupMembers: int('MAX_GROUP_MEMBERS', 256),
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 25 * 1024 * 1024), // 25 MB

    // Realtime conventions.
    inboxPrefix: 'inbox:', // signaling roomId for a user is `inbox:<userId>`
    inboxChannel: 'inbox', // broadcast channel carrying server→client events

    // WebRTC ICE configuration — delivered to clients via the signaling
    // iceServersHook (room-joined.iceServers). STUN for candidate discovery; TURN
    // for relay when a direct path can't be established (symmetric NAT, etc.).
    stunUrls: (
        process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'
    )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    turn: process.env.TURN_URL?.trim()
        ? {
              urls: process.env.TURN_URL.split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              username: process.env.TURN_USERNAME || undefined,
              credential: process.env.TURN_CREDENTIAL || undefined,
          }
        : null,

    // --- SFU media (rtcforge/media → mediasoup) ------------------------------
    // Server-side selective forwarding: a broadcaster/caller PRODUCES tracks and
    // every other room member CONSUMES them (one → many), instead of a P2P mesh.
    sfu: {
        enabled: (process.env.SFU_ENABLED ?? 'true') !== 'false',
        numWorkers: int('SFU_WORKERS', 0) || undefined, // 0 → let the pool decide (≈ CPU count)
        // mediasoup WebRTC transport listen/announce. For localhost dev the
        // default 127.0.0.1 works; in prod set SFU_ANNOUNCED_IP to the public IP.
        listenIp: process.env.SFU_LISTEN_IP || '127.0.0.1',
        announcedIp: process.env.SFU_ANNOUNCED_IP || undefined,
        rtcMinPort: int('SFU_RTC_MIN_PORT', 40000),
        rtcMaxPort: int('SFU_RTC_MAX_PORT', 49999),
        // CascadeTree fanout shape for broadcast rooms (many viewers).
        cascadeFanout: int('SFU_CASCADE_FANOUT', 4),
        viewersPerNode: int('SFU_VIEWERS_PER_NODE', 500),
    },

    // --- Cluster (rtcforge/core Membership + HashRing) ----------------------
    // Single node by default (MemoryMembership). Set CLUSTER_UDP_PORT to switch
    // to SWIM gossip over rtcforge/sfu/udp and shard rooms across nodes.
    cluster: {
        selfId: process.env.CLUSTER_NODE_ID || newId('node_'),
        region: process.env.CLUSTER_REGION || 'local',
        udpPort: int('CLUSTER_UDP_PORT', 0) || null,
        advertiseHost: process.env.CLUSTER_ADVERTISE_HOST || undefined,
        seeds: list('CLUSTER_SEEDS'), // e.g. "10.0.0.2:7946,10.0.0.3:7946"
    },
}

module.exports = config
