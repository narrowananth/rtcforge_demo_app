'use strict'

/**
 * Minimal structured logger implementing the rtcforge-core `Logger` interface
 * ({ debug, info, warn, error }). Emits one JSON object per line — friendly to
 * log shippers (Loki, CloudWatch, Datadog) in production, readable enough in dev.
 */

const config = require('./config')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[process.env.LOG_LEVEL] ?? (config.isProd ? LEVELS.info : LEVELS.debug)

function emit(level, msg, meta) {
    if (LEVELS[level] < threshold) return
    const record = { level, msg, time: new Date().toISOString() }
    if (meta && typeof meta === 'object') Object.assign(record, meta)
    const line = JSON.stringify(record)
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`)
    else process.stdout.write(`${line}\n`)
}

const logger = {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
}

module.exports = logger
