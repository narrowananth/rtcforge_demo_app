'use strict'

/** In-memory directory of live streams (ephemeral — live while the broadcaster is connected). */

const { core } = require('@forgechat/rtc-shared/server')

class StreamRegistry {
    constructor() {
        this._byId = new Map()
    }

    create({ title, broadcasterId, broadcasterName }) {
        const id = core.newId('s_')
        const rec = {
            id,
            title: String(title || 'Untitled stream').slice(0, 120),
            broadcasterId,
            broadcasterName: broadcasterName || 'anon',
            startedAt: core.clock.now(),
            live: false,
            viewers: 0,
        }
        this._byId.set(id, rec)
        return rec
    }

    get(id) {
        return this._byId.get(id)
    }
    setLive(id, live) {
        const rec = this._byId.get(id)
        if (rec) rec.live = live
    }
    setViewers(id, viewers) {
        const rec = this._byId.get(id)
        if (rec) rec.viewers = Math.max(0, viewers)
    }
    remove(id) {
        this._byId.delete(id)
    }

    list() {
        return [...this._byId.values()]
            .sort((a, b) => Number(b.live) - Number(a.live) || b.startedAt - a.startedAt)
            .map((r) => ({
                id: r.id,
                title: r.title,
                broadcasterName: r.broadcasterName,
                startedAt: r.startedAt,
                live: r.live,
                viewers: r.viewers,
            }))
    }
}

module.exports = { StreamRegistry }
