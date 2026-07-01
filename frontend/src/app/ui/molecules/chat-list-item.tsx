import { Badge, Box, Flex, Text } from '@chakra-ui/react'
import type { Conversation } from '../../shared/types'
import { formatTime } from '../../shared/utils'
import { Avatar } from '../atoms/avatar'

interface ChatListItemProps {
    conversation: Conversation
    active: boolean
    online: boolean | null
    unread: number
    onClick: () => void
}

export function ChatListItem({
    conversation: c,
    active,
    online,
    unread,
    onClick,
}: ChatListItemProps) {
    const preview = c.lastMessage
        ? `${c.type === 'group' && c.lastMessage.senderName ? `${c.lastMessage.senderName}: ` : ''}${c.lastMessage.preview}`
        : 'No messages yet'

    return (
        <Flex
            data-testid="chat-row"
            gap="3"
            px="3.5"
            py="2.5"
            align="center"
            cursor="pointer"
            borderBottomWidth="1px"
            borderColor="border.subtle"
            bg={active ? 'bg.panel.raised' : 'transparent'}
            _hover={{ bg: active ? 'bg.panel.raised' : 'bg.panel' }}
            onClick={onClick}
        >
            <Avatar
                name={c.title}
                color={c.avatarColor}
                online={c.type === 'dm' ? online : undefined}
            />
            <Box flex="1" minWidth="0">
                <Flex justify="space-between" gap="2">
                    <Flex align="center" gap="1.5" minWidth="0">
                        <Text fontWeight="semibold" truncate>
                            {c.title}
                        </Text>
                        {c.type !== 'dm' && (
                            <Text
                                fontSize="2xs"
                                textTransform="uppercase"
                                color="fg.muted"
                                borderWidth="1px"
                                borderColor="border.subtle"
                                borderRadius="sm"
                                px="1"
                            >
                                {c.type}
                            </Text>
                        )}
                    </Flex>
                    <Text fontSize="xs" color="fg.muted" flex="none">
                        {c.lastMessage ? formatTime(c.lastMessage.ts) : ''}
                    </Text>
                </Flex>
                <Flex justify="space-between" align="center" gap="2">
                    <Text fontSize="sm" color="fg.muted" truncate>
                        {preview}
                    </Text>
                    {unread > 0 && (
                        <Badge
                            bg="accent.solid"
                            color="ink.900"
                            borderRadius="full"
                            px="2"
                            fontSize="2xs"
                        >
                            {unread}
                        </Badge>
                    )}
                </Flex>
            </Box>
        </Flex>
    )
}
