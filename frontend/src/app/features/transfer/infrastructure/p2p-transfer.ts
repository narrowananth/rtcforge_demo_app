import { Call, MediaEvent } from 'rtcforge-media/browser'
import { RTCForgeClient } from 'rtcforge-sdk'
import type { InboxEvent } from '../../../shared/types'
import { wsBaseUrl } from '../../../shared/utils'
import { iceForRoom } from '../../realtime/infrastructure/webrtc'

const CHUNK = 16 * 1024

type P2PIncoming = Extract<InboxEvent, { type: 'p2p-incoming' }>

/** Sender side: join the p2p room and stream the file over a data channel. */
export async function sendFileP2P(params: {
    roomId: string
    token: string
    recipientId: string
    file: File
}): Promise<void> {
    const { roomId, token, recipientId, file } = params
    const client = new RTCForgeClient({ serverUrl: wsBaseUrl(), token, reconnect: false })
    let sent = false
    // eslint-disable-next-line prefer-const
    let call: Call | undefined
    const teardown = () => {
        try {
            call?.close()
        } catch {
            /* noop */
        }
        client.leave().catch(() => undefined)
    }
    try {
        const room = await client.joinRoom(roomId)
        call = new Call(room, { iceServers: iceForRoom(room) })
        const trySend = async () => {
            if (sent || !call) return
            const channel = call.createDataChannel(recipientId, `file-${roomId}`, {
                ordered: true,
            })
            if (!channel) return // peer connection not ready yet
            sent = true
            try {
                await streamFile(channel, file)
            } catch {
                /* ignore */
            }
            setTimeout(teardown, 3000)
        }
        room.bindCall(call)
        room.on('peer-joined', (peerId: string) => {
            if (peerId === recipientId) void trySend()
        })
        if (room.peers.includes(recipientId)) void trySend()
        setTimeout(() => {
            if (!sent) teardown()
        }, 30000)
    } catch {
        teardown()
    }
}

function streamFile(channel: RTCDataChannel, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
        channel.binaryType = 'arraybuffer'
        const start = async () => {
            try {
                channel.send(
                    JSON.stringify({
                        t: 'meta',
                        name: file.name,
                        mime: file.type,
                        size: file.size,
                    }),
                )
                const buf = new Uint8Array(await file.arrayBuffer())
                for (let off = 0; off < buf.length; off += CHUNK) {
                    if (channel.bufferedAmount > 4 * 1024 * 1024) {
                        await new Promise<void>((r) => {
                            channel.bufferedAmountLowThreshold = 1024 * 1024
                            channel.onbufferedamountlow = () => r()
                        })
                    }
                    channel.send(buf.subarray(off, off + CHUNK))
                }
                channel.send(JSON.stringify({ t: 'done' }))
                resolve()
            } catch (err) {
                reject(err instanceof Error ? err : new Error('send failed'))
            }
        }
        if (channel.readyState === 'open') void start()
        else channel.onopen = () => void start()
        channel.onerror = () => reject(new Error('data channel error'))
    })
}

/** Receiver side: join the p2p room and reassemble the incoming file. */
export async function receiveFileP2P(
    event: P2PIncoming,
    onComplete: (blobUrl: string) => void,
): Promise<void> {
    const client = new RTCForgeClient({
        serverUrl: wsBaseUrl(),
        token: event.token,
        reconnect: false,
    })
    try {
        const room = await client.joinRoom(event.roomId)
        const call = new Call(room, { iceServers: iceForRoom(room) })
        const teardown = () => {
            try {
                call.close()
            } catch {
                /* noop */
            }
            client.leave().catch(() => undefined)
        }
        call.on(MediaEvent.DataChannel, (_peerId: string, channel: RTCDataChannel) => {
            receiveChannel(channel, event, (url) => {
                onComplete(url)
                teardown()
            })
        })
        room.bindCall(call)
        setTimeout(teardown, 60000)
    } catch {
        client.leave().catch(() => undefined)
    }
}

function receiveChannel(channel: RTCDataChannel, event: P2PIncoming, done: (url: string) => void) {
    channel.binaryType = 'arraybuffer'
    let meta: { mime?: string } | null = null
    const chunks: ArrayBuffer[] = []
    channel.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') {
            const msg = JSON.parse(e.data)
            if (msg.t === 'meta') meta = msg
            else if (msg.t === 'done') {
                const blob = new Blob(chunks, { type: meta?.mime ?? event.meta.mime })
                done(URL.createObjectURL(blob))
            }
        } else {
            chunks.push(e.data as ArrayBuffer)
        }
    }
}
