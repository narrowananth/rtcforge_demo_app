import { Box, Center, Flex, Text } from '@chakra-ui/react'
import { useEffect, useRef } from 'react'
import { initials } from '../../shared/utils'

interface VideoTileProps {
    stream: MediaStream
    label: string
    self?: boolean
    color?: string
}

export function VideoTile({ stream, label, self, color }: VideoTileProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const hasVideo = stream.getVideoTracks().length > 0

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
    }, [stream])

    return (
        <Box
            position="relative"
            width={{ base: '44vw', md: '340px' }}
            css={{ aspectRatio: '4 / 3' }}
            bg="ink.850"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="xl"
            overflow="hidden"
        >
            {hasVideo ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={self}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: self ? 'scaleX(-1)' : undefined,
                    }}
                />
            ) : (
                <Center width="100%" height="100%">
                    <Center
                        width="84px"
                        height="84px"
                        borderRadius="full"
                        bg={color ?? 'ink.600'}
                        fontSize="2xl"
                        fontWeight="bold"
                    >
                        {initials(label)}
                    </Center>
                </Center>
            )}
            <Flex
                position="absolute"
                bottom="2"
                left="2.5"
                bg="blackAlpha.600"
                px="2"
                py="0.5"
                borderRadius="md"
            >
                <Text fontSize="sm">{label}</Text>
            </Flex>
        </Box>
    )
}
