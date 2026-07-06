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

    // The <video> is always mounted (see below), so binding srcObject on stream
    // change is enough — no remount to miss. A video track added later to the SAME
    // stream then shows up without needing srcObject to be reassigned.
    useEffect(() => {
        if (videoRef.current && videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream
        }
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
            {/* Always mount the media element so its audio track plays even when
                there is no video (audio-only calls). Hide it behind the avatar when
                the stream carries no video track. */}
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
                    display: hasVideo ? 'block' : 'none',
                }}
            />
            {!hasVideo && (
                <Center position="absolute" inset="0">
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
