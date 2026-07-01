import { Box, Flex, Heading } from '@chakra-ui/react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconChip } from './icon-chip'

interface ModalProps {
    title: string
    onClose: () => void
    children: ReactNode
    footer?: ReactNode
}

/** Lightweight centered modal (avoids Chakra v3 Dialog boilerplate). */
export function Modal({ title, onClose, children, footer }: ModalProps) {
    return (
        <Flex
            position="fixed"
            inset="0"
            zIndex={1500}
            align="center"
            justify="center"
            bg="blackAlpha.700"
            onClick={onClose}
        >
            <Box
                width="420px"
                maxWidth="92vw"
                maxHeight="84vh"
                overflowY="auto"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border.subtle"
                borderRadius="xl"
                p="5"
                onClick={(e) => e.stopPropagation()}
            >
                <Flex align="center" justify="space-between" mb="4">
                    <Heading size="md">{title}</Heading>
                    <IconChip label="Close" onClick={onClose}>
                        <X size={18} />
                    </IconChip>
                </Flex>
                {children}
                {footer && (
                    <Flex justify="flex-end" gap="2" mt="4">
                        {footer}
                    </Flex>
                )}
            </Box>
        </Flex>
    )
}
