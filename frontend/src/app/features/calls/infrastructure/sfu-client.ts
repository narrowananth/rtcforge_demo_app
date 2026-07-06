import { Device, type types } from 'mediasoup-client'
import { MessageType, type Room } from 'rtcforge/client'
import { iceForRoom } from '../../realtime/infrastructure/webrtc'

/**
 * Browser SFU client — the mediasoup-client counterpart of the server's
 * `rtcforge/media` SfuSignalHandler. rtcforge ships no browser SFU client (only
 * the P2P mesh `Call`) — per its own guide the browser drives mediasoup-client
 * directly — so this speaks rtcforge's `sfu-*` control protocol (its
 * SfuSignalHandler shapes) over the rtcforge/client `Room` signal channel,
 * addressing the reserved server peer id `'sfu'` (see backend media/sfuSignaling.js).
 *
 * A publisher `publish()`es its local tracks (one → many). Every client
 * `consumeExisting()`s the producers already in the room and auto-consumes new
 * ones announced via `new-producer`. Remote tracks are grouped into one
 * MediaStream per peer and surfaced through `onRemoteStream`.
 */

const SFU_PEER = 'sfu'
const RPC_TIMEOUT_MS = 15000

// rtcforge's own SFU control protocol (rtcforge/media `SfuMessageType`). The
// server side is rtcforge's `SfuSignalHandler`; we speak its wire messages
// directly. Mirrored here because the constant is not exported in the browser
// build (rtcforge/media browser has no server SFU surface).
const SFU = {
    Caps: 'sfu-caps',
    CreateTransport: 'sfu-create-transport',
    ConnectTransport: 'sfu-connect-transport',
    Produce: 'sfu-produce',
    Consume: 'sfu-consume',
    ResumeConsumer: 'sfu-resume-consumer',
} as const

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }

export class SfuClient {
    private readonly room: Room
    private readonly device = new Device()
    private sendTransport?: types.Transport
    private recvTransport?: types.Transport
    private readonly producers = new Map<'audio' | 'video' | 'screen', types.Producer>()
    private readonly consumers = new Map<string, { consumer: types.Consumer; peerId: string }>()
    private readonly consumerByProducer = new Map<string, string>()
    private readonly consumedProducers = new Set<string>()
    private readonly streamByPeer = new Map<string, MediaStream>()
    private readonly pending = new Map<number, Pending>()
    private reqId = 0
    private closed = false

    onRemoteStream?: (peerId: string, stream: MediaStream) => void
    onRemoteStreamRemoved?: (peerId: string) => void

    constructor(room: Room) {
        this.room = room
        this.room.on(MessageType.Signal, this.onSignal)
    }

    // --- control-plane transport (signal ↔ 'sfu') --------------------------

    private onSignal = (from: string, data: unknown) => {
        if (from !== SFU_PEER || !data || typeof data !== 'object') return
        const msg = data as Record<string, unknown>
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)
            if (!p) return
            clearTimeout(p.timer)
            this.pending.delete(msg.id)
            if (msg.ok) p.resolve(msg.result)
            else p.reject(new Error(String(msg.error || 'SFU error')))
            return
        }
        if (msg.event === 'new-producer') {
            this.consume(String(msg.producerId), String(msg.peerId)).catch((err) =>
                console.warn('[sfu] consume(new-producer) failed', msg.producerId, err),
            )
        } else if (msg.event === 'producer-closed') {
            this.onProducerClosed(String(msg.producerId))
        }
    }

    // Send one rtcforge SFU request (or the app's `list-producers` extra) and
    // resolve with its response payload. An `id` correlates the reply, since the
    // signal channel is fire-and-forget.
    // biome-ignore lint/suspicious/noExplicitAny: control messages are dynamic JSON
    private rpc(payload: Record<string, unknown>): Promise<any> {
        const id = ++this.reqId
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`SFU ${payload.type ?? payload.action} timed out`))
            }, RPC_TIMEOUT_MS)
            this.pending.set(id, { resolve, reject, timer })
            this.room.sendSignal(SFU_PEER, { id, ...payload })
        })
    }

    async init(): Promise<void> {
        const res = await this.rpc({ type: SFU.Caps })
        await this.device.load({ routerRtpCapabilities: res.rtpCapabilities })
    }

    private async ensureSend(): Promise<types.Transport> {
        if (this.sendTransport) return this.sendTransport
        const res = await this.rpc({ type: SFU.CreateTransport, direction: 'send' })
        const t = this.device.createSendTransport({
            ...res.transport,
            iceServers: iceForRoom(this.room),
        })
        t.on('connect', ({ dtlsParameters }, callback, errback) => {
            this.rpc({ type: SFU.ConnectTransport, transportId: t.id, dtlsParameters })
                .then(() => callback())
                .catch(errback)
        })
        t.on('produce', ({ kind, rtpParameters }, callback, errback) => {
            this.rpc({ type: SFU.Produce, transportId: t.id, kind, rtpParameters })
                .then((r) => callback({ id: r.producerId }))
                .catch(errback)
        })
        // Surface uplink ICE/DTLS state — a stuck 'connecting' or 'failed' here means
        // the browser never delivers RTP to the SFU, so every remote sees us black.
        t.on('connectionstatechange', (state) => console.info('[sfu] send transport', state))
        this.sendTransport = t
        return t
    }

    private async ensureRecv(): Promise<types.Transport> {
        if (this.recvTransport) return this.recvTransport
        const res = await this.rpc({ type: SFU.CreateTransport, direction: 'recv' })
        const t = this.device.createRecvTransport({
            ...res.transport,
            iceServers: iceForRoom(this.room),
        })
        t.on('connect', ({ dtlsParameters }, callback, errback) => {
            this.rpc({ type: SFU.ConnectTransport, transportId: t.id, dtlsParameters })
                .then(() => callback())
                .catch(errback)
        })
        // Surface downlink ICE/DTLS state — if this never reaches 'connected' the
        // consumer is created but no frames arrive, so remote tiles stay black.
        t.on('connectionstatechange', (state) => console.info('[sfu] recv transport', state))
        this.recvTransport = t
        return t
    }

    // --- publishing --------------------------------------------------------

    async publish(stream: MediaStream): Promise<void> {
        const transport = await this.ensureSend()
        for (const track of stream.getTracks()) {
            const kind = track.kind as 'audio' | 'video'
            if (!this.device.canProduce(kind)) continue
            const producer = await transport.produce({ track })
            this.producers.set(kind, producer)
        }
    }

    /** Publish a screen-share video track as an additional producer. */
    async addScreenTrack(track: MediaStreamTrack): Promise<void> {
        const transport = await this.ensureSend()
        if (!this.device.canProduce('video')) return
        const producer = await transport.produce({ track })
        this.producers.set('screen', producer)
    }

    removeScreenTrack(): void {
        this.producers.get('screen')?.close()
        this.producers.delete('screen')
    }

    /**
     * Hot-swap the track behind an existing producer (mic/camera change) without
     * renegotiating — mediasoup keeps the same producer, viewers see no interruption.
     */
    async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack): Promise<void> {
        const producer = this.producers.get(kind)
        if (!producer) return
        await producer.replaceTrack({ track })
    }

    setAudioEnabled(on: boolean): void {
        const p = this.producers.get('audio')
        if (!p) return
        if (on) p.resume()
        else p.pause()
    }

    setVideoEnabled(on: boolean): void {
        const p = this.producers.get('video')
        if (!p) return
        if (on) p.resume()
        else p.pause()
    }

    // --- consuming ---------------------------------------------------------

    /** Consume every producer already in the room (late-join catch-up). */
    async consumeExisting(): Promise<void> {
        // `list-producers` is the app's own extra (rtcforge's protocol has no
        // producer discovery); the server answers with the mirror it keeps.
        const { producers } = await this.rpc({ action: 'list-producers' })
        for (const p of producers as Array<{ producerId: string; peerId: string }>) {
            await this.consume(p.producerId, p.peerId).catch((err) =>
                console.warn('[sfu] consume(existing) failed', p.producerId, err),
            )
        }
    }

    private async consume(producerId: string, peerId: string): Promise<void> {
        if (this.closed || this.consumedProducers.has(producerId)) return
        this.consumedProducers.add(producerId)
        try {
            const transport = await this.ensureRecv()
            const { consumer: params } = await this.rpc({
                type: SFU.Consume,
                transportId: transport.id,
                producerId,
                rtpCapabilities: this.device.rtpCapabilities,
            })
            const consumer = await transport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            })
            this.consumers.set(consumer.id, { consumer, peerId })
            this.consumerByProducer.set(producerId, consumer.id)
            await this.rpc({ type: SFU.ResumeConsumer, consumerId: consumer.id })

            let stream = this.streamByPeer.get(peerId)
            if (!stream) {
                stream = new MediaStream()
                this.streamByPeer.set(peerId, stream)
            }
            stream.addTrack(consumer.track)
            this.onRemoteStream?.(peerId, stream)
        } catch (err) {
            this.consumedProducers.delete(producerId)
            throw err
        }
    }

    private onProducerClosed(producerId: string): void {
        const consumerId = this.consumerByProducer.get(producerId)
        if (!consumerId) return
        this.consumerByProducer.delete(producerId)
        const entry = this.consumers.get(consumerId)
        if (!entry) return
        this.consumers.delete(consumerId)
        const { consumer, peerId } = entry
        const stream = this.streamByPeer.get(peerId)
        stream?.removeTrack(consumer.track)
        consumer.close()
        if (stream && stream.getTracks().length === 0) {
            this.streamByPeer.delete(peerId)
            this.onRemoteStreamRemoved?.(peerId)
        }
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.room.off(MessageType.Signal, this.onSignal)
        for (const { timer } of this.pending.values()) clearTimeout(timer)
        this.pending.clear()
        for (const p of this.producers.values()) p.close()
        for (const { consumer } of this.consumers.values()) consumer.close()
        this.sendTransport?.close()
        this.recvTransport?.close()
    }
}
