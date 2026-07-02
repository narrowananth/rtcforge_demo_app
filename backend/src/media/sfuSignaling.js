'use strict'

/**
 * SFU control-plane protocol — the thin request/response glue between the
 * browser's `mediasoup-client` and this server's `rtcforge-media` `MediaRouter`.
 * rtcforge ships the SFU (server) and the signaling relay but not this protocol,
 * so we ride it over the signaling `signal` channel using a reserved peer id.
 *
 * Transport: the client sends `signal` to the sentinel peer id `'sfu'`; the
 * signaling server tries (and fails, harmlessly) to relay it to a peer named
 * 'sfu' AND emits a `PeerEvent.Signal` we intercept here. Replies and
 * notifications go back as `signal` with `from: 'sfu'`.
 *
 * Request  (client → server): { id, action, ...args }
 * Response (server → client): { id, ok: true, result } | { id, ok: false, error }
 * Notify   (server → client): { event, ... }   (no id)
 *
 * Actions map 1:1 onto MediaRouter methods:
 *   get-rtp-capabilities → router.rtpCapabilities
 *   create-transport     → router.createWebRtcTransport(peerId)
 *   connect-transport    → router.connectTransport(transportId, dtlsParameters)
 *   produce              → router.produce(peerId, transportId, kind, rtpParameters)
 *   consume              → router.consume(peerId, transportId, producerId, rtpCapabilities)
 *   resume-consumer      → router.resumeConsumer(consumerId)
 *   list-producers       → existing producers from OTHER peers (for late joiners)
 */

const { MediaRouterEvent } = require('rtcforge-media')
const logger = require('../logger')

const SFU_PEER = 'sfu'
const CALL_PREFIX = 'call:'
const BROADCAST_PREFIX = 'bcast:'

function isSfuRoom(roomId) {
    return roomId.startsWith(CALL_PREFIX) || roomId.startsWith(BROADCAST_PREFIX)
}

function createSfuSignaling({ signaling, sfu, topology }) {
    // roomId -> Map<producerId, { peerId, kind }>  (mirror of live producers)
    const producersByRoom = new Map()
    const wiredPeers = new WeakSet()
    const attachedRooms = new WeakSet()

    function sendTo(peer, data) {
        try {
            peer.send({ type: 'signal', from: SFU_PEER, data })
        } catch (err) {
            logger.warn('SFU send failed', { peerId: peer.id, err: err.message })
        }
    }

    function notifyRoomExcept(room, exceptPeerId, data) {
        for (const peer of room.getPeers()) {
            if (peer.id !== exceptPeerId) sendTo(peer, data)
        }
    }

    function producerRegistry(roomId) {
        let reg = producersByRoom.get(roomId)
        if (!reg) {
            reg = new Map()
            producersByRoom.set(roomId, reg)
        }
        return reg
    }

    async function attachRoom(room) {
        if (attachedRooms.has(room) || !isSfuRoom(room.id)) return
        attachedRooms.add(room)
        const router = await sfu.ensureRoom(room)
        const registry = producerRegistry(room.id)

        router.on(MediaRouterEvent.ProducerAdded, (producer) => {
            registry.set(producer.id, { peerId: producer.peerId, kind: producer.kind })
            notifyRoomExcept(room, producer.peerId, {
                event: 'new-producer',
                producerId: producer.id,
                peerId: producer.peerId,
                kind: producer.kind,
            })
            if (room.id.startsWith(BROADCAST_PREFIX)) {
                topology.planBroadcast(room.id, Math.max(0, room.getPeerCount() - 1))
            }
        })
        router.on(MediaRouterEvent.ProducerClosed, (producer) => {
            registry.delete(producer.id)
            notifyRoomExcept(room, producer.peerId, {
                event: 'producer-closed',
                producerId: producer.id,
                peerId: producer.peerId,
            })
        })

        room.on('peerLeft', (peer) => router.closeTransportsForPeer(peer.id))
        // Re-plan the broadcast fanout whenever the audience changes — not only on
        // ProducerAdded. Otherwise a viewer that joins AFTER the broadcaster began
        // publishing never causes an edge to be planned for its node, so the
        // cascade never reaches it. `getPeerCount() - 1` excludes the broadcaster.
        if (room.id.startsWith(BROADCAST_PREFIX)) {
            const replan = () =>
                topology.planBroadcast(room.id, Math.max(0, room.getPeerCount() - 1))
            room.on('peerJoined', replan)
            room.on('peerLeft', replan)
        }
        room.once('closed', () => {
            producersByRoom.delete(room.id)
            topology.detach(room.id)
        })
    }

    function attachPeer(room, peer) {
        if (wiredPeers.has(peer) || !isSfuRoom(room.id)) return
        wiredPeers.add(peer)
        peer.on('signal', (to, data) => {
            if (to !== SFU_PEER) return // ordinary peer-to-peer signal — not for us
            handleRpc(room, peer, data).catch((err) => {
                logger.warn('SFU rpc error', {
                    roomId: room.id,
                    peerId: peer.id,
                    action: data?.action,
                    err: err.message,
                })
                if (data?.id) sendTo(peer, { id: data.id, ok: false, error: err.message })
            })
        })
    }

    async function handleRpc(room, peer, msg) {
        if (!msg || typeof msg !== 'object') return
        const router = await sfu.ensureRoom(room)
        let result
        switch (msg.action) {
            case 'get-rtp-capabilities':
                result = { routerRtpCapabilities: router.rtpCapabilities }
                break
            case 'create-transport':
                result = { transport: await router.createWebRtcTransport(peer.id) }
                break
            case 'connect-transport':
                await router.connectTransport(msg.transportId, msg.dtlsParameters)
                result = { connected: true }
                break
            case 'produce': {
                // In a broadcast room only the broadcaster may publish; everyone
                // else is a viewer. Calls let every participant publish.
                if (room.id.startsWith(BROADCAST_PREFIX) && peer.role !== 'broadcaster') {
                    throw new Error('Only the broadcaster may publish to this room')
                }
                const producer = await router.produce(
                    peer.id,
                    msg.transportId,
                    msg.kind,
                    msg.rtpParameters,
                )
                result = { producerId: producer.id }
                break
            }
            case 'consume': {
                const consumer = await router.consume(
                    peer.id,
                    msg.transportId,
                    msg.producerId,
                    msg.rtpCapabilities,
                )
                result = {
                    id: consumer.id,
                    producerId: consumer.producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                }
                break
            }
            case 'resume-consumer':
                await router.resumeConsumer(msg.consumerId)
                result = { resumed: true }
                break
            case 'list-producers': {
                const registry = producerRegistry(room.id)
                const producers = []
                for (const [producerId, info] of registry) {
                    if (info.peerId !== peer.id) {
                        producers.push({ producerId, peerId: info.peerId, kind: info.kind })
                    }
                }
                result = { producers }
                break
            }
            default:
                throw new Error(`Unknown SFU action: ${msg.action}`)
        }
        if (msg.id) sendTo(peer, { id: msg.id, ok: true, result })
    }

    function bind() {
        signaling.on('roomCreated', (room) => {
            if (!isSfuRoom(room.id)) return
            attachRoom(room).catch((err) =>
                logger.error('SFU room attach failed', { roomId: room.id, err: err.message }),
            )
            room.on('peerJoined', (peer) => attachPeer(room, peer))
            for (const peer of room.getPeers()) attachPeer(room, peer)
        })
    }

    /**
     * Producer ids currently live in a room, from the mirror kept up to date by
     * the router's ProducerAdded/Closed events. Consumed by `SfuMesh` to backfill
     * a freshly established cascade edge with producers that predate it.
     */
    function roomProducerIds(roomId) {
        const reg = producersByRoom.get(roomId)
        return reg ? [...reg.keys()] : []
    }

    return { bind, roomProducerIds }
}

module.exports = { createSfuSignaling, isSfuRoom, SFU_PEER, BROADCAST_PREFIX, CALL_PREFIX }
