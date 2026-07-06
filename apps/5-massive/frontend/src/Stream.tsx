import { SfuClient } from '@rtc-shared/client'
import { useEffect, useRef, useState } from 'react'
import { MessageType, type RTCForgeClient } from 'rtcforge/client'
import type { JoinInfo } from './api'
import { ClusterDashboard } from './ClusterDashboard'
import { joinStreamRoom } from './rtc'

/**
 * One stream, viewed live alongside the cluster dashboard so you can watch the
 * SFU cluster react as viewers pile on (nodes fill → cascade edges appear). The
 * client is identical to the single-node case — the cluster routes the peer to a
 * node transparently behind the reserved `sfu` control channel.
 */
export function Stream({ join, onExit }: { join: JoinInfo; onExit: () => void }) {
    const broadcasting = join.role === 'broadcaster'
    const [status, setStatus] = useState<'connecting' | 'live' | 'waiting' | 'ended' | 'error'>(
        'connecting',
    )
    const [error, setError] = useState('')
    const [viewers, setViewers] = useState(0)

    const sfuRef = useRef<SfuClient | null>(null)
    const clientRef = useRef<RTCForgeClient | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const videoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        let cancelled = false
        const cleanup: Array<() => void> = []

        async function go() {
            try {
                const { client, room } = await joinStreamRoom(join.token, join.stream.id)
                if (cancelled) return client.leave().catch(() => undefined)
                clientRef.current = client

                const sfu = new SfuClient(room)
                sfuRef.current = sfu
                sfu.onRemoteStream = (_peerId, stream) => {
                    if (videoRef.current) videoRef.current.srcObject = stream
                    setStatus('live')
                }
                sfu.onRemoteStreamRemoved = () => {
                    if (videoRef.current) videoRef.current.srcObject = null
                    setStatus('ended')
                }
                await sfu.init()

                if (broadcasting) {
                    const media = await navigator.mediaDevices.getUserMedia({
                        video: { width: 1280, height: 720 },
                        audio: true,
                    })
                    if (cancelled) {
                        for (const t of media.getTracks()) t.stop()
                        return
                    }
                    streamRef.current = media
                    if (videoRef.current) videoRef.current.srcObject = media
                    await sfu.publish(media)
                    setStatus('live')
                } else {
                    await sfu.consumeExisting()
                    setStatus((s) => (s === 'live' ? s : 'waiting'))
                }

                const updateViewers = () => setViewers(Math.max(0, room.peers.length - 1))
                room.on(MessageType.PeerJoined, updateViewers)
                room.on(MessageType.PeerLeft, updateViewers)
                cleanup.push(() => {
                    room.off(MessageType.PeerJoined, updateViewers)
                    room.off(MessageType.PeerLeft, updateViewers)
                })
                updateViewers()
            } catch (err) {
                if (cancelled) return
                setError(err instanceof Error ? err.message : String(err))
                setStatus('error')
            }
        }
        go()

        return () => {
            cancelled = true
            for (const fn of cleanup) fn()
            sfuRef.current?.close()
            for (const t of streamRef.current?.getTracks() || []) t.stop()
            clientRef.current?.leave().catch(() => undefined)
        }
    }, [join, broadcasting])

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
            <div className="stage-main">
                <div className="video-area">
                    <div className="badges">
                        <span className={`badge ${status === 'live' ? 'live' : ''}`}>
                            {status === 'live'
                                ? broadcasting
                                    ? '● ON AIR'
                                    : '● LIVE'
                                : status.toUpperCase()}
                        </span>
                        <span className="badge">👁 {viewers} watching</span>
                        <span className="badge">{broadcasting ? 'broadcaster' : 'viewer'}</span>
                    </div>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted={broadcasting}
                        className="video-main"
                    />
                    {overlay && <div className="error-overlay">{overlay}</div>}
                    <div className="controls">
                        <button type="button" onClick={onExit} className="danger">
                            {broadcasting ? 'End stream' : 'Leave'}
                        </button>
                    </div>
                </div>
                <h3 className="stage-title">{join.stream.title}</h3>
            </div>
            <aside className="stage-side">
                <ClusterDashboard />
            </aside>
        </div>
    )
}
