import { iceForRoom } from '@rtc-shared/client'
import { RTCForgeClient } from 'rtcforge/client'
import {
    type DataChannelHub,
    FileTransferEvent,
    FileTransferManager,
    MemorySink,
    type ReceiveTransfer,
    TransferEvent,
} from 'rtcforge/filetransfer'
import { Call, MediaEvent } from 'rtcforge/media'
import type { InboxEvent } from '../../../shared/types'
import { wsBaseUrl } from '../../../shared/utils'

/**
 * Peer-to-peer file transfer over the rtcforge WebRTC data channel, driven by
 * rtcforge's own `FileTransferManager`: SHA-256 integrity checking, real
 * backpressure (high/low water marks), a hostile-size cap, and resumable sends
 * on a mid-transfer channel drop. The manager needs a `DataChannelHub` — the
 * seam onto the peer-connection layer — which the mesh `Call` already satisfies
 * (`createDataChannel` + the `data-channel` event), so we adapt it in a few lines.
 */

const MAX_FILE_BYTES = 200 * 1024 * 1024 // 200 MB — blunt memory/disk exhaustion
const SEND_WAIT_MS = 30000
const RECV_WAIT_MS = 120000

type P2PIncoming = Extract<InboxEvent, { type: 'p2p-incoming' }>

/** Wrap a mesh {@link Call} as the {@link DataChannelHub} the transfer engine needs. */
function callHub(call: Call): DataChannelHub {
    return {
        createDataChannel: (peerId, label, opts) => call.createDataChannel(peerId, label, opts),
        on: (_event, handler) => call.on(MediaEvent.DataChannel, handler),
        off: (_event, handler) => call.off(MediaEvent.DataChannel, handler),
    }
}

/** Sender side: join the p2p room and stream the file once the recipient is present. */
export async function sendFileP2P(params: {
    roomId: string
    token: string
    recipientId: string
    file: File
    onProgress?: (ratio: number) => void
}): Promise<void> {
    const { roomId, token, recipientId, file, onProgress } = params
    const client = new RTCForgeClient({ serverUrl: wsBaseUrl(), token, reconnect: false })
    let ftm: FileTransferManager | undefined
    let call: Call | undefined
    const teardown = () => {
        try {
            ftm?.close()
        } catch {
            /* noop */
        }
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
        room.bindCall(call)
        ftm = new FileTransferManager(callHub(call), { checksum: true, resumable: true })

        let started = false
        const trySend = () => {
            if (started || !ftm) return
            started = true
            try {
                const transfer = ftm.sendFile(recipientId, file)
                transfer.on(TransferEvent.Progress, (p) => onProgress?.(p.ratio))
                transfer.on(TransferEvent.Complete, () => {
                    onProgress?.(1)
                    setTimeout(teardown, 1500)
                })
                transfer.on(TransferEvent.Error, () => setTimeout(teardown, 1500))
            } catch {
                setTimeout(teardown, 1500)
            }
        }

        // Send as soon as the recipient's peer connection exists (perfect
        // negotiation creates it on peer-join), or immediately if already present.
        room.on('peer-joined', (peerId: string) => {
            if (peerId === recipientId) trySend()
        })
        if (room.peers.includes(recipientId)) trySend()
        setTimeout(() => {
            if (!started) teardown()
        }, SEND_WAIT_MS)
    } catch {
        teardown()
    }
}

/** Receiver side: join the p2p room and accept the incoming offer into memory. */
export async function receiveFileP2P(
    event: P2PIncoming,
    onComplete: (blobUrl: string) => void,
    onProgress?: (ratio: number) => void,
): Promise<void> {
    const client = new RTCForgeClient({
        serverUrl: wsBaseUrl(),
        token: event.token,
        reconnect: false,
    })
    try {
        const room = await client.joinRoom(event.roomId)
        const call = new Call(room, { iceServers: iceForRoom(room) })
        room.bindCall(call)
        const ftm = new FileTransferManager(callHub(call), {
            checksum: true,
            resumable: true,
            maxFileSize: MAX_FILE_BYTES,
        })
        const teardown = () => {
            try {
                ftm.close()
            } catch {
                /* noop */
            }
            try {
                call.close()
            } catch {
                /* noop */
            }
            client.leave().catch(() => undefined)
        }
        ftm.on(FileTransferEvent.IncomingOffer, (transfer: ReceiveTransfer) => {
            transfer.on(TransferEvent.Progress, (p) => onProgress?.(p.ratio))
            transfer.on(TransferEvent.Complete, () => {
                const blob = transfer.result?.blob
                if (blob) onComplete(URL.createObjectURL(blob))
                setTimeout(teardown, 1500)
            })
            transfer.on(TransferEvent.Error, () => setTimeout(teardown, 1500))
            // The engine verifies the SHA-256 digest before Complete fires, so a
            // corrupt or truncated transfer surfaces as Error, never a bad blob.
            transfer.accept(new MemorySink())
        })
        setTimeout(teardown, RECV_WAIT_MS)
    } catch {
        client.leave().catch(() => undefined)
    }
}
