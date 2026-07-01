'use strict'

/**
 * Central runtime configuration. All values come from the environment with
 * sane production defaults. Fail fast in production if a required secret is
 * left at its insecure default.
 */

const path = require('node:path')

function int(name, fallback) {
    const raw = process.env[name]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) {
        throw new Error(`Invalid integer for env ${name}: "${raw}"`)
    }
    return n
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

    // Signaling server limits.
    maxMessagesPerSecond: int('MAX_MESSAGES_PER_SECOND', 30),
    pingInterval: int('PING_INTERVAL_MS', 25000),
    pongTimeout: int('PONG_TIMEOUT_MS', 60000),

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
}

module.exports = config
