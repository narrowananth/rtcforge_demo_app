'use strict'

/**
 * Structured logger implementing the full rtcforge/core `Logger` interface
 * ({ debug, info, warn, error, fatal }). Emits one JSON object per line —
 * friendly to log shippers (Loki, CloudWatch, Datadog) in production, readable
 * enough in dev. Passed straight into `SignalingServer`, `MediaService`, the SFU
 * cluster, and gossip transport as their `logger`.
 *
 * @type {import('rtcforge/core').Logger}
 */

const config = require('./config')
const { clock } = require('./rtc')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 }
const threshold = LEVELS[process.env.LOG_LEVEL] ?? (config.isProd ? LEVELS.info : LEVELS.debug)

function emit(level, msg, meta) {
    if (LEVELS[level] < threshold) return
    const record = { level, msg, time: new Date(clock.now()).toISOString() }
    if (meta && typeof meta === 'object') Object.assign(record, meta)
    const line = JSON.stringify(record)
    if (level === 'error' || level === 'warn' || level === 'fatal')
        process.stderr.write(`${line}\n`)
    else process.stdout.write(`${line}\n`)
}

const logger = {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
    fatal: (msg, meta) => emit('fatal', msg, meta),
}

module.exports = logger
