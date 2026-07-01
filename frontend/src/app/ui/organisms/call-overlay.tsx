import { Box, Center, Flex, Text } from '@chakra-ui/react'
import {
    Check,
    Mic,
    MicOff,
    Monitor,
    MonitorOff,
    Phone,
    PhoneOff,
    Video,
    VideoOff,
    X,
} from 'lucide-react'
import { useCall } from '../../contexts/call-context'
import { initials } from '../../shared/utils'
import { VideoTile } from '../molecules/video-tile'

function RoundButton({
    children,
    color = 'bg.panel.raised',
    onClick,
    label,
}: {
    children: React.ReactNode
    color?: string
    onClick: () => void
    label: string
}) {
    return (
        <Center
            as="button"
            aria-label={label}
            title={label}
            width="60px"
            height="60px"
            borderRadius="full"
            bg={color}
            color="white"
            _hover={{ filter: 'brightness(1.15)' }}
            onClick={onClick}
        >
            {children}
        </Center>
    )
}

export function CallOverlay() {
    const { ui, acceptCall, declineCall, endCall, toggleMute, toggleCam, toggleScreen } = useCall()
    if (ui.mode === 'idle') return null

    const incoming = ui.mode === 'incoming'

    return (
        <Flex
            position="fixed"
            inset="0"
            zIndex={1800}
            direction="column"
            align="center"
            justify="center"
            bg="#05080a"
            gap="5"
        >
            {ui.status && (
                <Text position="absolute" top="6" color="fg.muted">
                    {ui.status}
                </Text>
            )}

            {incoming ? (
                <Flex direction="column" align="center" gap="2">
                    <Center
                        width="110px"
                        height="110px"
                        borderRadius="full"
                        bg={ui.peerAvatar}
                        fontSize="4xl"
                        fontWeight="bold"
                    >
                        {initials(ui.peerName)}
                    </Center>
                    <Text fontSize="2xl" fontWeight="bold" mt="2">
                        {ui.peerName}
                    </Text>
                    <Text color="fg.muted">
                        {ui.media === 'video' ? 'Incoming video call' : 'Incoming voice call'}
                    </Text>
                    <Flex gap="6" mt="6">
                        <RoundButton label="Decline" color="danger.solid" onClick={declineCall}>
                            <X size={24} />
                        </RoundButton>
                        <RoundButton
                            label="Accept"
                            color="accent.solid"
                            onClick={() => void acceptCall()}
                        >
                            <Check size={24} />
                        </RoundButton>
                    </Flex>
                </Flex>
            ) : (
                <>
                    <Flex wrap="wrap" gap="3" align="center" justify="center" maxWidth="92vw">
                        {ui.localStream && <VideoTile stream={ui.localStream} label="You" self />}
                        {ui.localScreen && (
                            <VideoTile stream={ui.localScreen} label="Your screen" self />
                        )}
                        {ui.remotes.map((r) => (
                            <VideoTile key={r.peerId} stream={r.stream} label={r.name} />
                        ))}
                        {ui.remotes.length === 0 && (
                            <Center
                                width={{ base: '44vw', md: '340px' }}
                                css={{ aspectRatio: '4 / 3' }}
                            >
                                <Box textAlign="center" color="fg.muted">
                                    <Phone size={40} />
                                    <Text mt="2">Ringing…</Text>
                                </Box>
                            </Center>
                        )}
                    </Flex>

                    <Flex gap="6" position="absolute" bottom="10">
                        <RoundButton
                            label="Mute"
                            color={ui.micOn ? 'bg.panel.raised' : 'white'}
                            onClick={toggleMute}
                        >
                            {ui.micOn ? (
                                <Mic size={22} color="white" />
                            ) : (
                                <MicOff size={22} color="#111" />
                            )}
                        </RoundButton>
                        {ui.media === 'video' && (
                            <RoundButton
                                label="Camera"
                                color={ui.camOn ? 'bg.panel.raised' : 'white'}
                                onClick={toggleCam}
                            >
                                {ui.camOn ? (
                                    <Video size={22} color="white" />
                                ) : (
                                    <VideoOff size={22} color="#111" />
                                )}
                            </RoundButton>
                        )}
                        <RoundButton
                            label="Share screen"
                            color={ui.sharing ? 'white' : 'bg.panel.raised'}
                            onClick={() => void toggleScreen()}
                        >
                            {ui.sharing ? (
                                <MonitorOff size={22} color="#111" />
                            ) : (
                                <Monitor size={22} color="white" />
                            )}
                        </RoundButton>
                        <RoundButton label="Hang up" color="danger.solid" onClick={endCall}>
                            <PhoneOff size={22} />
                        </RoundButton>
                    </Flex>
                </>
            )}
        </Flex>
    )
}
