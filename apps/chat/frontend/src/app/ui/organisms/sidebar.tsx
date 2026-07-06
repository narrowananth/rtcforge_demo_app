import { Box, Flex, Input, Stack, Text } from '@chakra-ui/react'
import { Power, SquarePen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/auth-context'
import { useChat } from '../../contexts/chat-context'
import { Avatar } from '../atoms/avatar'
import { IconChip } from '../atoms/icon-chip'
import { ChatListItem } from '../molecules/chat-list-item'

export function Sidebar({ onNewChat }: { onNewChat: () => void }) {
    const { user, logout } = useAuth()
    const { state, open } = useChat()
    const [query, setQuery] = useState('')

    const conversations = useMemo(() => {
        const list = Object.values(state.conversations)
        return list
            .filter((c) => !query || c.title.toLowerCase().includes(query.toLowerCase()))
            .sort(
                (a, b) =>
                    (b.lastMessage?.ts ?? b.updatedAt ?? 0) -
                    (a.lastMessage?.ts ?? a.updatedAt ?? 0),
            )
    }, [state.conversations, query])

    if (!user) return null

    return (
        <Flex
            direction="column"
            height="100%"
            bg="bg.panel"
            borderRightWidth="1px"
            borderColor="border.subtle"
            minWidth="0"
        >
            <Flex align="center" justify="space-between" px="3.5" py="3" bg="bg.panel.raised">
                <Flex align="center" gap="2.5" minWidth="0">
                    <Avatar name={user.displayName} color={user.avatarColor} />
                    <Box minWidth="0">
                        <Text fontWeight="semibold" truncate>
                            {user.displayName}
                        </Text>
                        <Text fontSize="xs" color="fg.muted" truncate>
                            @{user.username}
                        </Text>
                    </Box>
                </Flex>
                <Flex gap="0.5">
                    <IconChip label="New chat" onClick={onNewChat}>
                        <SquarePen size={20} />
                    </IconChip>
                    <IconChip label="Log out" onClick={logout}>
                        <Power size={20} />
                    </IconChip>
                </Flex>
            </Flex>

            <Box px="3" py="2">
                <Input
                    size="sm"
                    variant="subtle"
                    bg="bg.hover"
                    borderRadius="lg"
                    placeholder="Search chats"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </Box>

            <Stack flex="1" minHeight="0" overflowY="auto" gap="0">
                {conversations.length === 0 && (
                    <Text color="fg.muted" fontSize="sm" textAlign="center" mt="8">
                        No chats yet. Start one with the ✎ button.
                    </Text>
                )}
                {conversations.map((c) => (
                    <ChatListItem
                        key={c.id}
                        conversation={c}
                        active={c.id === state.activeId}
                        online={
                            c.type === 'dm' && c.otherUser
                                ? Boolean(state.presence[c.otherUser.id])
                                : null
                        }
                        unread={state.unread[c.id] ?? 0}
                        onClick={() => void open(c.id)}
                    />
                ))}
            </Stack>
        </Flex>
    )
}
