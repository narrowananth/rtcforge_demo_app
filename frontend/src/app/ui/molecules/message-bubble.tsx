import { Box, Flex, Text } from '@chakra-ui/react'
import { ChevronDown } from 'lucide-react'
import type { Message } from '../../shared/types'
import { formatTime } from '../../shared/utils'
import { MediaView } from './media-view'
import { ReactionBar } from './reaction-bar'

interface MessageBubbleProps {
    message: Message
    grouped: boolean
    isGroup: boolean
    meId: string
    p2pBlobs: Record<string, string>
    onOpenMenu: (message: Message, at: { x: number; y: number }) => void
    onToggleReaction: (message: Message, emoji: string) => void
}

export function MessageBubble({
    message: m,
    grouped,
    isGroup,
    meId,
    p2pBlobs,
    onOpenMenu,
    onToggleReaction,
}: MessageBubbleProps) {
    const out = m.senderId === meId
    const showSender = !out && isGroup && !grouped
    const isMedia = !m.deletedAt && !!m.attachment && (m.type === 'image' || m.type === 'video')

    return (
        <Flex
            role="group"
            direction="column"
            alignSelf={out ? 'flex-end' : 'flex-start'}
            position="relative"
            maxWidth={{ base: '82%', md: 'min(70%, 560px)' }}
            mt={grouped ? '1px' : '1.5'}
            px={isMedia ? '1' : '2.5'}
            py={isMedia ? '1' : '1.5'}
            borderRadius="lg"
            bg={out ? 'bubble.out' : 'bubble.in'}
        >
            {showSender && (
                <Text fontSize="xs" fontWeight="bold" mb="0.5" style={{ color: m.senderAvatar }}>
                    {m.senderName}
                </Text>
            )}

            {m.replyPreview && (
                <Box
                    borderLeftWidth="3px"
                    borderColor="accent.solid"
                    bg="blackAlpha.400"
                    px="2"
                    py="1"
                    borderRadius="sm"
                    mb="1"
                >
                    <Text fontSize="xs" fontWeight="bold" color="fg.accent">
                        {m.replyPreview.senderName}
                    </Text>
                    <Text fontSize="sm" color="fg.muted" lineClamp={2}>
                        {m.replyPreview.preview}
                    </Text>
                </Box>
            )}

            {m.deletedAt ? (
                <Text fontStyle="italic" color="fg.muted">
                    🚫 This message was deleted
                </Text>
            ) : (
                <>
                    {m.attachment && <MediaView message={m} p2pBlobs={p2pBlobs} />}
                    {m.text && (
                        <Text whiteSpace="pre-wrap" wordBreak="break-word" lineHeight="1.4">
                            {m.text}
                        </Text>
                    )}
                    <Flex
                        gap="1"
                        align="center"
                        justify="flex-end"
                        fontSize="2xs"
                        color="fg.muted"
                        mt="0.5"
                        position={isMedia ? 'absolute' : 'static'}
                        right={isMedia ? '2' : undefined}
                        bottom={isMedia ? '2' : undefined}
                        bg={isMedia ? 'blackAlpha.500' : undefined}
                        px={isMedia ? '1.5' : undefined}
                        borderRadius={isMedia ? 'sm' : undefined}
                    >
                        {m.editedAt && <Text as="span">edited</Text>}
                        <Text as="span">{formatTime(m.ts)}</Text>
                    </Flex>
                    <ReactionBar
                        reactions={m.reactions}
                        meId={meId}
                        onToggle={(e) => onToggleReaction(m, e)}
                    />
                    <Box
                        position="absolute"
                        top="1"
                        right="1"
                        opacity="0"
                        _groupHover={{ opacity: 1 }}
                        cursor="pointer"
                        color="fg.muted"
                        onClick={(e) => {
                            e.stopPropagation()
                            onOpenMenu(m, { x: e.clientX, y: e.clientY })
                        }}
                    >
                        <ChevronDown size={16} />
                    </Box>
                </>
            )}
        </Flex>
    )
}
