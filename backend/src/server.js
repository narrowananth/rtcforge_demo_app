'use strict'

/**
 * Application wiring:
 *   Express REST API  +  rtcforge-signaling (inbox rooms)  +  file-based stores
 *
 * Each user connects one signaling client to `inbox:<userId>`; the RealtimeHub
 * pushes message/conversation/presence events to those inbox peers. HTTP handles
 * all commands. Everything persists to JSON files under DATA_DIR.
 */

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const express = require('express')
const { SignalingServer } = require('rtcforge-signaling')

const config = require('./config')
const logger = require('./logger')
const { signalingAuth } = require('./auth/token')
const { errorHandler } = require('./http/middleware')
const { createApiRouter } = require('./http/routes')
const { createServices } = require('./services')
const { RealtimeHub } = require('./realtime/hub')

const { UserStore } = require('./store/userStore')
const { ConversationStore } = require('./store/conversationStore')
const { MessageStore } = require('./store/messageStore')
const { MediaStore } = require('./store/mediaStore')

function createApp() {
    // --- Stores --------------------------------------------------------------
    const stores = {
        userStore: new UserStore(),
        conversationStore: new ConversationStore(),
        messageStore: new MessageStore(),
        mediaStore: new MediaStore(),
    }

    // --- HTTP + signaling on one server -------------------------------------
    const app = express()
    app.disable('x-powered-by')

    // Dev CORS — the Vite dev server (frontend) runs on a different origin and
    // proxies HTTP, but allow cross-origin directly too for convenience.
    if (!config.isProd) {
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
            res.setHeader('Access-Control-Allow-Credentials', 'true')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
            if (req.method === 'OPTIONS') return res.status(204).end()
            next()
        })
    }

    app.use(express.json({ limit: '256kb' }))

    const httpServer = http.createServer(app)
    const signaling = new SignalingServer({
        server: httpServer,
        auth: async (token) => signalingAuth(token),
        maxPeersPerRoom: 8, // inbox rooms hold one user; call rooms hold a small mesh
        pingInterval: config.pingInterval,
        pongTimeout: config.pongTimeout,
        rateLimit: { maxMessagesPerSecond: config.maxMessagesPerSecond },
        // Deliver ICE (STUN + optional TURN) to peers that need media/data transport.
        // Inbox rooms never carry media, so they get none.
        iceServersHook: (_peerId, roomId) => {
            if (roomId.startsWith('call:') || roomId.startsWith('p2p:')) {
                return [{ urls: config.stunUrls }, ...(config.turn ? [config.turn] : [])]
            }
            return null
        },
        logger,
    })
    signaling.on('error', (err) => logger.error('Signaling error', { err: err.message }))

    const hub = new RealtimeHub(signaling)
    hub.bind()

    const services = createServices({ ...stores, hub })

    // Presence: notify a user's contacts + conversation peers when they connect
    // or disconnect.
    hub.onPresence(async (userId, online) => {
        const user = await stores.userStore.getById(userId)
        if (!user) return
        const audience = new Set(user.contacts)
        const convs = await Promise.all(
            user.conversations.map((id) => stores.conversationStore.get(id)),
        )
        for (const conv of convs) {
            if (conv) for (const m of conv.members) audience.add(m)
        }
        audience.delete(userId)
        hub.pushToUsers([...audience], { type: 'presence', userId, online, ts: Date.now() })
    })

    // --- Routes --------------------------------------------------------------
    app.get('/healthz', (_req, res) => res.json({ status: 'ok', ...signaling.getStats() }))

    app.get('/media/:id', (req, res) => {
        const filePath = stores.mediaStore.pathFor(req.params.id)
        if (!filePath) return res.status(400).end()
        stores.mediaStore
            .metadata(req.params.id)
            .then((meta) => {
                res.sendFile(filePath, {
                    headers: {
                        'Content-Type': meta?.mime || 'application/octet-stream',
                        'Cache-Control': 'private, max-age=31536000, immutable',
                    },
                })
            })
            .catch(() => res.status(404).end())
    })

    app.use('/api', createApiRouter({ services, stores, hub }))

    // Serve index.html with cache-busted asset URLs. The bundle/css change on
    // every build; stamping `?v=<mtime>` forces the browser to fetch the fresh
    // files instead of running a stale UI (the recurring "old UI" problem).
    // Serve the built Vite frontend (frontend/dist). In dev the frontend runs on
    // the Vite server; in prod Express serves the static build with an SPA
    // fallback. Vite already fingerprints asset filenames, so long-cache assets
    // and no-cache the HTML shell.
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
    app.get(/^(?!\/api|\/media|\/healthz).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache')
        fs.access(indexHtml, (err) => {
            if (err)
                return res
                    .status(200)
                    .type('html')
                    .send(
                        '<h1>ForgeChat</h1><p>Frontend not built. Run <code>pnpm build</code>.</p>',
                    )
            res.sendFile(indexHtml)
        })
    })
    app.use(errorHandler)

    async function start() {
        await Promise.all([
            stores.userStore.init(),
            stores.conversationStore.init(),
            stores.messageStore.init(),
            stores.mediaStore.init(),
        ])
        await signaling.start()
        await new Promise((resolve, reject) => {
            httpServer.once('error', reject)
            httpServer.listen(config.port, config.host, () => {
                httpServer.off('error', reject)
                resolve()
            })
        })
        logger.info('Server listening', {
            url: `http://${config.host}:${config.port}`,
            env: config.nodeEnv,
        })
    }

    async function stop() {
        logger.info('Shutting down…')
        await signaling
            .stop()
            .catch((err) => logger.error('signaling.stop failed', { err: err.message }))
        await new Promise((resolve) => httpServer.close(() => resolve()))
        await Promise.all([
            stores.messageStore.close(),
            stores.userStore.close(),
            stores.conversationStore.close(),
        ]).catch((err) => logger.error('store close failed', { err: err.message }))
    }

    function flushSyncBestEffort() {
        stores.messageStore.flushSyncBestEffort()
    }

    return { app, httpServer, signaling, hub, services, stores, start, stop, flushSyncBestEffort }
}

module.exports = { createApp }
