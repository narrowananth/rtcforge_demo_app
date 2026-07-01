import { Flex, Text } from '@chakra-ui/react'

interface ReactionBarProps {
    reactions: Record<string, string[]>
    meId: string
    onToggle: (emoji: string) => void
}

export function ReactionBar({ reactions, meId, onToggle }: ReactionBarProps) {
    const keys = Object.keys(reactions)
    if (keys.length === 0) return null
    return (
        <Flex gap="1" mt="1" wrap="wrap">
            {keys.map((emoji) => {
                const users = reactions[emoji]
                const mine = users.includes(meId)
                return (
                    <Flex
                        key={emoji}
                        align="center"
                        gap="1"
                        px="2"
                        borderRadius="full"
                        bg="bg.panel.raised"
                        borderWidth="1px"
                        borderColor={mine ? 'accent.solid' : 'border.subtle'}
                        cursor="pointer"
                        fontSize="xs"
                        onClick={() => onToggle(emoji)}
                    >
                        <Text as="span">{emoji}</Text>
                        <Text as="span" color="fg.muted">
                            {users.length}
                        </Text>
                    </Flex>
                )
            })}
        </Flex>
    )
}
