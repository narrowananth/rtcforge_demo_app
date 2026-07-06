'use strict'

/**
 * Structured JSON logger implementing the full rtcforge/core `Logger` interface
 * ({ debug, info, warn, error, fatal }) — one JSON object per line. Passed
 * straight into `SignalingServer`, `MediaService`, the SFU cluster, and gossip
 * transport as their `logger`.
 *
 * Parameterized so each app sets its own default level (prod → info, dev →
 * debug) without a hard config dependency.
 */

const { clock } = require('./core')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 }

/**
 * @param {{ isProd?: boolean, level?: keyof typeof LEVELS }} [opts]
 * @returns {import('rtcforge/core').Logger}
 */
function createLogger(opts = {}) {
    const level = opts.level || process.env.LOG_LEVEL
    const threshold = LEVELS[level] ?? (opts.isProd ? LEVELS.info : LEVELS.debug)

    function emit(lvl, msg, meta) {
        if (LEVELS[lvl] < threshold) return
        const record = { level: lvl, msg, time: new Date(clock.now()).toISOString() }
        if (meta && typeof meta === 'object') Object.assign(record, meta)
        const line = JSON.stringify(record)
        if (lvl === 'error' || lvl === 'warn' || lvl === 'fatal') process.stderr.write(`${line}\n`)
        else process.stdout.write(`${line}\n`)
    }

    return {
        debug: (msg, meta) => emit('debug', msg, meta),
        info: (msg, meta) => emit('info', msg, meta),
        warn: (msg, meta) => emit('warn', msg, meta),
        error: (msg, meta) => emit('error', msg, meta),
        fatal: (msg, meta) => emit('fatal', msg, meta),
    }
}

module.exports = { createLogger }
