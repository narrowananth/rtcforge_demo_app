import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
} from 'react'
import { conversationGateway } from '../features/conversations/infrastructure/conversation-gateway'
import { messageGateway } from '../features/messages/infrastructure/message-gateway'
import { receiveFileP2P, sendFileP2P } from '../features/transfer/infrastructure/p2p-transfer'
import { transferGateway } from '../features/transfer/infrastructure/transfer-gateway'
import type { Conversation, InboxEvent, Message } from '../shared/types'
import { messagePreview, mimeToType } from '../shared/utils'
import { useAuth } from './auth-context'
import { useRealtime } from './realtime-context'
import { useToast } from './toast-context'

interface ChatState {
    conversations: Record<string, Conversation>
    messages: Record<string, Record<string, Message>>
    loaded: Record<string, boolean>
    presence: Record<string, boolean>
    unread: Record<string, number>
    p2pBlobs: Record<string, string>
    activeId: string | null
}

const initialState: ChatState = {
    conversations: {},
    messages: {},
    loaded: {},
    presence: {},
    unread: {},
    p2pBlobs: {},
    activeId: null,
}

type Action =
    | { type: 'set-conversations'; conversations: Conversation[] }
    | { type: 'upsert-conversation'; conversation: Conversation }
    | { type: 'remove-conversation'; convId: string }
    | { type: 'set-messages'; convId: string; messages: Message[] }
    | { type: 'upsert-message'; message: Message }
    | { type: 'patch-message'; convId: string; id: string; patch: Partial<Message> }
    | { type: 'touch-conversation'; convId: string; last: Conversation['lastMessage'] }
    | { type: 'set-presence'; entries: Record<string, boolean> }
    | { type: 'set-active'; convId: string | null }
    | { type: 'inc-unread'; convId: string }
    | { type: 'set-blob'; transferId: string; url: string }

function reducer(state: ChatState, action: Action): ChatState {
    switch (action.type) {
        case 'set-conversations': {
            const conversations: Record<string, Conversation> = {}
            for (const c of action.conversations) conversations[c.id] = c
            return { ...state, conversations }
        }
        case 'upsert-conversation':
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [action.conversation.id]: action.conversation,
                },
            }
        case 'remove-conversation': {
            const conversations = { ...state.conversations }
            delete conversations[action.convId]
            return { ...state, conversations }
        }
        case 'set-messages': {
            const map: Record<string, Message> = {}
            for (const m of action.messages) map[m.id] = m
            return {
                ...state,
                messages: { ...state.messages, [action.convId]: map },
                loaded: { ...state.loaded, [action.convId]: true },
            }
        }
        case 'upsert-message': {
            const m = action.message
            const convMsgs = { ...(state.messages[m.convId] ?? {}), [m.id]: m }
            return { ...state, messages: { ...state.messages, [m.convId]: convMsgs } }
        }
        case 'patch-message': {
            const conv = state.messages[action.convId]
            const existing = conv?.[action.id]
            if (!existing) return state
            const convMsgs = { ...conv, [action.id]: { ...existing, ...action.patch } }
            return { ...state, messages: { ...state.messages, [action.convId]: convMsgs } }
        }
        case 'touch-conversation': {
            const conv = state.conversations[action.convId]
            if (!conv) return state
            return {
                ...state,
                conversations: {
                    ...state.conversations,
                    [action.convId]: { ...conv, lastMessage: action.last, updatedAt: Date.now() },
                },
            }
        }
        case 'set-presence':
            return { ...state, presence: { ...state.presence, ...action.entries } }
        case 'set-active':
            return {
                ...state,
                activeId: action.convId,
                unread: action.convId ? { ...state.unread, [action.convId]: 0 } : state.unread,
            }
        case 'inc-unread':
            return {
                ...state,
                unread: {
                    ...state.unread,
                    [action.convId]: (state.unread[action.convId] ?? 0) + 1,
                },
            }
        case 'set-blob':
            return { ...state, p2pBlobs: { ...state.p2pBlobs, [action.transferId]: action.url } }
        default:
            return state
    }
}

interface ChatApi {
    state: ChatState
    open: (convId: string) => Promise<void>
    closeActive: () => void
    sendText: (text: string, replyTo?: string | null) => Promise<void>
    sendMedia: (file: File, replyTo?: string | null) => Promise<void>
    editMessage: (convId: string, msgId: string, text: string) => Promise<void>
    deleteMessage: (convId: string, msgId: string) => Promise<void>
    react: (convId: string, msgId: string, emoji: string) => Promise<void>
    startDm: (userId: string) => Promise<string>
    createGroup: (title: string, memberIds: string[]) => Promise<string>
    createBroadcast: (title: string, memberIds: string[]) => Promise<string>
    addMembers: (convId: string, memberIds: string[]) => Promise<void>
    removeMember: (convId: string, userId: string) => Promise<void>
}

const ChatContext = createContext<ChatApi | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth()
    const { subscribe } = useRealtime()
    const toast = useToast()
    const [state, dispatch] = useReducer(reducer, initialState)

    // Latest-state ref so async callbacks avoid stale closures.
    const stateRef = useRef(state)
    stateRef.current = state

    const fetchConversation = useCallback(async (convId: string) => {
        try {
            const { conversation } = await conversationGateway.get(convId)
            dispatch({ type: 'upsert-conversation', conversation })
        } catch {
            /* ignore */
        }
    }, [])

    const refreshPresence = useCallback(async () => {
        if (!user) return
        const ids = new Set<string>()
        for (const c of Object.values(stateRef.current.conversations)) {
            for (const m of c.members) if (m.id !== user.id) ids.add(m.id)
        }
        if (ids.size === 0) return
        try {
            const { online } = await conversationGateway.presence([...ids])
            const entries: Record<string, boolean> = {}
            for (const id of ids) entries[id] = online.includes(id)
            dispatch({ type: 'set-presence', entries })
        } catch {
            /* ignore */
        }
    }, [user])

    // Load conversations once connected.
    useEffect(() => {
        if (!user) return
        conversationGateway
            .list()
            .then(({ conversations }) => {
                dispatch({ type: 'set-conversations', conversations })
                void refreshPresence()
            })
            .catch(() => undefined)
    }, [user, refreshPresence])

    // Handle realtime events.
    useEffect(() => {
        if (!user) return
        const handle = (event: InboxEvent) => {
            switch (event.type) {
                case 'message': {
                    const m = event.message
                    if (!stateRef.current.conversations[m.convId]) void fetchConversation(m.convId)
                    dispatch({ type: 'upsert-message', message: m })
                    dispatch({
                        type: 'touch-conversation',
                        convId: m.convId,
                        last: {
                            preview: messagePreview(m),
                            ts: m.ts,
                            senderId: m.senderId,
                            senderName: m.senderName,
                        },
                    })
                    if (m.convId !== stateRef.current.activeId && m.senderId !== user.id) {
                        dispatch({ type: 'inc-unread', convId: m.convId })
                    }
                    break
                }
                case 'message-edited':
                    dispatch({
                        type: 'patch-message',
                        convId: event.convId,
                        id: event.id,
                        patch: { text: event.text, editedAt: event.editedAt },
                    })
                    break
                case 'message-deleted':
                    dispatch({
                        type: 'patch-message',
                        convId: event.convId,
                        id: event.id,
                        patch: { deletedAt: Date.now(), text: '', attachment: null, reactions: {} },
                    })
                    break
                case 'message-reaction':
                    dispatch({
                        type: 'patch-message',
                        convId: event.convId,
                        id: event.id,
                        patch: { reactions: event.reactions },
                    })
                    break
                case 'conversation-added':
                case 'conversation-updated':
                    void fetchConversation(event.convId).then(refreshPresence)
                    break
                case 'conversation-removed':
                    dispatch({ type: 'remove-conversation', convId: event.convId })
                    if (stateRef.current.activeId === event.convId)
                        dispatch({ type: 'set-active', convId: null })
                    break
                case 'presence':
                    dispatch({ type: 'set-presence', entries: { [event.userId]: event.online } })
                    break
                case 'p2p-incoming':
                    void receiveFileP2P(event, (url) =>
                        dispatch({ type: 'set-blob', transferId: event.transferId, url }),
                    )
                    break
                default:
                    break // call events handled by CallProvider
            }
        }
        return subscribe(handle)
    }, [user, subscribe, fetchConversation, refreshPresence])

    const open = useCallback(async (convId: string) => {
        dispatch({ type: 'set-active', convId })
        if (!stateRef.current.loaded[convId]) {
            try {
                const { messages } = await messageGateway.history(convId)
                dispatch({ type: 'set-messages', convId, messages })
            } catch {
                /* ignore */
            }
        }
        void refreshPresenceRef.current()
    }, [])

    // stable ref to refreshPresence for use inside `open` without dep churn
    const refreshPresenceRef = useRef(refreshPresence)
    refreshPresenceRef.current = refreshPresence

    const closeActive = useCallback(() => dispatch({ type: 'set-active', convId: null }), [])

    const sendText = useCallback(
        async (text: string, replyTo?: string | null) => {
            const convId = stateRef.current.activeId
            if (!convId || !text.trim()) return
            try {
                const { message } = await messageGateway.send(convId, {
                    type: 'text',
                    text,
                    replyTo,
                })
                dispatch({ type: 'upsert-message', message })
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to send')
            }
        },
        [toast],
    )

    const sendMedia = useCallback(
        async (file: File, replyTo?: string | null) => {
            const convId = stateRef.current.activeId
            if (!convId) return
            const conv = stateRef.current.conversations[convId]
            const type = mimeToType(file.type)
            try {
                // P2P-first for DMs with an online peer.
                if (conv?.type === 'dm') {
                    const offer = await transferGateway.offer(convId, {
                        filename: file.name,
                        mime: file.type,
                        size: file.size,
                    })
                    if (offer.p2p) {
                        dispatch({
                            type: 'set-blob',
                            transferId: offer.transferId,
                            url: URL.createObjectURL(file),
                        })
                        const { message } = await messageGateway.send(convId, {
                            type,
                            attachment: {
                                p2p: true,
                                transferId: offer.transferId,
                                filename: file.name,
                                mime: file.type,
                                size: file.size,
                            },
                            replyTo,
                        })
                        dispatch({ type: 'upsert-message', message })
                        const recipientId = conv.otherUser?.id
                        if (recipientId)
                            void sendFileP2P({
                                roomId: offer.roomId,
                                token: offer.token,
                                recipientId,
                                file,
                            })
                        return
                    }
                }
                // HTTP fallback.
                const buf = await file.arrayBuffer()
                const { attachment } = await messageGateway.uploadMedia(
                    buf,
                    file.type || 'application/octet-stream',
                    file.name,
                )
                const { message } = await messageGateway.send(convId, {
                    type,
                    attachment,
                    replyTo,
                })
                dispatch({ type: 'upsert-message', message })
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Upload failed')
            }
        },
        [toast],
    )

    const editMessage = useCallback(async (convId: string, msgId: string, text: string) => {
        await messageGateway.edit(convId, msgId, text)
    }, [])
    const deleteMessage = useCallback(async (convId: string, msgId: string) => {
        await messageGateway.remove(convId, msgId)
    }, [])
    const react = useCallback(async (convId: string, msgId: string, emoji: string) => {
        try {
            await messageGateway.react(convId, msgId, emoji)
        } catch {
            /* ignore */
        }
    }, [])

    const startDm = useCallback(async (userId: string) => {
        const { conversation } = await conversationGateway.createDm(userId)
        dispatch({ type: 'upsert-conversation', conversation })
        return conversation.id
    }, [])
    const createGroup = useCallback(async (title: string, memberIds: string[]) => {
        const { conversation } = await conversationGateway.createGroup(title, memberIds)
        dispatch({ type: 'upsert-conversation', conversation })
        return conversation.id
    }, [])
    const createBroadcast = useCallback(async (title: string, memberIds: string[]) => {
        const { conversation } = await conversationGateway.createBroadcast(title, memberIds)
        dispatch({ type: 'upsert-conversation', conversation })
        return conversation.id
    }, [])
    const addMembers = useCallback(async (convId: string, memberIds: string[]) => {
        const { conversation } = await conversationGateway.addMembers(convId, memberIds)
        dispatch({ type: 'upsert-conversation', conversation })
    }, [])
    const removeMember = useCallback(
        async (convId: string, userId: string) => {
            await conversationGateway.removeMember(convId, userId)
            if (userId === user?.id) {
                dispatch({ type: 'remove-conversation', convId })
                if (stateRef.current.activeId === convId)
                    dispatch({ type: 'set-active', convId: null })
            } else {
                void fetchConversation(convId)
            }
        },
        [user, fetchConversation],
    )

    const value = useMemo<ChatApi>(
        () => ({
            state,
            open,
            closeActive,
            sendText,
            sendMedia,
            editMessage,
            deleteMessage,
            react,
            startDm,
            createGroup,
            createBroadcast,
            addMembers,
            removeMember,
        }),
        [
            state,
            open,
            closeActive,
            sendText,
            sendMedia,
            editMessage,
            deleteMessage,
            react,
            startDm,
            createGroup,
            createBroadcast,
            addMembers,
            removeMember,
        ],
    )

    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatApi {
    const ctx = useContext(ChatContext)
    if (!ctx) throw new Error('useChat must be used within ChatProvider')
    return ctx
}
