'use strict'

/**
 * Password hashing with scrypt (built into Node — no native deps).
 * Stored format: `scrypt$N$r$p$saltB64$hashB64`.
 */

const crypto = require('node:crypto')
const { promisify } = require('node:util')

const scrypt = promisify(crypto.scrypt)

const N = 16384 // CPU/memory cost
const r = 8
const p = 1
const KEYLEN = 32

async function hashPassword(password) {
    const salt = crypto.randomBytes(16)
    const derived = await scrypt(password, salt, KEYLEN, { N, r, p })
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

async function verifyPassword(password, stored) {
    try {
        const [scheme, nStr, rStr, pStr, saltB64, hashB64] = String(stored).split('$')
        if (scheme !== 'scrypt') return false
        const salt = Buffer.from(saltB64, 'base64')
        const expected = Buffer.from(hashB64, 'base64')
        const derived = await scrypt(password, salt, expected.length, {
            N: Number(nStr),
            r: Number(rStr),
            p: Number(pStr),
        })
        return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
    } catch {
        return false
    }
}

module.exports = { hashPassword, verifyPassword }
