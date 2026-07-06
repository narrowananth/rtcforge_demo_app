import { MeshCall, type RoomConnection, SfuClient } from '@rtc-shared/client'
import { useEffect, useRef, useState } from 'react'
import { ClientEvent, MessageType, type Room } from 'rtcforge/client'
import { api, type JoinInfo } from './api'
import { joinMeetingRoom } from './rtc'
import { VideoTile } from './VideoTile'

type Engine = MeshCall | SfuClient
interface Member {
    name: string
    role: string
}

/**
 * One live meeting. Picks the media plane by meeting type — rtcforge `Call`
 * (P2P mesh) for `call`, `SfuClient` (server fan-out) for `room`/`webinar` — but
 * renders both identically: a grid of tiles plus mic/cam/screen controls and,
 * for the host, per-tile moderation. Names + a mute-request channel ride the
 * room's broadcast/signal bus (independent of the media plane).
 */
export function Meeting({ join, onExit }: { join: JoinInfo; onExit: () => void }) {
    const { type } = join.meeting
    const canPublish = type !== 'webinar' || join.self.role === 'host'
    const isHost = join.self.role === 'host'

    const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
    const [error, setError] = useState('')
    const [, setTick] = useState(0)
    const [micOn, setMicOn] = useState(true)
    const [camOn, setCamOn] = useState(true)
    const [screenOn, setScreenOn] = useState(false)

    const engineRef = useRef<Engine | null>(null)
    const connRef = useRef<RoomConnection | null>(null)
    const roomRef = useRef<Room | null>(null)
    const localStreamRef = useRef<MediaStream | null>(null)
    const screenStreamRef = useRef<MediaStream | null>(null)
    const tilesRef = useRef(new Map<string, MediaStream>())
    const rosterRef = useRef(new Map<string, Member>())

    useEffect(() => {
        let cancelled = false
        const cleanup: Array<() => void> = []
        const rerender = () => setTick((t) => t + 1)

        async function go() {
            try {
                const conn = await joinMeetingRoom(join.token, type, join.meeting.id)
                if (cancelled) return conn.client.leave().catch(() => undefined)
                connRef.current = conn
                roomRef.current = conn.room
                const room = conn.room

                // If the server kicks us, the socket terminates → leave the view.
                conn.client.on(ClientEvent.Terminated, () => !cancelled && onExit())

                // Names ride a 'hello' broadcast; reply directly so newcomers learn us.
                const announce = () =>
                    room.broadcast('hello', { name: join.self.name, role: join.self.role })
                const onBroadcast = (from: string, channel: string, data: unknown) => {
                    if (channel !== 'hello' || from === join.self.id) return
                    const d = data as Member
                    rosterRef.current.set(from, { name: d.name || 'guest', role: d.role || '' })
                    room.sendSignal(from, {
                        t: 'hello',
                        name: join.self.name,
                        role: join.self.role,
                    })
                    rerender()
                }
                const onSignal = (from: string, data: unknown) => {
                    const d = data as { t?: string; name?: string; role?: string }
                    if (d?.t === 'hello') {
                        rosterRef.current.set(from, { name: d.name || 'guest', role: d.role || '' })
                        rerender()
                    } else if (d?.t === 'mute-request') {
                        setMicOn(false)
                        engineRef.current?.setAudioEnabled(false)
                        const s = localStreamRef.current
                        for (const t of s?.getAudioTracks() || []) t.enabled = false
                    }
                }
                const onPeerLeft = (peerId: string) => {
                    rosterRef.current.delete(peerId)
                    if (tilesRef.current.delete(peerId))
                        tilesRef.current = new Map(tilesRef.current)
                    rerender()
                }
                room.on(MessageType.Broadcast, onBroadcast)
                room.on(MessageType.Signal, onSignal)
                room.on(MessageType.PeerLeft, onPeerLeft)
                cleanup.push(() => {
                    room.off(MessageType.Broadcast, onBroadcast)
                    room.off(MessageType.Signal, onSignal)
                    room.off(MessageType.PeerLeft, onPeerLeft)
                })

                // Local media (everyone publishes except a webinar audience).
                let localStream: MediaStream | null = null
                if (canPublish) {
                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: { width: 1280, height: 720 },
                        audio: true,
                    })
                    if (cancelled) {
                        for (const t of localStream.getTracks()) t.stop()
                        return
                    }
                    localStreamRef.current = localStream
                }

                const onRemoteStream = (peerId: string, stream: MediaStream) => {
                    tilesRef.current.set(peerId, stream)
                    tilesRef.current = new Map(tilesRef.current)
                    rerender()
                }
                const onRemoteStreamRemoved = (peerId: string) => {
                    if (tilesRef.current.delete(peerId))
                        tilesRef.current = new Map(tilesRef.current)
                    rerender()
                }

                if (type === 'call') {
                    const mc = new MeshCall(room, localStream as MediaStream)
                    mc.onRemoteStream = onRemoteStream
                    mc.onRemoteStreamRemoved = onRemoteStreamRemoved
                    engineRef.current = mc
                    mc.start()
                } else {
                    const sc = new SfuClient(room)
                    sc.onRemoteStream = onRemoteStream
                    sc.onRemoteStreamRemoved = onRemoteStreamRemoved
                    engineRef.current = sc
                    await sc.init()
                    if (canPublish && localStream) await sc.publish(localStream)
                    await sc.consumeExisting()
                }

                announce()
                setStatus('ready')
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
            engineRef.current?.close()
            for (const t of localStreamRef.current?.getTracks() || []) t.stop()
            for (const t of screenStreamRef.current?.getTracks() || []) t.stop()
            connRef.current?.client.leave().catch(() => undefined)
        }
    }, [join, type, canPublish, onExit])

    const toggleMic = () => {
        const next = !micOn
        setMicOn(next)
        engineRef.current?.setAudioEnabled(next)
        for (const t of localStreamRef.current?.getAudioTracks() || []) t.enabled = next
    }
    const toggleCam = () => {
        const next = !camOn
        setCamOn(next)
        engineRef.current?.setVideoEnabled(next)
        for (const t of localStreamRef.current?.getVideoTracks() || []) t.enabled = next
    }
    const toggleScreen = async () => {
        const engine = engineRef.current
        if (!engine) return
        if (screenOn) {
            engine.removeScreenTrack()
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
                engine.removeScreenTrack()
                screenStreamRef.current = null
                setScreenOn(false)
            }
            await engine.addScreenTrack(track)
            setScreenOn(true)
        } catch {
            /* cancelled */
        }
    }

    const kick = (peerId: string) =>
        api.kick(join.meeting.id, join.token, peerId).catch((e) => setError(String(e)))
    const muteRequest = (peerId: string) =>
        roomRef.current?.sendSignal(peerId, { t: 'mute-request' })

    const remotes = [...tilesRef.current.entries()]

    return (
        <div className="meeting">
            <header className="meeting-bar">
                <div className="meeting-title">
                    <span className={`type-pill ${type}`}>{type}</span>
                    {join.meeting.title}
                </div>
                <div className="meeting-info">
                    <span className="muted">
                        {remotes.length + (localStreamRef.current ? 1 : 0)} in call · id{' '}
                        <code>{join.meeting.id}</code>
                    </span>
                </div>
            </header>

            {status !== 'ready' ? (
                <div className="meeting-status">
                    {status === 'error' ? `Error: ${error}` : 'Connecting…'}
                </div>
            ) : (
                <div className="grid-wrap">
                    <div
                        className="video-grid"
                        style={{
                            gridTemplateColumns: `repeat(${gridCols(
                                remotes.length + (localStreamRef.current ? 1 : 0),
                            )}, 1fr)`,
                        }}
                    >
                        {localStreamRef.current && (
                            <VideoTile
                                stream={localStreamRef.current}
                                name={join.self.name}
                                isSelf
                            />
                        )}
                        {remotes.map(([peerId, stream]) => (
                            <VideoTile
                                key={peerId}
                                stream={stream}
                                name={rosterRef.current.get(peerId)?.name || 'guest'}
                                canModerate={isHost}
                                onKick={() => kick(peerId)}
                                onMuteRequest={() => muteRequest(peerId)}
                            />
                        ))}
                        {remotes.length === 0 && (
                            <div className="tile empty">Waiting for others to join…</div>
                        )}
                    </div>
                </div>
            )}

            <footer className="controls-bar">
                {canPublish ? (
                    <>
                        <button type="button" onClick={toggleMic} className={micOn ? '' : 'off'}>
                            {micOn ? '🎙' : '🔇'}
                        </button>
                        <button type="button" onClick={toggleCam} className={camOn ? '' : 'off'}>
                            {camOn ? '📷' : '🚫'}
                        </button>
                        <button
                            type="button"
                            onClick={toggleScreen}
                            className={screenOn ? 'active' : ''}
                        >
                            🖥
                        </button>
                    </>
                ) : (
                    <span className="muted view-only">👁 View-only (webinar audience)</span>
                )}
                <button type="button" onClick={onExit} className="danger leave">
                    Leave
                </button>
            </footer>
        </div>
    )
}

function gridCols(n: number): number {
    if (n <= 1) return 1
    if (n <= 4) return 2
    if (n <= 9) return 3
    return 4
}
