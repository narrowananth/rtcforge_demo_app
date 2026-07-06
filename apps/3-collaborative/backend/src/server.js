'use strict'

/**
 * Collaborative backend wiring:
 *   Express REST (board directory + token minting)
 *   + rtcforge SignalingServer (auth · rooms · relay) — and nothing else.
 *
 * There is NO media plane and NO SFU here. A board lives in the signaling room
 * `board:<id>`; peers exchange strokes, cursors, and doc edits directly over the
 * room's broadcast + directed-signal channels (see the frontend). The server is
 * a fast, authenticated, room-scoped message bus — exactly what rtcforge's
 * SignalingServer is. This file only owns the lobby (directory + tokens).
 */

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const express = require('express')
const { createLogger, Metrics, createSignaling } = require('@forgechat/rtc-shared/server')

const config = require('./config')
const { issueBoardToken, signalingAuth } = require('./auth')
const { BoardRegistry } = require('./boards')

// Distinct, readable cursor/pen colours handed out round-robin per member.
const PALETTE = [
    '#7c5cff',
    '#ff3b5c',
    '#26d17c',
    '#ffb020',
    '#28c0e6',
    '#e668d0',
    '#8b5cf6',
    '#f97316',
]
let colorSeq = 0
const nextColor = () => PALETTE[colorSeq++ % PALETTE.length]

function boardIdFromRoom(roomId) {
    return roomId.startsWith(config.boardPrefix) ? roomId.slice(config.boardPrefix.length) : null
}

function createApp() {
    const logger = createLogger({ isProd: config.isProd })
    const metrics = new Metrics()
    const boards = new BoardRegistry()

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
        maxPeersPerRoom: config.maxMembersPerBoard + 4,
        maxMessagesPerSecond: config.maxMessagesPerSecond,
        allowedOrigins: config.allowedOrigins,
    })

    // Keep the lobby's member counts in step with room membership.
    signaling.on('roomCreated', (room) => {
        const boardId = boardIdFromRoom(room.id)
        if (!boardId) return
        const refresh = () => boards.setMembers(boardId, room.getPeerCount())
        refresh()
        room.on('peerJoined', refresh)
        room.on('peerLeft', refresh)
        room.once('closed', () => boards.remove(boardId))
    })

    // --- REST: directory + token minting ------------------------------------
    app.get('/healthz', (_req, res) =>
        res.json({ status: 'ok', ...signaling.getStats(), metrics: metrics.snapshot() }),
    )

    app.get('/api/boards', (_req, res) => res.json({ boards: boards.list() }))

    const memberJoin = (rec, name) => {
        const userId = `m_${Math.random().toString(36).slice(2, 10)}`
        const safeName = String(name || 'anon').slice(0, 48)
        const color = nextColor()
        const token = issueBoardToken({ userId, name: safeName, color, boardId: rec.id })
        return {
            board: { id: rec.id, title: rec.title },
            token,
            self: { id: userId, name: safeName, color },
        }
    }

    app.post('/api/boards', (req, res) => {
        const rec = boards.create({ title: req.body?.title })
        res.json(memberJoin(rec, req.body?.name))
    })

    app.post('/api/boards/:id/join', (req, res) => {
        const rec = boards.get(req.params.id)
        if (!rec) return res.status(404).json({ error: 'No such board' })
        res.json(memberJoin(rec, req.body?.name))
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
                    .send(
                        '<h1>Collaborative</h1><p>Frontend not built. Run <code>pnpm build</code>.</p>',
                    )
            res.sendFile(indexHtml)
        })
    })

    async function start() {
        await signaling.start()
        await new Promise((resolve, reject) => {
            httpServer.once('error', reject)
            httpServer.listen(config.port, config.host, () => {
                httpServer.off('error', reject)
                resolve()
            })
        })
        logger.info('Collaborative server listening', {
            url: `http://${config.host}:${config.port}`,
            env: config.nodeEnv,
        })
    }

    async function stop() {
        await signaling.stop().catch((err) => logger.error('signaling.stop', { err: err.message }))
        await new Promise((resolve) => httpServer.close(() => resolve()))
    }

    return { app, httpServer, signaling, boards, logger, start, stop }
}

module.exports = { createApp }
