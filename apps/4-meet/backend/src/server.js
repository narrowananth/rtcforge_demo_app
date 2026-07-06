'use strict'

/**
 * Meet backend wiring:
 *   Express REST (meeting directory + tokens + host kick)
 *   + rtcforge SignalingServer (auth · rooms · relay)
 *   + rtcforge SFU (MediaService) — attached ONLY to room:/webinar: rooms.
 *
 * Three meeting types, two media planes (both rtcforge):
 *   - call:<id>    → P2P MESH. The client drives rtcforge `Call`; the server
 *                    only relays SDP/ICE (no SFU). Best for 2–4 peers.
 *   - room:<id>    → SFU. Everyone produces + consumes (5–50).
 *   - webinar:<id> → SFU, but the publish policy lets only host/panelist produce;
 *                    everyone else is a view-only audience.
 * Host controls (kick) use rtcforge's `Room.kickPeer`.
 */

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const express = require('express')
const {
    createLogger,
    Metrics,
    createSignaling,
    SfuService,
    createSfuSignaling,
} = require('@forgechat/rtc-shared/server')

const config = require('./config')
const { issueMeetingToken, signalingAuth, tokens } = require('./auth')
const { MeetingRegistry } = require('./meetings')

const isSfuRoom = (roomId) =>
    roomId.startsWith(config.types.room) || roomId.startsWith(config.types.webinar)

function meetingIdFromRoom(roomId) {
    for (const prefix of Object.values(config.types)) {
        if (roomId.startsWith(prefix)) return roomId.slice(prefix.length)
    }
    return null
}

function createApp() {
    const logger = createLogger({ isProd: config.isProd })
    const metrics = new Metrics()
    const meetings = new MeetingRegistry()

    const app = express()
    app.disable('x-powered-by')
    if (!config.isProd) {
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            if (req.method === 'OPTIONS') return res.status(204).end()
            next()
        })
    }
    app.use(express.json({ limit: '64kb' }))

    const httpServer = http.createServer(app)

    const signaling = createSignaling({
        server: httpServer,
        auth: async (token) => signalingAuth(token),
        logger,
        metrics,
        maxPeersPerRoom: config.maxParticipants + 4,
        maxMessagesPerSecond: config.maxMessagesPerSecond,
        allowedOrigins: config.allowedOrigins,
        // Mesh calls need STUN/TURN for the P2P peer connections; SFU rooms use
        // mediasoup's own candidates but a fallback here is harmless.
        iceServersHook: () => [{ urls: config.stunUrls }, ...(config.turn ? [config.turn] : [])],
    })

    // SFU only for room:/webinar:. Mesh call: rooms just relay peer signals.
    const sfu = new SfuService({ logger, ...config.sfu })
    const sfuSignaling = createSfuSignaling({
        signaling,
        sfu,
        logger,
        isSfuRoom,
        publishPolicy: ({ room, peer }) => {
            if (room.id.startsWith(config.types.webinar)) {
                return peer.role === 'host' || peer.role === 'panelist'
                    ? null
                    : 'Only the host may present in a webinar'
            }
            return null // room: — everyone may publish
        },
    })
    sfuSignaling.bind()

    // Keep meeting member counts in step with room membership.
    signaling.on('roomCreated', (room) => {
        const meetingId = meetingIdFromRoom(room.id)
        if (!meetingId) return
        const refresh = () => meetings.setMembers(meetingId, room.getPeerCount())
        refresh()
        room.on('peerJoined', refresh)
        room.on('peerLeft', refresh)
        room.once('closed', () => meetings.remove(meetingId))
    })

    // --- REST ---------------------------------------------------------------
    app.get('/healthz', (_req, res) =>
        res.json({ status: 'ok', ...signaling.getStats(), metrics: metrics.snapshot() }),
    )

    app.get('/api/meetings', (_req, res) => res.json({ meetings: meetings.list() }))

    const tokenFor = (rec, userId, name, role) => ({
        meeting: { id: rec.id, title: rec.title, type: rec.type },
        token: issueMeetingToken({ userId, name, type: rec.type, meetingId: rec.id, role }),
        self: { id: userId, name, role },
    })

    // Create → the creator is the host.
    app.post('/api/meetings', (req, res) => {
        const { title, type, name } = req.body || {}
        const hostId = `h_${Math.random().toString(36).slice(2, 10)}`
        const safeName = String(name || 'host').slice(0, 48)
        const rec = meetings.create({ title, type, hostId, hostName: safeName })
        res.json(tokenFor(rec, hostId, safeName, 'host'))
    })

    // Join → participant in a call/room, audience in a webinar.
    app.post('/api/meetings/:id/join', (req, res) => {
        const rec = meetings.get(req.params.id)
        if (!rec) return res.status(404).json({ error: 'No such meeting' })
        const userId = `p_${Math.random().toString(36).slice(2, 10)}`
        const safeName = String(req.body?.name || 'guest').slice(0, 48)
        const role = rec.type === 'webinar' ? 'audience' : 'participant'
        res.json(tokenFor(rec, userId, safeName, role))
    })

    // Host control: kick a peer (rtcforge Room.kickPeer). The caller proves it is
    // the host by presenting a token with role 'host' bound to this meeting room.
    app.post('/api/meetings/:id/kick', (req, res) => {
        const rec = meetings.get(req.params.id)
        if (!rec) return res.status(404).json({ error: 'No such meeting' })
        let claims
        try {
            claims = tokens.verify(req.body?.token)
        } catch {
            return res.status(401).json({ error: 'Bad token' })
        }
        const roomId = config.types[rec.type] + rec.id
        if (claims.role !== 'host' || claims.room !== roomId) {
            return res.status(403).json({ error: 'Host only' })
        }
        const room = signaling.getRoom(roomId)
        if (!room) return res.status(404).json({ error: 'Meeting not live' })
        room.kickPeer(String(req.body?.peerId || ''), 'Removed by host')
        res.json({ ok: true })
    })

    // --- Static frontend ----------------------------------------------------
    const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist')
    const indexHtml = path.join(distDir, 'index.html')
    app.use(
        express.static(distDir, {
            index: false,
            setHeaders: (res, filePath) => {
                if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
                else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            },
        }),
    )
    app.get(/^(?!\/api|\/healthz).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache')
        fs.access(indexHtml, (err) => {
            if (err)
                return res
                    .status(200)
                    .type('html')
                    .send('<h1>Meet</h1><p>Frontend not built. Run <code>pnpm build</code>.</p>')
            res.sendFile(indexHtml)
        })
    })

    async function start() {
        await sfu.init()
        await signaling.start()
        await new Promise((resolve, reject) => {
            httpServer.once('error', reject)
            httpServer.listen(config.port, config.host, () => {
                httpServer.off('error', reject)
                resolve()
            })
        })
        logger.info('Meet server listening', {
            url: `http://${config.host}:${config.port}`,
            env: config.nodeEnv,
        })
    }

    async function stop() {
        await signaling.stop().catch((err) => logger.error('signaling.stop', { err: err.message }))
        await sfu.close().catch((err) => logger.error('sfu.close', { err: err.message }))
        await new Promise((resolve) => httpServer.close(() => resolve()))
    }

    return { app, httpServer, signaling, sfu, meetings, logger, start, stop }
}

module.exports = { createApp }
