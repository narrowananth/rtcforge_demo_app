import { Box, Center, Flex, Text } from '@chakra-ui/react'
import { Info, Phone, Radio, Video } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/auth-context'
import { useCall } from '../../contexts/call-context'
import { useChat } from '../../contexts/chat-context'
import type { Message } from '../../shared/types'
import { formatDay, messagePreview } from '../../shared/utils'
import { Avatar } from '../atoms/avatar'
import { IconChip } from '../atoms/icon-chip'
import { ComposerBar } from '../molecules/composer-bar'
import { MessageBubble } from '../molecules/message-bubble'
import { MessageMenu } from '../molecules/message-menu'

interface MenuState {
    message: Message
    at: { x: number; y: number }
}

export function ConversationPane({ onOpenInfo }: { onOpenInfo: () => void }) {
    const { user } = useAuth()
    const { state, sendText, sendMedia, editMessage, deleteMessage, react } = useChat()
    const call = useCall()

    const [reply, setReply] = useState<Message | null>(null)
    const [editing, setEditing] = useState<Message | null>(null)
    const [menu, setMenu] = useState<MenuState | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    const conv = state.activeId ? state.conversations[state.activeId] : null

    const messages = useMemo(() => {
        if (!state.activeId) return []
        return Object.values(state.messages[state.activeId] ?? {}).sort((a, b) => a.ts - b.ts)
    }, [state.messages, state.activeId])

    // Auto-scroll to the latest message.
    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [])

    // Reset composer helpers when switching conversations.
    useEffect(() => {
        setReply(null)
        setEditing(null)
        setMenu(null)
    }, [])

    if (!conv || !user) {
        return (
            <Center flex="1" color="fg.muted" bg="bg.app">
                <Box textAlign="center">
                    <Text fontSize="5xl">💬</Text>
                    <Text mt="2">Select a chat to start messaging</Text>
                </Box>
            </Center>
        )
    }

    const dmUser = conv.type === 'dm' ? conv.otherUser : null
    const subtitle =
        conv.type === 'dm'
            ? dmUser && state.presence[dmUser.id]
                ? 'online'
                : 'offline'
            : conv.type === 'group'
              ? conv.members.map((m) => (m.id === user.id ? 'You' : m.displayName)).join(', ')
              : `${conv.members.length} recipients`

    const handleSend = (text: string) => {
        if (editing) {
            void editMessage(conv.id, editing.id, text)
            setEditing(null)
        } else {
            void sendText(text, reply?.id ?? null)
            setReply(null)
        }
    }

    const banner = editing
        ? { title: 'Editing message', text: editing.text, onCancel: () => setEditing(null) }
        : reply
          ? {
                title: `Reply to ${reply.senderName}`,
                text: messagePreview(reply),
                onCancel: () => setReply(null),
            }
          : null

    let lastDay = ''
    let prev: Message | null = null

    return (
        <Flex
            direction="column"
            height="100%"
            minWidth="0"
            bg="bg.app"
            css={{
                backgroundImage: 'radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1px)',
                backgroundSize: '22px 22px',
            }}
        >
            <Flex align="center" gap="3" px="4" py="2.5" bg="bg.panel.raised">
                <Avatar
                    name={conv.title}
                    color={conv.avatarColor}
                    online={dmUser ? Boolean(state.presence[dmUser.id]) : undefined}
                />
                <Box flex="1" minWidth="0">
                    <Text fontWeight="semibold" truncate>
                        {conv.title}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" truncate>
                        {subtitle}
                    </Text>
                </Box>
                {conv.type !== 'broadcast' ? (
                    <>
                        <IconChip
                            label="Voice call"
                            onClick={() => void call.placeCall(conv.id, conv.title, 'audio')}
                        >
                            <Phone size={20} />
                        </IconChip>
                        <IconChip
                            label="Video call"
                            onClick={() => void call.placeCall(conv.id, conv.title, 'video')}
                        >
                            <Video size={20} />
                        </IconChip>
                    </>
                ) : (
                    <IconChip
                        label="Go live (broadcast)"
                        onClick={() => void call.placeCall(conv.id, conv.title, 'video')}
                    >
                        <Radio size={20} />
                    </IconChip>
                )}
                <IconChip label="Info" onClick={onOpenInfo}>
                    <Info size={20} />
                </IconChip>
            </Flex>

            <Flex
                data-testid="messages"
                ref={scrollRef}
                direction="column"
                flex="1"
                minHeight="0"
                overflowY="auto"
                px={{ base: '3', md: '8' }}
                py="4"
            >
                <Box mt="auto" />
                {messages.map((m) => {
                    const day = formatDay(m.ts)
                    const showDay = day !== lastDay
                    if (showDay) lastDay = day
                    const grouped =
                        !showDay &&
                        !!prev &&
                        prev.senderId === m.senderId &&
                        m.ts - prev.ts < 5 * 60 * 1000 &&
                        !m.replyPreview
                    prev = m
                    return (
                        <Fragment key={m.id}>
                            {showDay && (
                                <Text
                                    alignSelf="center"
                                    textAlign="center"
                                    color="fg.muted"
                                    fontSize="xs"
                                    my="2"
                                >
                                    {day}
                                </Text>
                            )}
                            <MessageBubble
                                message={m}
                                grouped={grouped}
                                isGroup={conv.type === 'group'}
                                meId={user.id}
                                p2pBlobs={state.p2pBlobs}
                                onOpenMenu={(message, at) => setMenu({ message, at })}
                                onToggleReaction={(message, emoji) =>
                                    void react(conv.id, message.id, emoji)
                                }
                            />
                        </Fragment>
                    )
                })}
            </Flex>

            <ComposerBar
                prefill={editing?.text ?? (reply ? '' : undefined)}
                banner={banner}
                onSend={handleSend}
                onFile={(file) => void sendMedia(file, reply?.id ?? null)}
            />

            {menu && (
                <MessageMenu
                    message={menu.message}
                    at={menu.at}
                    canEdit={
                        menu.message.senderId === user.id &&
                        menu.message.type === 'text' &&
                        !menu.message.deletedAt
                    }
                    canDelete={menu.message.senderId === user.id || conv.admins.includes(user.id)}
                    onClose={() => setMenu(null)}
                    onReact={(emoji) => void react(conv.id, menu.message.id, emoji)}
                    onReply={() => {
                        setReply(menu.message)
                        setEditing(null)
                        setMenu(null)
                    }}
                    onEdit={() => {
                        setEditing(menu.message)
                        setReply(null)
                        setMenu(null)
                    }}
                    onDelete={() => {
                        if (confirm('Delete this message for everyone?'))
                            void deleteMessage(conv.id, menu.message.id)
                        setMenu(null)
                    }}
                />
            )}
        </Flex>
    )
}
