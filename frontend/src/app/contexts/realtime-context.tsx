import {
    createContext,
    type ReactNode,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {
    connectInbox,
    type InboxConnection,
    type InboxStatus,
} from '../features/realtime/infrastructure/inbox-client'
import type { InboxEvent } from '../shared/types'
import { useAuth } from './auth-context'

type Listener = (event: InboxEvent) => void
export type RealtimeStatus = 'connecting' | InboxStatus

interface RealtimeApi {
    connected: boolean
    status: RealtimeStatus
    /** Increments on every reconnect-after-drop; consumers depend on it to resync. */
    reconnectNonce: number
    subscribe: (listener: Listener) => () => void
}

const RealtimeContext = createContext<RealtimeApi | null>(null)

export function RealtimeProvider({ children }: { children: ReactNode }) {
    const { user, logout } = useAuth()
    const [status, setStatus] = useState<RealtimeStatus>('connecting')
    const [reconnectNonce, setReconnectNonce] = useState(0)
    const listeners = useRef(new Set<Listener>())

    const subscribe = useRef((listener: Listener) => {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
    }).current

    useEffect(() => {
        if (!user) return
        let conn: InboxConnection | null = null
        let cancelled = false
        const token = localStorage.getItem('fc_token')
        if (!token) return
        setStatus('connecting')

        connectInbox(user.id, token, {
            onEvent: (event) => {
                for (const listener of listeners.current) listener(event)
            },
            onStatus: (s) => {
                if (!cancelled) setStatus(s)
            },
            onReconnect: () => {
                if (!cancelled) setReconnectNonce((n) => n + 1)
            },
            // Expired/invalid token → drop the session so the app returns to login
            // instead of the client silently retrying a token that can't work.
            onAuthError: logout,
        })
            .then((c) => {
                if (cancelled) {
                    c.close()
                    return
                }
                conn = c
                setStatus('connected')
            })
            .catch(() => setStatus('terminated'))

        return () => {
            cancelled = true
            conn?.close()
        }
    }, [user, logout])

    const value = useMemo<RealtimeApi>(
        () => ({ connected: status === 'connected', status, reconnectNonce, subscribe }),
        [status, reconnectNonce, subscribe],
    )
    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeApi {
    const ctx = useContext(RealtimeContext)
    if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider')
    return ctx
}
