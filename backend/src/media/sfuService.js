'use strict'

/**
 * Server-side SFU media, powered by `rtcforge-media` (mediasoup under the hood).
 *
 * A `MediaService` owns a pool of mediasoup workers. Each call/broadcast
 * signaling room gets ONE `MediaRouter` (`ensureRoom`): a broadcaster/caller
 * PRODUCES tracks into the router and every other member CONSUMES them. That is
 * genuine one-to-many selective forwarding — a broadcaster uploads its stream
 * once and the SFU fans it out to N viewers, instead of the old N-way P2P mesh.
 *
 * All transport/produce/consume calls go through the router; the wire protocol
 * that drives them lives in ./sfuSignaling.js.
 */

const { MediaService } = require('rtcforge-media')
const config = require('../config')
const logger = require('../logger')
const { MemoryLock } = require('../rtc')

function listenInfos() {
    const mk = (protocol) => {
        const info = { protocol, ip: config.sfu.listenIp }
        if (config.sfu.announcedIp) info.announcedIp = config.sfu.announcedIp
        return info
    }
    return [mk('udp'), mk('tcp')]
}

class SfuService {
    /**
     * @param {{ rtcMinPort?: number, rtcMaxPort?: number }} [opts] port overrides
     * so several SFU nodes can coexist in one process (cluster tests).
     */
    constructor(opts = {}) {
        this._svc = new MediaService({
            logger,
            worker: {
                numWorkers: config.sfu.numWorkers,
                rtcMinPort: opts.rtcMinPort ?? config.sfu.rtcMinPort,
                rtcMaxPort: opts.rtcMaxPort ?? config.sfu.rtcMaxPort,
            },
            webRtcTransport: { listenInfos: listenInfos() },
        })
        // Genuine rtcforge-core `Lock` use: serialize concurrent joins to the same
        // room so exactly one MediaRouter is attached, never a duplicate.
        this._lock = new MemoryLock()
        this._started = false
    }

    /** Underlying rtcforge-media MediaService (used by the SFU cluster bridge). */
    get service() {
        return this._svc
    }

    async init() {
        if (this._started) return
        await this._svc.init()
        this._started = true
        logger.info('SFU media service started', {
            listenIp: config.sfu.listenIp,
            announcedIp: config.sfu.announcedIp || '(none)',
            rtcPorts: `${config.sfu.rtcMinPort}-${config.sfu.rtcMaxPort}`,
        })
    }

    getRouter(roomId) {
        return this._svc.getRouter(roomId)
    }

    /**
     * Idempotent, race-safe attach of a MediaRouter to a signaling Room.
     * @param {import('rtcforge-media').RoomLike} room
     * @returns {Promise<import('rtcforge-media').MediaRouter>}
     */
    async ensureRoom(room) {
        const existing = this._svc.getRouter(room.id)
        if (existing) return existing
        const key = `sfu:${room.id}`
        const token = await this._acquire(key)
        try {
            return this._svc.getRouter(room.id) || (await this._svc.attachRoom(room))
        } finally {
            if (token) await this._lock.release(key, token)
        }
    }

    /** MemoryLock is a non-blocking mutex; spin briefly until acquired. */
    async _acquire(key) {
        for (let i = 0; i < 200; i++) {
            const token = await this._lock.acquire(key, 5000)
            if (token) return token
            await new Promise((resolve) => setTimeout(resolve, 15))
        }
        logger.warn('SFU room lock contended; proceeding without lock', { key })
        return null
    }

    async close() {
        if (!this._started) return
        this._started = false
        await this._svc
            .closeAll()
            .catch((err) => logger.error('SFU closeAll failed', { err: err.message }))
    }
}

module.exports = { SfuService }
