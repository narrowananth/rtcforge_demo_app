'use strict'

/**
 * Massive / multi-region streaming backend:
 *   Express REST (stream directory + tokens + cluster status)
 *   + rtcforge SignalingServer
 *   + a MULTI-NODE rtcforge SFU cluster with cascade fan-out.
 *
 * N co-located SFU nodes (each an SfuService with its own RTC port slice) form a
 * real cascade fabric: SfuMesh (pipe transports) + SfuCluster + CascadeTree +
 * CascadeBridge. A stream's broadcaster is placed on an origin node (HashRing);
 * as viewers exceed a node's capacity the tree grows edges and the bridge pipes
 * the stream across them. GossipMembership over UdpGossipTransport is wired for
 * the multi-PROCESS discovery/placement axis (CLUSTER_UDP_PORT). All of it is
 * rtcforge via @forgechat/rtc-shared/server; this file owns app orchestration.
 */

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

const express = require('express')
const {
    core,
    createLogger,
    Metrics,
    createSignaling,
    SfuService,
    SfuMesh,
    SfuTopology,
    createCluster,
} = require('@forgechat/rtc-shared/server')

const config = require('./config')
const { issueStreamToken, signalingAuth } = require('./auth')
const { StreamRegistry } = require('./streams')
const { createClusterSfuSignaling } = require('./cluster-signaling')

const isSfuRoom = (roomId) => roomId.startsWith(config.streamPrefix)
const streamIdFromRoom = (roomId) =>
    roomId.startsWith(config.streamPrefix) ? roomId.slice(config.streamPrefix.length) : null

/** Split the RTC port range into `count` non-overlapping node slices. */
function portSlices(min, max, count) {
    const size = Math.floor((max - min + 1) / count)
    return Array.from({ length: count }, (_, i) => ({
        rtcMinPort: min + i * size,
        rtcMaxPort: i === count - 1 ? max : min + (i + 1) * size - 1,
    }))
}

function createApp() {
    const logger = createLogger({ isProd: config.isProd })
    const metrics = new Metrics()
    const streams = new StreamRegistry()

    // --- Build the co-located SFU cluster -----------------------------------
    const slices = portSlices(
        config.sfu.rtcMinPort,
        config.sfu.rtcMaxPort,
        config.cluster.nodeCount,
    )
    const nodes = slices.map((slice, i) => ({
        id: `node-${i}`,
        region: config.cluster.region,
        sfu: new SfuService({
            logger,
            numWorkers: config.sfu.numWorkers,
            listenIp: config.sfu.listenIp,
            announcedIp: config.sfu.announcedIp,
            ...slice,
        }),
    }))

    const mesh = new SfuMesh({ logger })
    for (const n of nodes) mesh.register(n.id, n.sfu)

    // Membership: single-process → memory; CLUSTER_UDP_PORT → gossip cluster.
    const cluster = createCluster({
        selfId: `${config.cluster.region}-${config.port}`,
        region: config.cluster.region,
        udpPort: config.cluster.udpPort,
        advertiseHost: config.cluster.advertiseHost,
        seeds: config.cluster.seeds,
        secret: config.cluster.secret,
        logger,
    })

    const topology = new SfuTopology({
        self: cluster.self,
        mesh,
        logger,
        capacity: config.sfu.viewersPerNode,
        fanout: config.sfu.cascadeFanout,
    })
    // Register every co-located node in the ring (single-process multi-node).
    for (const n of nodes) topology.addNode(n.id, n.region)

    // Consistent-hash origin placement over node ids (rtcforge/core HashRing).
    const ring = new core.HashRing()
    for (const n of nodes) ring.add({ id: n.id })

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
        maxPeersPerRoom: config.sfu.viewersPerNode * config.cluster.nodeCount + 8,
        maxMessagesPerSecond: config.maxMessagesPerSecond,
        allowedOrigins: config.allowedOrigins,
        cluster: { selfId: cluster.self.id, membership: cluster.membership },
        iceServersHook: (_peerId, roomId) =>
            isSfuRoom(roomId) ? [{ urls: config.stunUrls }] : null,
    })

    const clusterSignaling = createClusterSfuSignaling({
        signaling,
        nodes,
        mesh,
        topology,
        ring,
        capacity: config.sfu.viewersPerNode,
        logger,
        isSfuRoom,
        streamIdFromRoom,
    })
    clusterSignaling.bind()

    // Stream directory live/viewer bookkeeping from room membership.
    signaling.on('roomCreated', (room) => {
        const streamId = streamIdFromRoom(room.id)
        if (!streamId) return
        const refresh = () => {
            const peers = room.getPeers()
            streams.setLive(
                streamId,
                peers.some((p) => p.role === 'broadcaster'),
            )
            streams.setViewers(streamId, peers.filter((p) => p.role !== 'broadcaster').length)
        }
        refresh()
        room.on('peerJoined', refresh)
        room.on('peerLeft', refresh)
        room.once('closed', () => streams.remove(streamId))
    })

    // --- REST ---------------------------------------------------------------
    app.get('/healthz', (_req, res) =>
        res.json({ status: 'ok', ...signaling.getStats(), metrics: metrics.snapshot() }),
    )

    // The ops dashboard's data source: cluster topology + per-node load + cascade.
    app.get('/api/cluster', (_req, res) =>
        res.json({
            region: config.cluster.region,
            mode: cluster.mode,
            capacityPerNode: config.sfu.viewersPerNode,
            cascadeFanout: config.sfu.cascadeFanout,
            ...clusterSignaling.status(),
        }),
    )

    app.get('/api/streams', (_req, res) => res.json({ streams: streams.list() }))

    app.post('/api/streams', (req, res) => {
        const broadcasterId = `bc_${Math.random().toString(36).slice(2, 10)}`
        const rec = streams.create({
            title: req.body?.title,
            broadcasterId,
            broadcasterName: req.body?.name,
        })
        const token = issueStreamToken({
            userId: broadcasterId,
            name: rec.broadcasterName,
            streamId: rec.id,
            role: 'broadcaster',
        })
        res.json({ stream: { id: rec.id, title: rec.title }, token, role: 'broadcaster' })
    })

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
                    .send('<h1>Massive</h1><p>Frontend not built. Run <code>pnpm build</code>.</p>')
            res.sendFile(indexHtml)
        })
    })

    async function start() {
        for (const n of nodes) await n.sfu.init()
        await cluster.start()
        await signaling.start()
        await new Promise((resolve, reject) => {
            httpServer.once('error', reject)
            httpServer.listen(config.port, config.host, () => {
                httpServer.off('error', reject)
                resolve()
            })
        })
        logger.info('Massive streaming server listening', {
            url: `http://${config.host}:${config.port}`,
            nodes: nodes.length,
            capacityPerNode: config.sfu.viewersPerNode,
        })
    }

    async function stop() {
        await signaling.stop().catch((err) => logger.error('signaling.stop', { err: err.message }))
        topology.dispose()
        await cluster.stop().catch(() => undefined)
        for (const n of nodes) await n.sfu.close().catch(() => undefined)
        await new Promise((resolve) => httpServer.close(() => resolve()))
    }

    return {
        app,
        httpServer,
        signaling,
        nodes,
        mesh,
        topology,
        clusterSignaling,
        streams,
        logger,
        start,
        stop,
    }
}

module.exports = { createApp }
