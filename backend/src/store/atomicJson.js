'use strict'

/**
 * Small filesystem primitives shared by every store.
 *  - readJson: tolerant read (missing/corrupt → fallback)
 *  - writeJsonAtomic: temp file → fsync → rename, so a crash can never leave a
 *    half-written file.
 *  - WriteQueue: serializes writes per key via a rtcforge-core `Lock` so
 *    concurrent updates to the same file can't interleave or clobber each other.
 *
 * The disk I/O itself is unavoidably local — rtcforge is real-time infra, not a
 * storage layer — but the concurrency control (the `Lock`) and id generation
 * come from rtcforge-core.
 */

const fsp = require('node:fs/promises')
const logger = require('../logger')
const { MemoryLock, newId } = require('../rtc')

async function readJson(file, fallback) {
    let raw
    try {
        raw = await fsp.readFile(file, 'utf8')
    } catch (err) {
        if (err.code === 'ENOENT') return fallback
        throw err // genuine I/O error — don't mask it
    }
    // A truncated/corrupt snapshot must degrade to the fallback, not throw and
    // take a store's init() (and the whole server boot) down with it. Atomic
    // temp→fsync→rename writes make this rare, but tampering/partial disks happen.
    try {
        return JSON.parse(raw)
    } catch (err) {
        logger.warn('Corrupt JSON snapshot; using fallback', { file, err: err.message })
        return fallback
    }
}

async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${newId()}.tmp`
    const handle = await fsp.open(tmp, 'w')
    try {
        await handle.writeFile(JSON.stringify(data), 'utf8')
        await handle.sync()
    } finally {
        await handle.close()
    }
    await fsp.rename(tmp, file)
}

/**
 * Per-key write serializer backed by a rtcforge-core `MemoryLock` (a mutex).
 * `run(key, task)` holds the lock for `key` for the duration of `task`, so
 * read-modify-write sequences on the same file are mutually exclusive.
 */
class WriteQueue {
    constructor() {
        this._lock = new MemoryLock()
        this._inflight = new Set()
    }

    run(key, task) {
        const promise = this._runLocked(key, task)
        this._inflight.add(promise)
        // Track completion without turning a caller's rejection into an
        // unhandled one on the tracking copy.
        void promise
            .then(
                () => {},
                () => {},
            )
            .finally(() => this._inflight.delete(promise))
        return promise
    }

    async _runLocked(key, task) {
        // MemoryLock is a non-blocking, TTL-bounded mutex: acquire returns null
        // when held, and the lock auto-expires after the TTL even if the holder
        // hasn't released — so the TTL must comfortably exceed the worst-case task
        // (a JSON write, ~ms) or two writers could run concurrently and clobber.
        // Spin briefly until we win the lock, then run under mutual exclusion.
        let token = await this._lock.acquire(key, 60000)
        while (!token) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            token = await this._lock.acquire(key, 60000)
        }
        try {
            return await task()
        } finally {
            await this._lock.release(key, token)
        }
    }

    idle() {
        return Promise.all([...this._inflight])
    }
}

module.exports = { readJson, writeJsonAtomic, WriteQueue }
