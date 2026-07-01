import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { Call, getDisplayMedia, getUserMedia, MediaEvent } from 'rtcforge-media/browser'
import { type Room, RTCForgeClient } from 'rtcforge-sdk'
import { callGateway } from '../features/calls/infrastructure/call-gateway'
import { iceForRoom } from '../features/realtime/infrastructure/webrtc'
import type { CallMedia, InboxEvent } from '../shared/types'
import { wsBaseUrl } from '../shared/utils'
import { useRealtime } from './realtime-context'
import { useToast } from './toast-context'

export type CallMode = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

export interface RemoteTile {
    peerId: string
    stream: MediaStream
    name: string
}

interface CallUiState {
    mode: CallMode
    media: CallMedia
    status: string
    peerName: string
    peerAvatar: string
    micOn: boolean
    camOn: boolean
    sharing: boolean
    localStream: MediaStream | null
    localScreen: MediaStream | null
    remotes: RemoteTile[]
}

const initialUi: CallUiState = {
    mode: 'idle',
    media: 'audio',
    status: '',
    peerName: '',
    peerAvatar: '#345',
    micOn: true,
    camOn: false,
    sharing: false,
    localStream: null,
    localScreen: null,
    remotes: [],
}

interface CallSession {
    callId: string
    client: RTCForgeClient
    room: Room
    call: Call
    localStream: MediaStream
    screenTrack: MediaStreamTrack | null
}

interface Pending {
    callId: string
    media: CallMedia
}

interface CallApi {
    ui: CallUiState
    placeCall: (convId: string, title: string, media: CallMedia) => Promise<void>
    acceptCall: () => Promise<void>
    declineCall: () => void
    endCall: () => void
    toggleMute: () => void
    toggleCam: () => void
    toggleScreen: () => Promise<void>
}

const CallContext = createContext<CallApi | null>(null)

export function CallProvider({ children }: { children: ReactNode }) {
    const { subscribe } = useRealtime()
    const toast = useToast()
    const [ui, setUi] = useState<CallUiState>(initialUi)
    const patch = useCallback((p: Partial<CallUiState>) => setUi((prev) => ({ ...prev, ...p })), [])

    const sessionRef = useRef<CallSession | null>(null)
    const pendingRef = useRef<Pending | null>(null)
    const inCallRef = useRef(false)

    const cleanup = useCallback(() => {
        const s = sessionRef.current
        sessionRef.current = null
        pendingRef.current = null
        inCallRef.current = false
        if (s) {
            try {
                s.screenTrack?.stop()
            } catch {
                /* noop */
            }
            try {
                s.call.close()
            } catch {
                /* noop */
            }
            s.client.leave().catch(() => undefined)
            try {
                for (const t of s.localStream.getTracks()) t.stop()
            } catch {
                /* noop */
            }
        }
        setUi(initialUi)
    }, [])

    const joinCall = useCallback(
        async (params: { callId: string; callRoomId: string; token: string; media: CallMedia }) => {
            const { callId, callRoomId, token, media } = params
            const stream = await getUserMedia(
                media === 'video' ? { audio: true, video: true } : { audio: true },
            )
            const client = new RTCForgeClient({ serverUrl: wsBaseUrl(), token, reconnect: false })
            const room = await client.joinRoom(callRoomId)
            const call = new Call(room, { stream, iceServers: iceForRoom(room) })

            call.on(MediaEvent.RemoteStream, (peerId: string, remote: MediaStream) => {
                const name = (room.getPeerMetadata(peerId)?.name as string) || 'Peer'
                setUi((prev) => {
                    const others = prev.remotes.filter((r) => r.peerId !== peerId)
                    return {
                        ...prev,
                        status: '',
                        remotes: [...others, { peerId, stream: remote, name }],
                    }
                })
            })
            call.on(MediaEvent.RemoteStreamRemoved, (peerId: string) =>
                setUi((prev) => ({
                    ...prev,
                    remotes: prev.remotes.filter((r) => r.peerId !== peerId),
                })),
            )
            call.on(MediaEvent.ConnectionFailed, (peerId: string) =>
                setUi((prev) => ({
                    ...prev,
                    remotes: prev.remotes.filter((r) => r.peerId !== peerId),
                })),
            )

            sessionRef.current = {
                callId,
                client,
                room,
                call,
                localStream: stream,
                screenTrack: null,
            }
            room.bindCall(call)
            patch({
                mode: 'active',
                media,
                localStream: stream,
                micOn: true,
                camOn: media === 'video',
                sharing: false,
            })
        },
        [patch],
    )

    const placeCall = useCallback(
        async (convId: string, title: string, media: CallMedia) => {
            if (inCallRef.current) {
                toast.error('You are already in a call')
                return
            }
            inCallRef.current = true
            patch({ mode: 'outgoing', media, status: `Calling ${title}…`, remotes: [] })
            try {
                const res = await callGateway.place(convId, media)
                await joinCall({
                    callId: res.callId,
                    callRoomId: res.callRoomId,
                    token: res.token,
                    media,
                })
            } catch (err) {
                cleanup()
                toast.error(err instanceof Error ? err.message : 'Call failed')
            }
        },
        [joinCall, cleanup, patch, toast],
    )

    const acceptCall = useCallback(async () => {
        const pending = pendingRef.current
        if (!pending) return
        pendingRef.current = null
        inCallRef.current = true
        patch({ mode: 'connecting', status: 'Connecting…' })
        try {
            const res = await callGateway.accept(pending.callId)
            await joinCall({
                callId: pending.callId,
                callRoomId: res.callRoomId,
                token: res.token,
                media: res.media,
            })
        } catch (err) {
            cleanup()
            toast.error(err instanceof Error ? err.message : 'Could not join call')
        }
    }, [joinCall, cleanup, patch, toast])

    const declineCall = useCallback(() => {
        const pending = pendingRef.current
        if (!pending) return
        pendingRef.current = null
        callGateway.decline(pending.callId).catch(() => undefined)
        cleanup()
    }, [cleanup])

    const endCall = useCallback(() => {
        const s = sessionRef.current
        if (s) callGateway.end(s.callId).catch(() => undefined)
        cleanup()
    }, [cleanup])

    const toggleMute = useCallback(() => {
        const s = sessionRef.current
        if (!s) return
        setUi((prev) => {
            const micOn = !prev.micOn
            if (micOn) s.call.unmuteAudio()
            else s.call.muteAudio()
            return { ...prev, micOn }
        })
    }, [])

    const toggleCam = useCallback(() => {
        const s = sessionRef.current
        if (!s) return
        setUi((prev) => {
            if (prev.media !== 'video') return prev
            const camOn = !prev.camOn
            if (camOn) s.call.unmuteVideo()
            else s.call.muteVideo()
            return { ...prev, camOn }
        })
    }, [])

    const toggleScreen = useCallback(async () => {
        const s = sessionRef.current
        if (!s) return
        if (s.screenTrack) {
            try {
                s.call.removeTrack(s.screenTrack)
            } catch {
                /* noop */
            }
            s.screenTrack.stop()
            s.screenTrack = null
            patch({ sharing: false, localScreen: null })
            return
        }
        try {
            const stream = await getDisplayMedia({ video: true })
            const track = stream.getVideoTracks()[0]
            s.screenTrack = track
            s.call.addScreenTrack(track, stream)
            track.onended = () => {
                if (sessionRef.current?.screenTrack === track) {
                    try {
                        sessionRef.current.call.removeTrack(track)
                    } catch {
                        /* noop */
                    }
                    sessionRef.current.screenTrack = null
                    patch({ sharing: false, localScreen: null })
                }
            }
            patch({ sharing: true, localScreen: stream })
        } catch {
            /* user cancelled */
        }
    }, [patch])

    // React to inbox call events.
    useEffect(() => {
        const handle = (event: InboxEvent) => {
            switch (event.type) {
                case 'call-incoming':
                    if (inCallRef.current || pendingRef.current) {
                        callGateway.decline(event.callId).catch(() => undefined) // busy
                        return
                    }
                    pendingRef.current = { callId: event.callId, media: event.media }
                    patch({
                        mode: 'incoming',
                        media: event.media,
                        peerName: event.from.name,
                        peerAvatar: event.from.avatar ?? '#345',
                        status: '',
                        remotes: [],
                    })
                    break
                case 'call-accepted':
                    if (sessionRef.current?.callId === event.callId)
                        patch({ status: `${event.by.name} joined` })
                    break
                case 'call-declined':
                    if (sessionRef.current?.callId === event.callId)
                        patch({ status: 'Call declined' })
                    break
                case 'call-ended':
                    if (
                        sessionRef.current?.callId === event.callId ||
                        pendingRef.current?.callId === event.callId
                    ) {
                        cleanup()
                    }
                    break
                default:
                    break
            }
        }
        return subscribe(handle)
    }, [subscribe, patch, cleanup])

    const value = useMemo<CallApi>(
        () => ({
            ui,
            placeCall,
            acceptCall,
            declineCall,
            endCall,
            toggleMute,
            toggleCam,
            toggleScreen,
        }),
        [ui, placeCall, acceptCall, declineCall, endCall, toggleMute, toggleCam, toggleScreen],
    )
    return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCall(): CallApi {
    const ctx = useContext(CallContext)
    if (!ctx) throw new Error('useCall must be used within CallProvider')
    return ctx
}
