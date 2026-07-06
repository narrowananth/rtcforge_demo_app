'use strict'

/**
 * Live-streaming backend wiring:
 *   Express REST (stream directory + token minting)
 *   + rtcforge SignalingServer (auth · rooms · relay)
 *   + rtcforge SFU (MediaService) for one-broadcaster → many-viewer fan-out.
 *
 * A stream lives in the signaling room `stream:<id>`. The broadcaster PRODUCES
 * its camera/screen; every viewer CONSUMES. The SFU publish policy lets only the
 * broadcaster role publish — viewers are view-only. All of that is rtcforge via
 * @forgechat/rtc-shared/server; this file only owns the app orchestration
 * (stream directory, live/viewer bookkeeping, token endpoints).
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
const { issueStreamToken, signalingAuth } = require('./auth')
const { StreamRegistry } = require('./streams')

function streamIdFromRoom(roomId) {
    return roomId.startsWith(config.streamPrefix) ? roomId.slice(config.streamPrefix.length) : null
}

function createApp() {
    const logger = createLogger({ isProd: config.isProd })
    const metrics = new Metrics()
    const streams = new StreamRegistry()

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

    // --- Signaling + SFU (all rtcforge, via rtc-shared) ---------------------
    const isSfuRoom = (roomId) => roomId.startsWith(config.streamPrefix)
    const signaling = createSignaling({
        server: httpServer,
        auth: async (token) => signalingAuth(token),
        logger,
        metrics,
        maxPeersPerRoom: config.maxViewersPerStream + 4,
        maxMessagesPerSecond: config.maxMessagesPerSecond,
        allowedOrigins: config.allowedOrigins,
        iceServersHook: (_peerId, roomId) =>
            isSfuRoom(roomId)
                ? [{ urls: config.stunUrls }, ...(config.turn ? [config.turn] : [])]
                : null,
    })

    const sfu = new SfuService({ logger, ...config.sfu })
    const sfuSignaling = createSfuSignaling({
        signaling,
        sfu,
        logger,
        isSfuRoom,
        // App policy rtcforge doesn't own: only the broadcaster may publish.
        publishPolicy: ({ peer }) =>
            peer.role === 'broadcaster' ? null : 'Only the broadcaster may publish to this stream',
    })
    sfuSignaling.bind()

    // --- Stream lifecycle: derive live/viewer state from room membership ----
    signaling.on('roomCreated', (room) => {
        const streamId = streamIdFromRoom(room.id)
        if (!streamId) return

        const refresh = () => {
            const peers = room.getPeers()
            const hasBroadcaster = peers.some((p) => p.role === 'broadcaster')
            streams.setLive(streamId, hasBroadcaster)
            streams.setViewers(streamId, peers.filter((p) => p.role !== 'broadcaster').length)
        }
        refresh()
        room.on('peerJoined', refresh)
        room.on('peerLeft', (peer) => {
            refresh()
            // Broadcaster left → the stream is over; drop it from the directory
            // once the room empties so stale entries don't linger.
            if (peer.role === 'broadcaster') streams.setLive(streamId, false)
        })
        room.once('closed', () => streams.remove(streamId))
    })

    // --- REST: directory + token minting ------------------------------------
    app.get('/healthz', (_req, res) =>
        res.json({ status: 'ok', ...signaling.getStats(), metrics: metrics.snapshot() }),
    )

    app.get('/api/streams', (_req, res) => res.json({ streams: streams.list() }))

    // Start broadcasting: register a stream and mint a broadcaster token.
    app.post('/api/streams', (req, res) => {
        const { title, name } = req.body || {}
        const broadcasterId = `bc_${Math.random().toString(36).slice(2, 10)}`
        const rec = streams.create({ title, broadcasterId, broadcasterName: name })
        const token = issueStreamToken({
            userId: broadcasterId,
            name: rec.broadcasterName,
            streamId: rec.id,
            role: 'broadcaster',
        })
        res.json({ stream: { id: rec.id, title: rec.title }, token, role: 'broadcaster' })
    })

    // Watch: mint a viewer token for an existing stream.
    app.post('/api/streams/:id/watch', (req, res) => {
        const rec = streams.get(req.params.id)
        if (!rec) return res.status(404).json({ error: 'No such stream' })
        const viewerId = `v_${Math.random().toString(36).slice(2, 10)}`
        const token = issueStreamToken({
            userId: viewerId,
            name: req.body?.name || 'viewer',
            streamId: rec.id,
            role: 'viewer',
        })
        res.json({ stream: { id: rec.id, title: rec.title }, token, role: 'viewer' })
    })

    // --- Static frontend (built Vite app) -----------------------------------
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
                    .send(
                        '<h1>Live Streaming</h1><p>Frontend not built. Run <code>pnpm build</code>.</p>',
                    )
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
        logger.info('Live-streaming server listening', {
            url: `http://${config.host}:${config.port}`,
            env: config.nodeEnv,
        })
    }

    async function stop() {
        await signaling.stop().catch((err) => logger.error('signaling.stop', { err: err.message }))
        await sfu.close().catch((err) => logger.error('sfu.close', { err: err.message }))
        await new Promise((resolve) => httpServer.close(() => resolve()))
    }

    return { app, httpServer, signaling, sfu, streams, logger, start, stop }
}

module.exports = { createApp }
