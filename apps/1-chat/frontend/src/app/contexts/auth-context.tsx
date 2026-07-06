import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react'
import { apiClient } from '../api'
import type { LoginInput, RegisterInput } from '../features/auth/domain/types'
import { authGateway } from '../features/auth/infrastructure/auth-gateway'
import type { PublicUser } from '../shared/types'

const TOKEN_KEY = 'fc_token'
const USER_KEY = 'fc_me'

interface AuthApi {
    user: PublicUser | null
    ready: boolean
    register: (input: RegisterInput) => Promise<void>
    login: (input: LoginInput) => Promise<void>
    logout: () => void
}

const AuthContext = createContext<AuthApi | null>(null)

function loadStoredUser(): PublicUser | null {
    try {
        return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null')
    } catch {
        return null
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<PublicUser | null>(null)
    const [ready, setReady] = useState(false)

    const persist = useCallback((session: { user: PublicUser; token: string }) => {
        apiClient.setToken(session.token)
        localStorage.setItem(TOKEN_KEY, session.token)
        localStorage.setItem(USER_KEY, JSON.stringify(session.user))
        setUser(session.user)
    }, [])

    const logout = useCallback(() => {
        apiClient.setToken(null)
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setUser(null)
    }, [])

    // Restore a stored session on boot (validate against /me).
    useEffect(() => {
        const token = localStorage.getItem(TOKEN_KEY)
        const stored = loadStoredUser()
        if (!token || !stored) {
            setReady(true)
            return
        }
        apiClient.setToken(token)
        authGateway
            .me()
            .then(({ user: fresh }) => setUser(fresh))
            .catch(() => logout())
            .finally(() => setReady(true))
    }, [logout])

    const register = useCallback(
        async (input: RegisterInput) => persist(await authGateway.register(input)),
        [persist],
    )
    const login = useCallback(
        async (input: LoginInput) => persist(await authGateway.login(input)),
        [persist],
    )

    const value = useMemo<AuthApi>(
        () => ({ user, ready, register, login, logout }),
        [user, ready, register, login, logout],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthApi {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
}
