import { SfuClient } from '@rtc-shared/client'
import { useEffect, useRef, useState } from 'react'
import { MessageType, type Room, type RTCForgeClient } from 'rtcforge/client'
import type { JoinInfo } from './api'
import { Chat } from './Chat'
import { joinStreamRoom } from './rtc'

/**
 * Broadcaster view: publish camera + mic (one → many) via the SFU, optionally
 * screen-share, and watch the live viewer count. The broadcaster is the only
 * peer allowed to produce media (enforced server-side).
 */
export function Broadcast({ join, onExit }: { join: JoinInfo; onExit: () => void }) {
    const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
    const [error, setError] = useState('')
    const [viewers, setViewers] = useState(0)
    const [micOn, setMicOn] = useState(true)
    const [camOn, setCamOn] = useState(true)
    const [screenOn, setScreenOn] = useState(false)

    const sfuRef = useRef<SfuClient | null>(null)
    const clientRef = useRef<RTCForgeClient | null>(null)
    const roomRef = useRef<Room | null>(null)
    const camStreamRef = useRef<MediaStream | null>(null)
    const screenStreamRef = useRef<MediaStream | null>(null)
    const selfVideoRef = useRef<HTMLVideoElement>(null)

    const myName = join.stream.title ? `${join.stream.title} (host)` : 'host'

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
                await sfu.init()

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 1280, height: 720 },
                    audio: true,
                })
                if (cancelled) {
                    for (const t of stream.getTracks()) t.stop()
                    return
                }
                camStreamRef.current = stream
                if (selfVideoRef.current) selfVideoRef.current.srcObject = stream
                await sfu.publish(stream)

                const updateViewers = () => setViewers(Math.max(0, room.peers.length - 1))
                room.on(MessageType.PeerJoined, updateViewers)
                room.on(MessageType.PeerLeft, updateViewers)
                cleanupFns.push(() => {
                    room.off(MessageType.PeerJoined, updateViewers)
                    room.off(MessageType.PeerLeft, updateViewers)
                })
                updateViewers()
                setStatus('live')
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
            for (const t of camStreamRef.current?.getTracks() || []) t.stop()
            for (const t of screenStreamRef.current?.getTracks() || []) t.stop()
            clientRef.current?.leave().catch(() => undefined)
        }
    }, [join])

    const toggleMic = () => {
        const next = !micOn
        setMicOn(next)
        sfuRef.current?.setAudioEnabled(next)
    }
    const toggleCam = () => {
        const next = !camOn
        setCamOn(next)
        sfuRef.current?.setVideoEnabled(next)
        for (const t of camStreamRef.current?.getVideoTracks() || []) {
            t.enabled = next
        }
    }
    const toggleScreen = async () => {
        const sfu = sfuRef.current
        if (!sfu) return
        if (screenOn) {
            sfu.removeScreenTrack()
            for (const t of screenStreamRef.current?.getTracks() || []) t.stop()
            screenStreamRef.current = null
            setScreenOn(false)
            return
        }
        try {
            const display = await navigator.mediaDevices.getDisplayMedia({ video: true })
            const track = display.getVideoTracks()[0]
            if (!track) return
            screenStreamRef.current = display
            track.onended = () => {
                sfu.removeScreenTrack()
                screenStreamRef.current = null
                setScreenOn(false)
            }
            await sfu.addScreenTrack(track)
            setScreenOn(true)
        } catch {
            /* user cancelled the picker */
        }
    }

    return (
        <div className="stage">
            <div className="video-area">
                <div className="badges">
                    <span className={`badge ${status === 'live' ? 'live' : ''}`}>
                        {status === 'live'
                            ? '● LIVE'
                            : status === 'error'
                              ? 'ERROR'
                              : 'Connecting…'}
                    </span>
                    <span className="badge">👁 {viewers} watching</span>
                </div>
                <video ref={selfVideoRef} autoPlay playsInline muted className="video-main" />
                {status === 'error' && <div className="error-overlay">{error}</div>}
                <div className="controls">
                    <button type="button" onClick={toggleMic} className={micOn ? '' : 'off'}>
                        {micOn ? '🎙 Mic' : '🔇 Muted'}
                    </button>
                    <button type="button" onClick={toggleCam} className={camOn ? '' : 'off'}>
                        {camOn ? '📷 Cam' : '🚫 Cam off'}
                    </button>
                    <button
                        type="button"
                        onClick={toggleScreen}
                        className={screenOn ? 'active' : ''}
                    >
                        {screenOn ? '🛑 Stop share' : '🖥 Share screen'}
                    </button>
                    <button type="button" onClick={onExit} className="danger">
                        End stream
                    </button>
                </div>
            </div>
            <aside className="side">
                <h3>{join.stream.title}</h3>
                {roomRef.current && status === 'live' ? (
                    <Chat room={roomRef.current} myName={myName} />
                ) : (
                    <p className="muted">Chat opens once you go live.</p>
                )}
            </aside>
        </div>
    )
}
