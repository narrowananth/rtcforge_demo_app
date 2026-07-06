'use strict'

/**
 * Runtime configuration for the live-streaming backend. Env with safe dev
 * defaults; fail fast in production if the token secret is left insecure.
 */

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

    // HTTP + WebSocket share one server on this port (app 2 slot = 3002).
    port: int('PORT', 3002),
    host: process.env.HOST || '0.0.0.0',

    tokenSecret,
    // Broadcaster/viewer tokens are scoped to one stream room; keep them short.
    tokenTtlMs: int('TOKEN_TTL_MS', 6 * 60 * 60 * 1000), // 6h

    // Signaling limits. SFU produce/consume bursts many small control frames.
    maxMessagesPerSecond: int('MAX_MESSAGES_PER_SECOND', 120),
    // A stream room = 1 broadcaster + up to N viewers on this node.
    maxViewersPerStream: int('MAX_VIEWERS_PER_STREAM', 500),
    allowedOrigins: list('ALLOWED_ORIGINS'),

    // ICE for viewers/broadcaster (mediasoup transports announce their own
    // candidates; this STUN/TURN is a belt-and-braces fallback via the hook).
    stunUrls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
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

    // SFU media (rtcforge/media → mediasoup).
    sfu: {
        numWorkers: int('SFU_WORKERS', 0) || undefined,
        listenIp: process.env.SFU_LISTEN_IP || '127.0.0.1',
        announcedIp: process.env.SFU_ANNOUNCED_IP || undefined,
        rtcMinPort: int('SFU_RTC_MIN_PORT', 40000),
        rtcMaxPort: int('SFU_RTC_MAX_PORT', 49999),
    },

    // Room naming convention: a stream lives in `stream:<streamId>`.
    streamPrefix: 'stream:',
}
