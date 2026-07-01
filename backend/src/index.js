'use strict'

const { createApp } = require('./server')
const logger = require('./logger')

const handle = createApp()

let shuttingDown = false
async function shutdown(signal, code = 0) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Received shutdown signal', { signal })
    const timer = setTimeout(() => {
        logger.error('Graceful shutdown timed out; forcing exit')
        process.exit(1)
    }, 10000)
    timer.unref()
    try {
        await handle.stop()
        clearTimeout(timer)
        process.exit(code)
    } catch (err) {
        logger.error('Error during shutdown', { err: err.message })
        process.exit(1)
    }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err: err.message, stack: err.stack })
    handle.flushSyncBestEffort()
    process.exit(1)
})
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) })
})

handle.start().catch((err) => {
    logger.error('Failed to start server', { err: err.message, stack: err.stack })
    process.exit(1)
})
