'use strict'

/**
 * Stateless, signed tokens — no database required. A token is
 * `base64url(payloadJSON).base64url(HMAC-SHA256(payloadJSON))`. The signature
 * binds arbitrary claims so both an HTTP API and the signaling server's auth
 * hook can trust the caller without shared session state.
 *
 * Each app builds its own claim shape and its own signaling-auth mapping on top
 * of these primitives (`mint`/`verify`); only the sign/pack/verify crypto is
 * shared. Nothing here is app-specific.
 */

const crypto = require('node:crypto')
const { clock } = require('./core')

/**
 * @param {{ secret: string }} opts
 */
function createTokens({ secret }) {
    if (!secret) throw new Error('createTokens: secret is required')

    const sign = (payloadJson) => crypto.createHmac('sha256', secret).update(payloadJson).digest()
    const b64url = (buf) => Buffer.from(buf).toString('base64url')

    /**
     * Sign a claims object, stamping `iat`/`exp` from `ttlMs`.
     * @param {Record<string, unknown>} claims
     * @param {number} ttlMs
     */
    function mint(claims, ttlMs) {
        const json = JSON.stringify({ ...claims, iat: clock.now(), exp: clock.now() + ttlMs })
        return `${b64url(json)}.${b64url(sign(json))}`
    }

    /** Verify signature + expiry, returning the raw payload. Throws on failure. */
    function verify(token) {
        if (typeof token !== 'string' || token.length === 0) throw new Error('Missing token')
        const dot = token.indexOf('.')
        if (dot <= 0 || dot === token.length - 1) throw new Error('Malformed token')

        const payloadJson = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8')
        const providedSig = Buffer.from(token.slice(dot + 1), 'base64url')
        const expectedSig = sign(payloadJson)
        if (
            providedSig.length !== expectedSig.length ||
            !crypto.timingSafeEqual(providedSig, expectedSig)
        ) {
            throw new Error('Bad signature')
        }

        let payload
        try {
            payload = JSON.parse(payloadJson)
        } catch {
            throw new Error('Corrupt payload')
        }
        if (typeof payload.exp !== 'number' || clock.now() > payload.exp)
            throw new Error('Token expired')
        return payload
    }

    return { mint, verify }
}

module.exports = { createTokens }
