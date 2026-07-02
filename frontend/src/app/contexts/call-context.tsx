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
import { getDisplayMedia, getUserMedia } from 'rtcforge-media/browser'
import { type Room, RTCForgeClient } from 'rtcforge-sdk'
import { callGateway } from '../features/calls/infrastructure/call-gateway'
import { SfuClient } from '../features/calls/infrastructure/sfu-client'
import type { CallKind, CallMedia, InboxEvent } from '../shared/types'
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
    sfu: SfuClient
    localStream: MediaStream | null
    screenTrack: MediaStreamTrack | null
    produce: boolean
}

interface Pending {
    callId: string
    media: CallMedia
    mode: CallKind
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
                s.sfu.close()
            } catch {
                /* noop */
            }
            s.client.leave().catch(() => undefined)
            try {
                for (const t of s.localStream?.getTracks() ?? []) t.stop()
            } catch {
                /* noop */
            }
        }
        setUi(initialUi)
    }, [])

    const joinCall = useCallback(
        async (params: {
            callId: string
            callRoomId: string
            token: string
            media: CallMedia
            produce: boolean
        }) => {
            const { callId, callRoomId, token, media, produce } = params
            const client = new RTCForgeClient({ serverUrl: wsBaseUrl(), token, reconnect: false })
            const room = await client.joinRoom(callRoomId)
            const sfu = new SfuClient(room)

            sfu.onRemoteStream = (peerId: string, remote: MediaStream) => {
                const name = (room.getPeerMetadata(peerId)?.name as string) || 'Peer'
                setUi((prev) => {
                    const others = prev.remotes.filter((r) => r.peerId !== peerId)
                    return {
                        ...prev,
                        status: '',
                        remotes: [...others, { peerId, stream: remote, name }],
                    }
                })
            }
            sfu.onRemoteStreamRemoved = (peerId: string) =>
                setUi((prev) => ({
                    ...prev,
                    remotes: prev.remotes.filter((r) => r.peerId !== peerId),
                }))

            // Load the SFU device, then publish our tracks (callers/broadcaster)
            // and consume everyone already publishing.
            await sfu.init()
            let localStream: MediaStream | null = null
            if (produce) {
                localStream = await getUserMedia(
                    media === 'video' ? { audio: true, video: true } : { audio: true },
                )
                await sfu.publish(localStream)
            }
            await sfu.consumeExisting()

            sessionRef.current = {
                callId,
                client,
                room,
                sfu,
                localStream,
                screenTrack: null,
                produce,
            }
            patch({
                mode: 'active',
                media,
                localStream,
                micOn: produce,
                camOn: produce && media === 'video',
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
                if (res.mode === 'broadcast') patch({ status: `Broadcasting to ${title}…` })
                await joinCall({
                    callId: res.callId,
                    callRoomId: res.callRoomId,
                    token: res.token,
                    media,
                    produce: res.produce,
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
                produce: res.produce,
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
        if (!s?.produce) return
        setUi((prev) => {
            const micOn = !prev.micOn
            s.sfu.setAudioEnabled(micOn)
            return { ...prev, micOn }
        })
    }, [])

    const toggleCam = useCallback(() => {
        const s = sessionRef.current
        if (!s?.produce) return
        setUi((prev) => {
            if (prev.media !== 'video') return prev
            const camOn = !prev.camOn
            s.sfu.setVideoEnabled(camOn)
            return { ...prev, camOn }
        })
    }, [])

    const toggleScreen = useCallback(async () => {
        const s = sessionRef.current
        if (!s?.produce) return
        if (s.screenTrack) {
            s.sfu.removeScreenTrack()
            s.screenTrack.stop()
            s.screenTrack = null
            patch({ sharing: false, localScreen: null })
            return
        }
        try {
            const stream = await getDisplayMedia({ video: true })
            const track = stream.getVideoTracks()[0]
            s.screenTrack = track
            await s.sfu.addScreenTrack(track)
            track.onended = () => {
                if (sessionRef.current?.screenTrack === track) {
                    sessionRef.current.sfu.removeScreenTrack()
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
                case 'broadcast-incoming': {
                    if (inCallRef.current || pendingRef.current) {
                        callGateway.decline(event.callId).catch(() => undefined) // busy
                        return
                    }
                    const mode: CallKind =
                        event.type === 'broadcast-incoming' ? 'broadcast' : 'call'
                    pendingRef.current = { callId: event.callId, media: event.media, mode }
                    patch({
                        mode: 'incoming',
                        media: event.media,
                        peerName: event.from.name,
                        peerAvatar: event.from.avatar ?? '#345',
                        status: mode === 'broadcast' ? 'is broadcasting…' : '',
                        remotes: [],
                    })
                    break
                }
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
