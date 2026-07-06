'use strict'

/**
 * In-memory directory of streams. Ephemeral by design — a live stream exists
 * only while its broadcaster is connected. Persistence (VOD, history) would slot
 * in behind this same interface without touching the signaling/SFU layer.
 */

const { core } = require('@forgechat/rtc-shared/server')

class StreamRegistry {
    constructor() {
        /** @type {Map<string, {id,title,broadcasterId,broadcasterName,startedAt,live,viewers}>} */
        this._byId = new Map()
    }

    /** Register a not-yet-live stream and return its record. */
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
        return rec
    }

    setViewers(id, viewers) {
        const rec = this._byId.get(id)
        if (rec) rec.viewers = Math.max(0, viewers)
    }

    remove(id) {
        this._byId.delete(id)
    }

    /** Public directory view — live streams first, newest first. */
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
