'use strict'

/**
 * Stateless, signed session tokens — no database required.
 *
 * A token is `base64url(payloadJSON).base64url(HMAC-SHA256(payloadJSON))`.
 * The signature binds the user identity so both the HTTP API and the signaling
 * server's auth hook can trust the caller without shared session state.
 *
 * Two views are derived from one token:
 *   - verifySession(token) → { userId, username, displayName } for HTTP auth.
 *   - signalingAuth(token) → { roomId, peerId, role, metadata } the signaling
 *     server expects. roomId is the user's personal inbox room; peerId = userId.
 */

const crypto = require('node:crypto')
const config = require('../config')

function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64url')
}

function sign(payloadJson) {
    return crypto.createHmac('sha256', config.tokenSecret).update(payloadJson).digest()
}

function pack(payload) {
    const json = JSON.stringify(payload)
    return `${b64urlEncode(json)}.${b64urlEncode(sign(json))}`
}

/**
 * Session token — binds the user to their inbox room.
 * @param {{ userId: string, username: string, displayName: string }} claims
 */
function issueToken(claims) {
    return pack({
        userId: claims.userId,
        username: claims.username,
        displayName: claims.displayName,
        iat: Date.now(),
        exp: Date.now() + config.tokenTtlMs,
    })
}

/**
 * Call token — short-lived, scoped to ONE call room. Minted server-side only
 * after authorizing the user for that call, so joining a call room can't be
 * done with a plain session token.
 * @param {{ userId, username, displayName, roomId }} claims
 */
function issueCallToken(claims) {
    return pack({
        userId: claims.userId,
        username: claims.username,
        displayName: claims.displayName,
        room: claims.roomId,
        iat: Date.now(),
        exp: Date.now() + config.callTokenTtlMs,
    })
}

/** Verify signature + expiry, returning the raw payload. Throws on failure. */
function decode(token) {
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
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp)
        throw new Error('Token expired')
    return payload
}

/** HTTP session view. */
function verifySession(token) {
    const p = decode(token)
    return { userId: p.userId, username: p.username, displayName: p.displayName }
}

/**
 * Signaling auth-hook view. A session token binds to the user's inbox room; a
 * call token carries an explicit `room` (a `call:<id>` room).
 */
function signalingAuth(token) {
    const p = decode(token)
    return {
        roomId: p.room || config.inboxPrefix + p.userId,
        peerId: p.userId,
        role: 'member',
        metadata: { name: p.displayName || p.username || '', userId: p.userId },
    }
}

module.exports = { issueToken, issueCallToken, verifySession, signalingAuth }
