'use strict'

/**
 * User accounts — one JSON file per user, plus a username→id index file.
 *
 * The in-memory layer is a rtcforge-core `MemoryStateStore` (users keyed by id,
 * plus a second store for the usernameLower→id index); durability is a
 * write-through JSON snapshot per user, serialized per file via the WriteQueue
 * (rtcforge-core `Lock`). The only local part is the disk snapshot itself —
 * rtcforge has no storage layer.
 *
 * User shape:
 *   { id, username, usernameLower, displayName, passwordHash,
 *     contacts: string[], conversations: string[], createdAt }
 */

const path = require('node:path')
const fsp = require('node:fs/promises')

const config = require('../config')
const logger = require('../logger')
const { MemoryStateStore } = require('../rtc')
const { readJson, writeJsonAtomic, WriteQueue } = require('./atomicJson')

class UserStore {
    constructor() {
        this._users = new MemoryStateStore() // userId -> user
        this._index = new MemoryStateStore() // usernameLower -> userId
        this._queue = new WriteQueue()
    }

    async init() {
        await fsp.mkdir(config.usersDir, { recursive: true })
        const index = (await readJson(config.usernameIndexFile, {})) || {}
        for (const [usernameLower, id] of Object.entries(index)) {
            await this._index.set(usernameLower, id)
        }
        logger.info('User store ready', { users: Object.keys(index).length })
    }

    _file(userId) {
        return path.join(config.usersDir, `${userId}.json`)
    }

    async usernameTaken(username) {
        return this._index.has(username.toLowerCase())
    }

    async getById(userId) {
        if (!userId) return null
        const cached = await this._users.get(userId)
        if (cached) return cached
        const user = await readJson(this._file(userId), null)
        if (user) await this._users.set(userId, user)
        return user
    }

    async getByUsername(username) {
        const id = await this._index.get(String(username).toLowerCase())
        return id ? this.getById(id) : null
    }

    async create(user) {
        await this._users.set(user.id, user)
        await this._index.set(user.usernameLower, user.id)
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
            await this._users.set(userId, result)
            await writeJsonAtomic(this._file(userId), result)
            return result
        })
    }

    async _persistIndex() {
        const snapshot = {}
        for (const key of await this._index.keys()) {
            snapshot[key] = await this._index.get(key)
        }
        await this._queue.run('__index__', () =>
            writeJsonAtomic(config.usernameIndexFile, snapshot),
        )
    }

    async close() {
        await this._queue.idle()
    }
}

module.exports = { UserStore }
