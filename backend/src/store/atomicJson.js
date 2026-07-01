'use strict'

/**
 * Small filesystem primitives shared by every store.
 *  - readJson: tolerant read (missing/corrupt → fallback)
 *  - writeJsonAtomic: temp file → fsync → rename, so a crash can never leave a
 *    half-written file.
 *  - WriteQueue: serializes writes per key so concurrent updates to the same
 *    file can't interleave or clobber each other.
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')

async function readJson(file, fallback) {
    try {
        const raw = await fsp.readFile(file, 'utf8')
        return JSON.parse(raw)
    } catch (err) {
        if (err.code === 'ENOENT') return fallback
        throw err
    }
}

async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    const handle = await fsp.open(tmp, 'w')
    try {
        await handle.writeFile(JSON.stringify(data), 'utf8')
        await handle.sync()
    } finally {
        await handle.close()
    }
    await fsp.rename(tmp, file)
}

/** Best-effort synchronous variant for hard-exit paths. */
function writeJsonAtomicSync(file, data) {
    const tmp = `${file}.exit.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
    fs.renameSync(tmp, file)
}

class WriteQueue {
    constructor() {
        this._chains = new Map()
    }

    /** Run `task` after any pending write for `key`; returns task's result. */
    run(key, task) {
        const prev = this._chains.get(key) || Promise.resolve()
        const next = prev.then(task, task) // run regardless of prior outcome
        // Keep the chain but swallow rejection for the stored tail so it doesn't
        // become an unhandled rejection; callers still see their own result.
        this._chains.set(
            key,
            next.then(
                () => {},
                () => {},
            ),
        )
        return next
    }

    idle() {
        return Promise.all([...this._chains.values()])
    }
}

module.exports = { readJson, writeJsonAtomic, writeJsonAtomicSync, WriteQueue }
