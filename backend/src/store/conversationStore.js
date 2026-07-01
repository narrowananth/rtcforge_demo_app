'use strict'

/**
 * Conversations — one JSON file per conversation.
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
const { readJson, writeJsonAtomic, WriteQueue } = require('./atomicJson')

function dmId(a, b) {
    const [x, y] = [a, b].sort()
    return `dm_${crypto.createHash('sha256').update(`${x}|${y}`).digest('hex').slice(0, 24)}`
}

class ConversationStore {
    constructor() {
        this._cache = new Map()
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
        if (this._cache.has(id)) return this._cache.get(id)
        const conv = await readJson(this._file(id), null)
        if (conv) this._cache.set(id, conv)
        return conv
    }

    async put(conv) {
        this._cache.set(conv.id, conv)
        await this._queue.run(conv.id, () => writeJsonAtomic(this._file(conv.id), conv))
        return conv
    }

    async update(id, mutator) {
        return this._queue.run(id, async () => {
            const current = await this.get(id)
            if (!current) throw new Error('Conversation not found')
            const draft = structuredClone(current)
            const result = mutator(draft) || draft
            result.updatedAt = Date.now()
            this._cache.set(id, result)
            await writeJsonAtomic(this._file(id), result)
            return result
        })
    }

    async close() {
        await this._queue.idle()
    }
}

module.exports = { ConversationStore, dmId }
