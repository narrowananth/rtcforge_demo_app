import { Box, Flex, Text } from '@chakra-ui/react'
import { Paperclip } from 'lucide-react'
import type { Message } from '../../shared/types'
import { mediaSource } from '../../shared/utils'

interface MediaViewProps {
    message: Message
    p2pBlobs: Record<string, string>
}

const mediaStyle: React.CSSProperties = {
    width: 'min(300px, 68vw)',
    maxHeight: 340,
    height: 'auto',
    borderRadius: 8,
    display: 'block',
    cursor: 'pointer',
}

export function MediaView({ message, p2pBlobs }: MediaViewProps) {
    const att = message.attachment
    if (!att) return null
    const src = mediaSource(att, new Map(Object.entries(p2pBlobs)))

    if (!src) {
        return (
            <Flex align="center" gap="3" bg="blackAlpha.400" px="3" py="2" borderRadius="md">
                <Paperclip size={20} />
                <Box>
                    <Text fontWeight="semibold" wordBreak="break-all">
                        {att.filename}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                        {att.p2p ? 'sent peer-to-peer' : 'unavailable'}
                    </Text>
                </Box>
            </Flex>
        )
    }

    if (message.type === 'image') {
        return (
            <button
                type="button"
                onClick={() => window.open(src, '_blank')}
                style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            >
                <img src={src} loading="lazy" style={mediaStyle} alt={att.filename} />
            </button>
        )
    }
    if (message.type === 'video') {
        return (
            <video src={src} controls style={mediaStyle}>
                <track kind="captions" />
            </video>
        )
    }
    if (message.type === 'audio') {
        return (
            <audio src={src} controls style={{ width: 250, maxWidth: '62vw' }}>
                <track kind="captions" />
            </audio>
        )
    }
    return (
        <a
            href={src}
            download={att.filename}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
        >
            <Flex align="center" gap="3" bg="blackAlpha.400" px="3" py="2" borderRadius="md">
                <Paperclip size={20} />
                <Box>
                    <Text fontWeight="semibold" wordBreak="break-all">
                        {att.filename}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                        {att.size ? `${Math.round(att.size / 1024)} KB` : ''}
                        {att.p2p ? ' · P2P' : ''}
                    </Text>
                </Box>
            </Flex>
        </a>
    )
}
