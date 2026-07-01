'use strict'

const { verifySession } = require('../auth/token')
const logger = require('../logger')

/** Bearer-token auth → req.user = { userId, username, displayName }. */
function authRequired(req, res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token
    try {
        req.user = verifySession(token)
        next()
    } catch {
        res.status(401).json({ error: 'Authentication required' })
    }
}

/** Wrap async route handlers so rejections reach the error middleware. */
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

/** Terminal error handler — maps known errors to status codes. */
function errorHandler(err, req, res, _next) {
    const status = err.status || 500
    if (status >= 500)
        logger.error('Request failed', { path: req.path, err: err.message, stack: err.stack })
    res.status(status).json({ error: err.message || 'Server error' })
}

module.exports = { authRequired, asyncHandler, errorHandler }
