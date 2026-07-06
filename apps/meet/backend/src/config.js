'use strict'

/** Runtime config for the meet backend. Env with safe dev defaults. */

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

    // HTTP + WebSocket share one server (app 4 slot = 3004).
    port: int('PORT', 3004),
    host: process.env.HOST || '0.0.0.0',

    tokenSecret,
    tokenTtlMs: int('TOKEN_TTL_MS', 6 * 60 * 60 * 1000), // 6h

    maxMessagesPerSecond: int('MAX_MESSAGES_PER_SECOND', 120),
    // A mesh `call` stays small; SFU `room`/`webinar` scale far higher.
    meshLimit: int('MESH_LIMIT', 4),
    maxParticipants: int('MAX_PARTICIPANTS', 50),
    allowedOrigins: list('ALLOWED_ORIGINS'),

    // ICE for mesh P2P + SFU fallback.
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

    sfu: {
        numWorkers: int('SFU_WORKERS', 0) || undefined,
        listenIp: process.env.SFU_LISTEN_IP || '127.0.0.1',
        announcedIp: process.env.SFU_ANNOUNCED_IP || undefined,
        rtcMinPort: int('SFU_RTC_MIN_PORT', 40000),
        rtcMaxPort: int('SFU_RTC_MAX_PORT', 49999),
    },

    // Room naming: `call:<id>` (mesh), `room:<id>` / `webinar:<id>` (SFU).
    types: {
        call: 'call:',
        room: 'room:',
        webinar: 'webinar:',
    },
}
