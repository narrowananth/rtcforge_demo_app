import { Box, Center } from '@chakra-ui/react'
import { initials } from '../../shared/utils'

interface AvatarProps {
    name: string
    color?: string | null
    size?: number
    online?: boolean | null
    fontSize?: string
}

export function Avatar({ name, color, size = 40, online, fontSize }: AvatarProps) {
    return (
        <Box position="relative" flex="none" width={`${size}px`} height={`${size}px`}>
            <Center
                width="100%"
                height="100%"
                borderRadius="full"
                bg={color ?? 'ink.500'}
                color="white"
                fontWeight="bold"
                fontSize={fontSize ?? `${Math.round(size * 0.4)}px`}
                userSelect="none"
            >
                {initials(name)}
            </Center>
            {online != null && (
                <Box
                    position="absolute"
                    right="-1px"
                    bottom="-1px"
                    width={`${Math.max(10, size * 0.28)}px`}
                    height={`${Math.max(10, size * 0.28)}px`}
                    borderRadius="full"
                    bg={online ? 'accent.solid' : 'fg.muted'}
                    borderWidth="2px"
                    borderColor="bg.panel"
                />
            )}
        </Box>
    )
}
