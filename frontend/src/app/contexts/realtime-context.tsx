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
} from '../features/realtime/infrastructure/inbox-client'
import type { InboxEvent } from '../shared/types'
import { useAuth } from './auth-context'

type Listener = (event: InboxEvent) => void

interface RealtimeApi {
    connected: boolean
    subscribe: (listener: Listener) => () => void
}

const RealtimeContext = createContext<RealtimeApi | null>(null)

export function RealtimeProvider({ children }: { children: ReactNode }) {
    const { user, logout } = useAuth()
    const [connected, setConnected] = useState(false)
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

        connectInbox(
            user.id,
            token,
            (event) => {
                for (const listener of listeners.current) listener(event)
            },
            // Expired/invalid token → drop the session so the app returns to login
            // instead of the client silently retrying a token that can't work.
            logout,
        )
            .then((c) => {
                if (cancelled) {
                    c.close()
                    return
                }
                conn = c
                setConnected(true)
            })
            .catch(() => setConnected(false))

        return () => {
            cancelled = true
            conn?.close()
            setConnected(false)
        }
    }, [user, logout])

    const value = useMemo<RealtimeApi>(() => ({ connected, subscribe }), [connected, subscribe])
    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeApi {
    const ctx = useContext(RealtimeContext)
    if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider')
    return ctx
}
