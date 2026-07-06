'use strict'

/**
 * Conversations — one JSON file per conversation.
 *
 * In-memory layer is a rtcforge/core `MemoryStateStore` (id → conversation);
 * writes are write-through JSON snapshots serialized per id via the WriteQueue
 * (rtcforge/core `Lock`). Only the disk snapshot is local.
 *
 * Conversation shape:
 *   { id, type: 'dm'|'group'|'broadcast', title, avatarColor,
 *     members: string[], admins: string[], createdBy, createdAt, updatedAt }
 *
 * For DMs the id is derived deterministically from the two member ids so the
 * same pair always resolves to the same conversation.
 */

const path = require('node:path')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')

const config = require('../config')
const logger = require('../logger')
const { MemoryStateStore, clock } = require('../rtc')
const { readJson, writeJsonAtomic, WriteQueue } = require('./atomicJson')

function dmId(a, b) {
    const [x, y] = [a, b].sort()
    return `dm_${crypto.createHash('sha256').update(`${x}|${y}`).digest('hex').slice(0, 24)}`
}

class ConversationStore {
    constructor() {
        this._convs = new MemoryStateStore()
        this._queue = new WriteQueue()
    }

    async init() {
        await fsp.mkdir(config.conversationsDir, { recursive: true })
        logger.info('Conversation store ready')
    }

    _file(id) {
        return path.join(config.conversationsDir, `${id}.json`)
    }

    async get(id) {
        if (!id) return null
        const cached = await this._convs.get(id)
        if (cached) return cached
        const conv = await readJson(this._file(id), null)
        if (conv) await this._convs.set(id, conv)
        return conv
    }

    async put(conv) {
        await this._convs.set(conv.id, conv)
        await this._queue.run(conv.id, () => writeJsonAtomic(this._file(conv.id), conv))
        return conv
    }

    async update(id, mutator) {
        return this._queue.run(id, async () => {
            const current = await this.get(id)
            if (!current) throw new Error('Conversation not found')
            const draft = structuredClone(current)
            const result = mutator(draft) || draft
            result.updatedAt = clock.now()
            await this._convs.set(id, result)
            await writeJsonAtomic(this._file(id), result)
            return result
        })
    }

    async close() {
        await this._queue.idle()
    }
}

module.exports = { ConversationStore, dmId }
