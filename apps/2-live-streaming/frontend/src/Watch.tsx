import { SfuClient } from '@rtc-shared/client'
import { useEffect, useRef, useState } from 'react'
import { MessageType, type Room, type RTCForgeClient } from 'rtcforge/client'
import type { JoinInfo } from './api'
import { Chat } from './Chat'
import { joinStreamRoom } from './rtc'

/**
 * Viewer view: consume the broadcaster's stream (view-only — the server rejects
 * any produce from a viewer). Auto-consumes producers already live and any that
 * start while watching.
 */
export function Watch({
    join,
    myName,
    onExit,
}: {
    join: JoinInfo
    myName: string
    onExit: () => void
}) {
    const [status, setStatus] = useState<'connecting' | 'watching' | 'waiting' | 'ended' | 'error'>(
        'connecting',
    )
    const [error, setError] = useState('')
    const [viewers, setViewers] = useState(0)

    const sfuRef = useRef<SfuClient | null>(null)
    const clientRef = useRef<RTCForgeClient | null>(null)
    const roomRef = useRef<Room | null>(null)
    const videoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        let cancelled = false
        const cleanupFns: Array<() => void> = []

        async function go() {
            try {
                const { client, room } = await joinStreamRoom(join.token, join.stream.id)
                if (cancelled) {
                    client.leave().catch(() => undefined)
                    return
                }
                clientRef.current = client
                roomRef.current = room

                const sfu = new SfuClient(room)
                sfuRef.current = sfu
                sfu.onRemoteStream = (_peerId, stream) => {
                    if (videoRef.current) videoRef.current.srcObject = stream
                    setStatus('watching')
                }
                sfu.onRemoteStreamRemoved = () => {
                    if (videoRef.current) videoRef.current.srcObject = null
                    setStatus('ended')
                }
                await sfu.init()
                await sfu.consumeExisting()

                const updateViewers = () => setViewers(Math.max(0, room.peers.length - 1))
                room.on(MessageType.PeerJoined, updateViewers)
                room.on(MessageType.PeerLeft, updateViewers)
                cleanupFns.push(() => {
                    room.off(MessageType.PeerJoined, updateViewers)
                    room.off(MessageType.PeerLeft, updateViewers)
                })
                updateViewers()

                // If nothing to consume yet, we're waiting for the broadcaster.
                setStatus((s) => (s === 'watching' ? s : 'waiting'))
            } catch (err) {
                if (cancelled) return
                setError(err instanceof Error ? err.message : String(err))
                setStatus('error')
            }
        }
        go()

        return () => {
            cancelled = true
            for (const fn of cleanupFns) fn()
            sfuRef.current?.close()
            clientRef.current?.leave().catch(() => undefined)
        }
    }, [join])

    const overlay =
        status === 'connecting'
            ? 'Connecting…'
            : status === 'waiting'
              ? 'Waiting for the broadcaster…'
              : status === 'ended'
                ? 'Stream ended'
                : status === 'error'
                  ? error
                  : ''

    return (
        <div className="stage">
            <div className="video-area">
                <div className="badges">
                    <span className={`badge ${status === 'watching' ? 'live' : ''}`}>
                        {status === 'watching' ? '● LIVE' : status.toUpperCase()}
                    </span>
                    <span className="badge">👁 {viewers} watching</span>
                </div>
                {/* biome-ignore lint/a11y/useMediaCaption: a live WebRTC stream has no caption track */}
                <video ref={videoRef} autoPlay playsInline className="video-main" />
                {overlay && <div className="error-overlay">{overlay}</div>}
                <div className="controls">
                    <button type="button" onClick={onExit} className="danger">
                        Leave
                    </button>
                </div>
            </div>
            <aside className="side">
                <h3>{join.stream.title}</h3>
                {roomRef.current ? (
                    <Chat room={roomRef.current} myName={myName} />
                ) : (
                    <p className="muted">Connecting…</p>
                )}
            </aside>
        </div>
    )
}
