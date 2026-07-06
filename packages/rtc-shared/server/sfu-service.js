'use strict'

/**
 * Server-side SFU media, powered by `rtcforge/media` (mediasoup under the hood).
 *
 * A `MediaService` owns a pool of mediasoup workers. Each signaling room gets
 * ONE `MediaRouter` (`ensureRoom`): a producer PRODUCES tracks into the router
 * and every other member CONSUMES them — genuine one-to-many selective
 * forwarding (upload once, fan out to N). All transport/produce/consume calls
 * go through the router; the wire protocol that drives them lives in
 * ./sfu-signaling.js.
 *
 * Fully parameterized (logger + worker/listen options injected) so any app —
 * live streaming, meet, massive — reuses it without a config dependency.
 */

const { MediaService } = require('rtcforge/media')
const { MemoryLock } = require('./core')

/**
 * @param {object} opts
 * @param {import('rtcforge/core').Logger} opts.logger
 * @param {string} [opts.listenIp='127.0.0.1']  mediasoup transport bind IP
 * @param {string} [opts.announcedIp]            public IP announced in ICE (prod)
 * @param {number} [opts.numWorkers]             worker count (default ≈ CPU count)
 * @param {number} [opts.rtcMinPort=40000]
 * @param {number} [opts.rtcMaxPort=49999]
 */
class SfuService {
    constructor(opts = {}) {
        const listenIp = opts.listenIp || '127.0.0.1'
        this._logger = opts.logger
        this._listenIp = listenIp
        this._announcedIp = opts.announcedIp
        this._rtcMinPort = opts.rtcMinPort ?? 40000
        this._rtcMaxPort = opts.rtcMaxPort ?? 49999

        const mk = (protocol) => {
            const info = { protocol, ip: listenIp }
            if (opts.announcedIp) info.announcedIp = opts.announcedIp
            return info
        }
        this._svc = new MediaService({
            logger: opts.logger,
            worker: {
                numWorkers: opts.numWorkers || undefined,
                rtcMinPort: this._rtcMinPort,
                rtcMaxPort: this._rtcMaxPort,
            },
            webRtcTransport: { listenInfos: [mk('udp'), mk('tcp')] },
        })
        // Genuine rtcforge/core `Lock` use: serialize concurrent joins to the same
        // room so exactly one MediaRouter is attached, never a duplicate.
        this._lock = new MemoryLock()
        this._started = false
    }

    /** Underlying rtcforge/media MediaService (used by the SFU cluster bridge). */
    get service() {
        return this._svc
    }

    async init() {
        if (this._started) return
        await this._svc.init()
        this._started = true
        this._logger?.info('SFU media service started', {
            listenIp: this._listenIp,
            announcedIp: this._announcedIp || '(none)',
            rtcPorts: `${this._rtcMinPort}-${this._rtcMaxPort}`,
        })
    }

    getRouter(roomId) {
        return this._svc.getRouter(roomId)
    }

    /**
     * Idempotent, race-safe attach of a MediaRouter to a signaling Room.
     * @param {import('rtcforge/media').RoomLike} room
     * @returns {Promise<import('rtcforge/media').MediaRouter>}
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

    /**
     * MemoryLock is a non-blocking, TTL-bounded mutex: the lock auto-expires
     * after the TTL even if the holder hasn't released, so the TTL must exceed
     * the worst-case task — here a mediasoup router attach. 60s sits comfortably
     * above a cold-worker attach. Spin briefly until acquired.
     */
    async _acquire(key) {
        for (let i = 0; i < 200; i++) {
            const token = await this._lock.acquire(key, 60000)
            if (token) return token
            await new Promise((resolve) => setTimeout(resolve, 15))
        }
        this._logger?.warn('SFU room lock contended; proceeding without lock', { key })
        return null
    }

    async close() {
        if (!this._started) return
        this._started = false
        await this._svc
            .closeAll()
            .catch((err) => this._logger?.error('SFU closeAll failed', { err: err.message }))
    }
}

module.exports = { SfuService }
