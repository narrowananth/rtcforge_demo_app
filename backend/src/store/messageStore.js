'use strict'

/**
 * Message persistence — one JSON file per conversation, no database.
 *
 * In-memory layer is a rtcforge/core `MemoryStateStore` (convId → Message[]);
 * appends/mutations hit memory so concurrent operations never race on a
 * read-modify-write. Dirty conversations are flushed on a debounce driven by the
 * rtcforge/core `Clock`, atomically (temp → fsync → rename), and capped at
 * `maxStoredMessagesPerConversation`. Only the disk snapshot is local.
 */

const path = require('node:path')
const fsp = require('node:fs/promises')

const config = require('../config')
const logger = require('../logger')
const { MemoryStateStore, clock } = require('../rtc')
const { readJson, writeJsonAtomic, WriteQueue } = require('./atomicJson')

class MessageStore {
    constructor() {
        this._messages = new MemoryStateStore() // convId -> Message[]
        this._dirty = new Set()
        this._queue = new WriteQueue()
        this._timer = null
        this._closed = false
    }

    async init() {
        await fsp.mkdir(config.messagesDir, { recursive: true })
        this._scheduleFlush()
        logger.info('Message store ready')
    }

    _scheduleFlush() {
        this._timer = clock.setTimeout(() => {
            this._flushDirty().finally(() => {
                if (!this._closed) this._scheduleFlush()
            })
        }, config.flushIntervalMs)
        this._timer.unref?.()
    }

    _file(convId) {
        return path.join(config.messagesDir, `${convId}.json`)
    }

    async _load(convId) {
        const cached = await this._messages.get(convId)
        if (cached) return cached
        const loaded = (await readJson(this._file(convId), [])) || []
        const existing = await this._messages.get(convId)
        if (existing) return existing // race guard
        const messages = Array.isArray(loaded) ? loaded : []
        await this._messages.set(convId, messages)
        return messages
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

    async _flushDirty() {
        if (this._dirty.size === 0) return
        const convs = [...this._dirty]
        this._dirty.clear()
        await Promise.all(convs.map((convId) => this._write(convId)))
    }

    _write(convId) {
        return this._queue.run(convId, async () => {
            const messages = await this._messages.get(convId)
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
        if (this._timer) clock.clearTimeout(this._timer)
        await this._flushDirty()
        await this._queue.idle()
        logger.info('Message store flushed and closed')
    }

    /**
     * Best-effort flush for hard-exit paths. rtcforge/core's `StateStore` is
     * async-only, so this fires async writes it cannot await before exit — the
     * real durability guarantees are the debounced flush and graceful `close()`.
     */
    flushSyncBestEffort() {
        for (const convId of this._dirty) {
            void this._write(convId).catch(() => undefined)
        }
    }
}

module.exports = { MessageStore }
