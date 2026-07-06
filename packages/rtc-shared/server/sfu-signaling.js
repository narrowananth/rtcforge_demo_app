'use strict'

/**
 * SFU control-plane wiring. The SFU handshake itself is rtcforge's own protocol,
 * driven server-side by rtcforge/media `SfuSignalHandler` (caps → create/connect
 * transport → produce/consume → resume). rtcforge ships the handler and the
 * `sfu-*` message shapes; what it does NOT ship — and this file provides — is:
 *   - the transport binding (rtcforge has no browser SFU client, so we carry the
 *     messages over the signaling `signal` channel to a reserved peer id), and
 *   - app orchestration around the handshake: producer announcement to other
 *     peers, late-join producer discovery, and a pluggable publish policy.
 *
 * Transport: the client sends `signal` to the sentinel peer id `'sfu'`; the
 * signaling server emits a `PeerEvent.Signal` we intercept here. Replies and
 * notifications go back as `signal` with `from: 'sfu'`.
 *
 * Request  (client → server): { id, ...SfuRequest } | { id, action:'list-producers' }
 * Response (server → client): { id, ok: true, result } | { id, ok: false, error }
 *   where `result` for a core request is rtcforge's `SfuResponse`.
 * Notify   (server → client): { event, ... }   (no id) — new-producer/producer-closed
 *
 * Parameterized so any app supplies its own room predicate + publish policy:
 *   - `isSfuRoom(roomId)`     → which rooms carry SFU media
 *   - `publishPolicy(ctx)`    → `null` to allow producing, or an error string to
 *                               reject (e.g. broadcast rooms: broadcaster-only)
 *   - `onProducerChange(ctx)` → optional hook fired when a room's producer set or
 *                               audience changes (used by the cascade cluster to
 *                               re-plan fan-out; a no-op for single-node apps).
 */

const { MediaRouterEvent, SfuMessageType, SfuSignalHandler } = require('rtcforge/media')

const SFU_PEER = 'sfu'

/**
 * @param {object} deps
 * @param {import('rtcforge/server').SignalingServer} deps.signaling
 * @param {import('./sfu-service').SfuService} deps.sfu
 * @param {import('rtcforge/core').Logger} deps.logger
 * @param {(roomId: string) => boolean} deps.isSfuRoom
 * @param {(ctx: { room: any, peer: any, msg: any }) => (string|null)} [deps.publishPolicy]
 * @param {(ctx: { room: any, producerCount: number, audience: number }) => void} [deps.onProducerChange]
 */
function createSfuSignaling({
    signaling,
    sfu,
    logger,
    isSfuRoom,
    publishPolicy = () => null,
    onProducerChange,
}) {
    // roomId -> Map<producerId, { peerId, kind }>  (mirror of live producers)
    const producersByRoom = new Map()
    // roomId -> rtcforge SfuSignalHandler (drives the caps→…→resume handshake)
    const handlers = new Map()
    const wiredPeers = new WeakSet()
    const attachedRooms = new WeakSet()

    /** rtcforge's SfuSignalHandler for a room, created on demand and cached. */
    async function ensureHandler(room) {
        let handler = handlers.get(room.id)
        if (!handler) {
            const router = await sfu.ensureRoom(room)
            handler = handlers.get(room.id) || new SfuSignalHandler(router)
            handlers.set(room.id, handler)
        }
        return handler
    }

    function sendTo(peer, data) {
        try {
            peer.send({ type: 'signal', from: SFU_PEER, data })
        } catch (err) {
            logger?.warn('SFU send failed', { peerId: peer.id, err: err.message })
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

    function fireProducerChange(room) {
        if (!onProducerChange) return
        onProducerChange({
            room,
            producerCount: producerRegistry(room.id).size,
            audience: Math.max(0, room.getPeerCount() - 1),
        })
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
            fireProducerChange(room)
        })
        router.on(MediaRouterEvent.ProducerClosed, (producer) => {
            registry.delete(producer.id)
            notifyRoomExcept(room, producer.peerId, {
                event: 'producer-closed',
                producerId: producer.id,
                peerId: producer.peerId,
            })
            fireProducerChange(room)
        })

        room.on('peerLeft', (peer) => router.closeTransportsForPeer(peer.id))
        // Re-fire on audience change (not only ProducerAdded) so a viewer that
        // joins AFTER publishing began is still accounted for by the fan-out
        // planner. `getPeerCount() - 1` excludes the producer/broadcaster.
        room.on('peerJoined', () => fireProducerChange(room))
        room.on('peerLeft', () => fireProducerChange(room))
        room.once('closed', () => {
            producersByRoom.delete(room.id)
            handlers.delete(room.id)
        })
    }

    function attachPeer(room, peer) {
        if (wiredPeers.has(peer) || !isSfuRoom(room.id)) return
        wiredPeers.add(peer)
        peer.on('signal', (to, data) => {
            if (to !== SFU_PEER) return // ordinary peer-to-peer signal — not for us
            handleRpc(room, peer, data).catch((err) => {
                logger?.warn('SFU rpc error', {
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
        const reply = (result) => msg.id && sendTo(peer, { id: msg.id, ok: true, result })
        const fail = (error) => msg.id && sendTo(peer, { id: msg.id, ok: false, error })

        // App-specific: late-join producer discovery. rtcforge's SFU protocol has
        // no equivalent — the app owns producer announcement/discovery (the
        // `new-producer`/`producer-closed` pushes above), so this stays app glue.
        if (msg.action === 'list-producers') {
            const registry = producerRegistry(room.id)
            const producers = []
            for (const [producerId, info] of registry) {
                if (info.peerId !== peer.id) {
                    producers.push({ producerId, peerId: info.peerId, kind: info.kind })
                }
            }
            return reply({ producers })
        }

        // Everything else is rtcforge's own SFU control protocol
        // (caps → create/connect transport → produce/consume → resume). Delegate
        // to rtcforge's SfuSignalHandler instead of hand-rolling the dispatch;
        // it enforces transport ownership and validates ingress.
        if (typeof msg.type === 'string' && msg.type.startsWith('sfu-')) {
            // App policy rtcforge doesn't own: who is allowed to publish.
            if (msg.type === SfuMessageType.Produce) {
                const denial = publishPolicy({ room, peer, msg })
                if (denial) return fail(denial)
            }
            const handler = await ensureHandler(room)
            const response = await handler.handle(peer.id, msg)
            return response.type === 'sfu-error' ? fail(response.message) : reply(response)
        }

        fail(`Unknown SFU message: ${msg.type || msg.action}`)
    }

    function bind() {
        signaling.on('roomCreated', (room) => {
            if (!isSfuRoom(room.id)) return
            attachRoom(room).catch((err) =>
                logger?.error('SFU room attach failed', { roomId: room.id, err: err.message }),
            )
            room.on('peerJoined', (peer) => attachPeer(room, peer))
            for (const peer of room.getPeers()) attachPeer(room, peer)
        })
    }

    /** Producer ids currently live in a room (mirror kept by ProducerAdded/Closed). */
    function roomProducerIds(roomId) {
        const reg = producersByRoom.get(roomId)
        return reg ? [...reg.keys()] : []
    }

    return { bind, roomProducerIds }
}

module.exports = { createSfuSignaling, SFU_PEER }
