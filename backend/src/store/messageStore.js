'use strict'

/**
 * Message persistence — one JSON file per conversation, no database.
 *
 * In-memory cache (Map<convId, Message[]>) loaded lazily; appends/mutations hit
 * memory so concurrent operations never race on a read-modify-write. Dirty
 * conversations are flushed on a debounce, atomically (temp → fsync → rename),
 * and capped at `maxStoredMessagesPerConversation`.
 */

const path = require('node:path')
const fsp = require('node:fs/promises')

const config = require('../config')
const logger = require('../logger')
const { readJson, writeJsonAtomic, writeJsonAtomicSync, WriteQueue } = require('./atomicJson')

class MessageStore {
    constructor() {
        this._cache = new Map()
        this._dirty = new Set()
        this._queue = new WriteQueue()
        this._timer = null
        this._closed = false
    }

    async init() {
        await fsp.mkdir(config.messagesDir, { recursive: true })
        this._timer = setInterval(() => this._flushDirty(), config.flushIntervalMs)
        this._timer.unref()
        logger.info('Message store ready')
    }

    _file(convId) {
        return path.join(config.messagesDir, `${convId}.json`)
    }

    async _load(convId) {
        if (this._cache.has(convId)) return this._cache.get(convId)
        const messages = (await readJson(this._file(convId), [])) || []
        if (this._cache.has(convId)) return this._cache.get(convId) // race guard
        this._cache.set(convId, Array.isArray(messages) ? messages : [])
        return this._cache.get(convId)
    }

    /** Append a fully-formed message record. */
    async append(convId, message) {
        const messages = await this._load(convId)
        messages.push(message)
        const overflow = messages.length - config.maxStoredMessagesPerConversation
        if (overflow > 0) messages.splice(0, overflow)
        this._dirty.add(convId)
        return message
    }

    async getById(convId, msgId) {
        const messages = await this._load(convId)
        return messages.find((m) => m.id === msgId) || null
    }

    /** Mutate a message in place via mutator(msg); returns updated msg or null. */
    async update(convId, msgId, mutator) {
        const messages = await this._load(convId)
        const msg = messages.find((m) => m.id === msgId)
        if (!msg) return null
        mutator(msg)
        this._dirty.add(convId)
        return msg
    }

    /**
     * Return history newest-last. `before` (ts) + `limit` support pagination.
     */
    async history(convId, { limit = 100, before } = {}) {
        const messages = await this._load(convId)
        let slice = messages
        if (before) slice = slice.filter((m) => m.ts < before)
        return slice.slice(Math.max(0, slice.length - limit))
    }

    _flushDirty() {
        if (this._dirty.size === 0) return
        const convs = [...this._dirty]
        this._dirty.clear()
        for (const convId of convs) this._write(convId)
    }

    _write(convId) {
        return this._queue.run(convId, async () => {
            const messages = this._cache.get(convId)
            if (!messages) return
            try {
                await writeJsonAtomic(this._file(convId), messages)
            } catch (err) {
                logger.error('Message flush failed; will retry', { convId, err: err.message })
                this._dirty.add(convId)
            }
        })
    }

    async close() {
        if (this._closed) return
        this._closed = true
        if (this._timer) clearInterval(this._timer)
        const convs = [...this._dirty]
        this._dirty.clear()
        await Promise.all(convs.map((c) => this._write(c)))
        await this._queue.idle()
        logger.info('Message store flushed and closed')
    }

    flushSyncBestEffort() {
        try {
            for (const [convId, messages] of this._cache) {
                if (!this._dirty.has(convId)) continue
                writeJsonAtomicSync(this._file(convId), messages)
            }
        } catch (err) {
            logger.error('Best-effort sync flush failed', { err: err.message })
        }
    }
}

module.exports = { MessageStore }
