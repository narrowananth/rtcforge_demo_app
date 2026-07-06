'use strict'

/**
 * Cluster-aware SFU control plane — app 5's orchestration over rtcforge's SFU
 * primitives. Where app 2 has ONE SFU node, here there are N co-located nodes,
 * and this routes each peer to a node and cascades the stream across nodes as the
 * audience grows:
 *
 *   - The broadcaster is placed on the stream's ORIGIN node (consistent hash over
 *     node ids via rtcforge/core `HashRing`) and produces there.
 *   - Viewers are packed capacity-first onto the nodes the `CascadeTree` serves
 *     (origin, then edges). Crossing a node's capacity makes the tree grow an
 *     edge; `CascadeBridge` → `SfuMesh` pipes the origin's producer onto that
 *     edge's router, so the viewers routed there can consume it.
 *   - Each node's router announces its producers (incl. piped ones) to the
 *     viewers assigned to THAT node — so origin- and edge-node viewers both get
 *     `new-producer` naturally.
 *
 * Every SFU message is delegated to the peer's node's rtcforge `SfuSignalHandler`
 * (per app 2). The browser client is unchanged — it still talks to the reserved
 * `sfu` peer id and never knows which node served it.
 */

const { MediaRouterEvent, SfuMessageType, SfuSignalHandler } = require('rtcforge/media')

const SFU_PEER = 'sfu'

function createClusterSfuSignaling({
    signaling,
    nodes,
    mesh,
    topology,
    ring,
    capacity,
    logger,
    isSfuRoom,
    streamIdFromRoom,
}) {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const handlers = new Map() // `${nodeId}|${roomId}` -> SfuSignalHandler
    const producers = new Map() // `${nodeId}|${roomId}` -> Map<producerId,{peerId,kind}>
    const wiredNodeRooms = new Set() // `${nodeId}|${roomId}`
    const assignment = new Map() // peerId -> { nodeId }
    const roomOrigin = new Map() // roomId -> originNodeId
    const roomViewerSeq = new Map() // roomId -> next viewer index
    const wiredPeers = new WeakSet()

    function nkey(nodeId, roomId) {
        return `${nodeId}|${roomId}`
    }

    function registry(nodeId, roomId) {
        const k = nkey(nodeId, roomId)
        let r = producers.get(k)
        if (!r) {
            r = new Map()
            producers.set(k, r)
        }
        return r
    }

    /** Producer ids live on the ORIGIN node of a room (fed to the mesh so a new
     * cascade edge backfills producers that predate the pipe). */
    function originProducerIds(roomId) {
        const origin = roomOrigin.get(roomId)
        if (!origin) return []
        return [...registry(origin, roomId).keys()]
    }

    function sendTo(peer, data) {
        try {
            peer.send({ type: 'signal', from: SFU_PEER, data })
        } catch (err) {
            logger?.warn('SFU send failed', { peerId: peer.id, err: err.message })
        }
    }

    /** Notify the viewers assigned to `nodeId` in `room` (except one peer). */
    function notifyNodeViewers(nodeId, room, data, exceptPeerId) {
        for (const peer of room.getPeers()) {
            if (peer.id === exceptPeerId) continue
            if (assignment.get(peer.id)?.nodeId === nodeId) sendTo(peer, data)
        }
    }

    async function ensureNodeRoom(nodeId, room) {
        const k = nkey(nodeId, room.id)
        if (wiredNodeRooms.has(k)) return nodeById.get(nodeId)
        wiredNodeRooms.add(k)
        const node = nodeById.get(nodeId)
        const router = await node.sfu.ensureRoom(room)
        const reg = registry(nodeId, room.id)
        router.on(MediaRouterEvent.ProducerAdded, (producer) => {
            reg.set(producer.id, { peerId: producer.peerId, kind: producer.kind })
            notifyNodeViewers(
                nodeId,
                room,
                {
                    event: 'new-producer',
                    producerId: producer.id,
                    peerId: producer.peerId,
                    kind: producer.kind,
                },
                producer.peerId,
            )
        })
        router.on(MediaRouterEvent.ProducerClosed, (producer) => {
            reg.delete(producer.id)
            notifyNodeViewers(
                nodeId,
                room,
                { event: 'producer-closed', producerId: producer.id, peerId: producer.peerId },
                producer.peerId,
            )
        })
        return node
    }

    async function ensureHandler(nodeId, room) {
        const k = nkey(nodeId, room.id)
        let handler = handlers.get(k)
        if (!handler) {
            const node = await ensureNodeRoom(nodeId, room)
            handler = handlers.get(k) || new SfuSignalHandler(node.sfu.getRouter(room.id))
            handlers.set(k, handler)
        }
        return handler
    }

    /** The ordered nodes the cascade tree serves this room (origin first). */
    function servingNodes(origin, plan) {
        const ordered = [origin]
        if (plan) {
            for (const link of plan.links) if (!ordered.includes(link.to)) ordered.push(link.to)
        }
        return ordered
    }

    async function assignPeer(room, peer) {
        if (assignment.has(peer.id)) return assignment.get(peer.id)
        const streamId = streamIdFromRoom(room.id)
        let origin = roomOrigin.get(room.id)
        if (!origin) {
            origin = ring.get(streamId) || nodes[0].id
            roomOrigin.set(room.id, origin)
        }

        let nodeId
        if (peer.role === 'broadcaster') {
            nodeId = origin
        } else {
            const seq = roomViewerSeq.get(room.id) || 0
            roomViewerSeq.set(room.id, seq + 1)
            // Growing the tree to `seq+1` viewers makes the bridge pipe the stream
            // onto any new edge node before we route this viewer there.
            const plan = topology.planBroadcast(room.id, origin, seq + 1)
            const serving = servingNodes(origin, plan)
            nodeId = serving[Math.min(serving.length - 1, Math.floor(seq / capacity))]
        }

        const assigned = { nodeId }
        assignment.set(peer.id, assigned)
        await ensureNodeRoom(nodeId, room)
        logger?.info('peer placed on node', {
            peerId: peer.id,
            role: peer.role,
            nodeId,
            roomId: room.id,
        })
        return assigned
    }

    async function handleRpc(room, peer, msg) {
        if (!msg || typeof msg !== 'object') return
        const reply = (result) => msg.id && sendTo(peer, { id: msg.id, ok: true, result })
        const fail = (error) => msg.id && sendTo(peer, { id: msg.id, ok: false, error })

        const { nodeId } = await assignPeer(room, peer)

        if (msg.action === 'list-producers') {
            const reg = registry(nodeId, room.id)
            const list = []
            for (const [producerId, info] of reg) {
                if (info.peerId !== peer.id)
                    list.push({ producerId, peerId: info.peerId, kind: info.kind })
            }
            return reply({ producers: list })
        }

        if (typeof msg.type === 'string' && msg.type.startsWith('sfu-')) {
            if (msg.type === SfuMessageType.Produce && peer.role !== 'broadcaster') {
                return fail('Only the broadcaster may publish to this stream')
            }
            const handler = await ensureHandler(nodeId, room)
            const response = await handler.handle(peer.id, msg)
            return response.type === 'sfu-error' ? fail(response.message) : reply(response)
        }

        fail(`Unknown SFU message: ${msg.type || msg.action}`)
    }

    function attachPeer(room, peer) {
        if (wiredPeers.has(peer) || !isSfuRoom(room.id)) return
        wiredPeers.add(peer)
        peer.on('signal', (to, data) => {
            if (to !== SFU_PEER) return
            handleRpc(room, peer, data).catch((err) => {
                logger?.warn('cluster SFU rpc error', {
                    roomId: room.id,
                    peerId: peer.id,
                    err: err.message,
                })
                if (data?.id) sendTo(peer, { id: data.id, ok: false, error: err.message })
            })
        })
    }

    function bind() {
        mesh.setProducerSource((roomId) => originProducerIds(roomId))
        signaling.on('roomCreated', (room) => {
            if (!isSfuRoom(room.id)) return
            room.on('peerJoined', (peer) => attachPeer(room, peer))
            for (const peer of room.getPeers()) attachPeer(room, peer)
            room.on('peerLeft', (peer) => assignment.delete(peer.id))
            room.once('closed', () => {
                roomOrigin.delete(room.id)
                roomViewerSeq.delete(room.id)
                topology.detach(room.id)
            })
        })
    }

    /** Cluster status snapshot for the ops dashboard. */
    function status() {
        const perNode = new Map()
        for (const n of nodes) perNode.set(n.id, { id: n.id, viewers: 0, producers: 0 })
        for (const { nodeId } of assignment.values()) {
            const s = perNode.get(nodeId)
            if (s) s.viewers += 1
        }
        for (const [k, reg] of producers) {
            const nodeId = k.split('|')[0]
            const s = perNode.get(nodeId)
            if (s) s.producers += reg.size
        }
        return {
            nodes: nodes.map((n) => ({
                ...perNode.get(n.id),
                region: n.region,
                capacity,
            })),
            origins: [...roomOrigin.entries()].map(([roomId, origin]) => ({ roomId, origin })),
            links: mesh.links(),
        }
    }

    return { bind, status }
}

module.exports = { createClusterSfuSignaling }
