'use strict'

/** Runtime config for the collaborative backend. Env with safe dev defaults. */

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

    // HTTP + WebSocket share one server (app 3 slot = 3003).
    port: int('PORT', 3003),
    host: process.env.HOST || '0.0.0.0',

    tokenSecret,
    tokenTtlMs: int('TOKEN_TTL_MS', 12 * 60 * 60 * 1000), // 12h

    // Live cursors + strokes burst many small frames — allow a generous rate.
    maxMessagesPerSecond: int('MAX_MESSAGES_PER_SECOND', 240),
    maxMembersPerBoard: int('MAX_MEMBERS_PER_BOARD', 100),
    allowedOrigins: list('ALLOWED_ORIGINS'),

    // Room naming convention: a board lives in `board:<id>`.
    boardPrefix: 'board:',
}
