'use strict'

/**
 * In-memory directory of collaborative boards. The board CONTENT (strokes, doc)
 * lives only in the peers' browsers and syncs peer-to-peer over the room — the
 * server never sees it. This registry is just the lobby: which boards exist and
 * how many people are in each.
 */

const { core } = require('@forgechat/rtc-shared/server')

class BoardRegistry {
    constructor() {
        /** @type {Map<string, {id,title,createdAt,members}>} */
        this._byId = new Map()
    }

    create({ title }) {
        const id = core.newId('b_')
        const rec = {
            id,
            title: String(title || 'Untitled board').slice(0, 120),
            createdAt: core.clock.now(),
            members: 0,
        }
        this._byId.set(id, rec)
        return rec
    }

    get(id) {
        return this._byId.get(id)
    }

    setMembers(id, members) {
        const rec = this._byId.get(id)
        if (rec) rec.members = Math.max(0, members)
    }

    remove(id) {
        this._byId.delete(id)
    }

    list() {
        return [...this._byId.values()]
            .sort((a, b) => b.members - a.members || b.createdAt - a.createdAt)
            .map((r) => ({ id: r.id, title: r.title, members: r.members, createdAt: r.createdAt }))
    }
}

module.exports = { BoardRegistry }
