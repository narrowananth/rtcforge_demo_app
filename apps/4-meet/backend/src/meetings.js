'use strict'

/** In-memory directory of meetings (a meeting is live while anyone is in it). */

const { core } = require('@forgechat/rtc-shared/server')

const TYPES = new Set(['call', 'room', 'webinar'])

class MeetingRegistry {
    constructor() {
        /** @type {Map<string, {id,title,type,hostId,hostName,createdAt,members}>} */
        this._byId = new Map()
    }

    create({ title, type, hostId, hostName }) {
        const t = TYPES.has(type) ? type : 'room'
        const id = core.newId('mt_')
        const rec = {
            id,
            title: String(title || 'Untitled meeting').slice(0, 120),
            type: t,
            hostId,
            hostName: hostName || 'host',
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
            .map((r) => ({
                id: r.id,
                title: r.title,
                type: r.type,
                hostName: r.hostName,
                members: r.members,
                createdAt: r.createdAt,
            }))
    }
}

module.exports = { MeetingRegistry, TYPES }
