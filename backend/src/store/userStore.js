'use strict'

/**
 * User accounts — one JSON file per user, plus a username→id index file.
 *
 * User shape:
 *   { id, username, usernameLower, displayName, passwordHash,
 *     contacts: string[], conversations: string[], createdAt }
 *
 * Writes are write-through (accounts are low-volume and want durability) and
 * serialized per file via a WriteQueue.
 */

const path = require('node:path')
const fsp = require('node:fs/promises')

const config = require('../config')
const logger = require('../logger')
const { readJson, writeJsonAtomic, WriteQueue } = require('./atomicJson')

class UserStore {
    constructor() {
        this._cache = new Map() // userId -> user
        this._index = null // usernameLower -> userId
        this._queue = new WriteQueue()
    }

    async init() {
        await fsp.mkdir(config.usersDir, { recursive: true })
        this._index = (await readJson(config.usernameIndexFile, {})) || {}
        logger.info('User store ready', { users: Object.keys(this._index).length })
    }

    _file(userId) {
        return path.join(config.usersDir, `${userId}.json`)
    }

    usernameTaken(username) {
        return Object.hasOwn(this._index, username.toLowerCase())
    }

    async getById(userId) {
        if (!userId) return null
        if (this._cache.has(userId)) return this._cache.get(userId)
        const user = await readJson(this._file(userId), null)
        if (user) this._cache.set(userId, user)
        return user
    }

    async getByUsername(username) {
        const id = this._index[String(username).toLowerCase()]
        return id ? this.getById(id) : null
    }

    async create(user) {
        this._cache.set(user.id, user)
        this._index[user.usernameLower] = user.id
        await this._queue.run(user.id, () => writeJsonAtomic(this._file(user.id), user))
        await this._persistIndex()
        return user
    }

    /**
     * Atomically mutate a user via `mutator(userCopy)` (returns the mutated copy
     * or void). Serialized per user id.
     * @returns updated user
     */
    async update(userId, mutator) {
        return this._queue.run(userId, async () => {
            const current = await this.getById(userId)
            if (!current) throw new Error('User not found')
            const draft = structuredClone(current)
            const result = mutator(draft) || draft
            this._cache.set(userId, result)
            await writeJsonAtomic(this._file(userId), result)
            return result
        })
    }

    async _persistIndex() {
        await this._queue.run('__index__', () =>
            writeJsonAtomic(config.usernameIndexFile, this._index),
        )
    }

    async close() {
        await this._queue.idle()
    }
}

module.exports = { UserStore }
