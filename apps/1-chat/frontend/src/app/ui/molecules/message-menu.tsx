import { Box, Flex } from '@chakra-ui/react'
import { Pencil, Reply, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { QUICK_REACTIONS } from '../../shared/emoji'
import type { Message } from '../../shared/types'

interface MessageMenuProps {
    message: Message
    at: { x: number; y: number }
    canEdit: boolean
    canDelete: boolean
    onClose: () => void
    onReact: (emoji: string) => void
    onReply: () => void
    onEdit: () => void
    onDelete: () => void
}

export function MessageMenu({
    at,
    canEdit,
    canDelete,
    onClose,
    onReact,
    onReply,
    onEdit,
    onDelete,
}: MessageMenuProps) {
    useEffect(() => {
        const close = () => onClose()
        window.addEventListener('click', close)
        return () => window.removeEventListener('click', close)
    }, [onClose])

    const left = Math.min(at.x, window.innerWidth - 220)
    const top = Math.min(at.y + 6, window.innerHeight - 200)

    const Item = ({
        icon,
        label,
        danger,
        onClick,
    }: {
        icon: React.ReactNode
        label: string
        danger?: boolean
        onClick: () => void
    }) => (
        <Flex
            align="center"
            gap="2"
            px="3"
            py="2"
            borderRadius="md"
            cursor="pointer"
            color={danger ? 'danger.solid' : 'fg.default'}
            _hover={{ bg: 'bg.hover' }}
            onClick={onClick}
        >
            {icon}
            {label}
        </Flex>
    )

    return (
        <Box
            position="fixed"
            left={`${Math.max(10, left)}px`}
            top={`${Math.max(10, top)}px`}
            zIndex={1200}
            bg="bg.panel.raised"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="lg"
            boxShadow="lg"
            minWidth="190px"
            p="1"
            onClick={(e) => e.stopPropagation()}
        >
            <Flex gap="0.5" px="1" pb="1" borderBottomWidth="1px" borderColor="border.subtle">
                {QUICK_REACTIONS.map((e) => (
                    <Box
                        key={e}
                        as="button"
                        fontSize="xl"
                        p="1"
                        borderRadius="md"
                        _hover={{ bg: 'bg.hover' }}
                        onClick={() => {
                            onReact(e)
                            onClose()
                        }}
                    >
                        {e}
                    </Box>
                ))}
            </Flex>
            <Item icon={<Reply size={16} />} label="Reply" onClick={onReply} />
            {canEdit && <Item icon={<Pencil size={16} />} label="Edit" onClick={onEdit} />}
            {canDelete && (
                <Item icon={<Trash2 size={16} />} label="Delete" danger onClick={onDelete} />
            )}
        </Box>
    )
}
