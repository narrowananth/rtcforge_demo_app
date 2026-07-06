import { IconButton, type IconButtonProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

interface IconChipProps extends Omit<IconButtonProps, 'aria-label'> {
    label: string
    children: ReactNode
}

/** Ghost round icon button used across headers and the composer. */
export function IconChip({ label, children, ...rest }: IconChipProps) {
    return (
        <IconButton
            aria-label={label}
            title={label}
            variant="ghost"
            size="sm"
            borderRadius="full"
            color="fg.muted"
            _hover={{ bg: 'bg.hover', color: 'fg.default' }}
            {...rest}
        >
            {children}
        </IconButton>
    )
}
