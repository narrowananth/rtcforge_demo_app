import { Box, Stack, Text } from '@chakra-ui/react'
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'

type ToastKind = 'info' | 'error' | 'success'
interface Toast {
    id: number
    kind: ToastKind
    message: string
}

interface ToastApi {
    show: (message: string, kind?: ToastKind) => void
    error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([])

    const show = useCallback((message: string, kind: ToastKind = 'info') => {
        const id = Date.now() + Math.floor(Math.random() * 1000)
        setToasts((prev) => [...prev, { id, kind, message }])
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3800)
    }, [])

    const error = useCallback((message: string) => show(message, 'error'), [show])

    return (
        <ToastContext.Provider value={{ show, error }}>
            {children}
            <Stack
                position="fixed"
                top="4"
                left="50%"
                transform="translateX(-50%)"
                zIndex={2000}
                gap="2"
            >
                {toasts.map((t) => (
                    <Box
                        key={t.id}
                        px="4"
                        py="2.5"
                        borderRadius="lg"
                        boxShadow="lg"
                        bg={
                            t.kind === 'error'
                                ? 'danger.solid'
                                : t.kind === 'success'
                                  ? 'accent.emphasis'
                                  : 'bg.panel.raised'
                        }
                        color={t.kind === 'info' ? 'fg.default' : 'white'}
                    >
                        <Text fontSize="sm" fontWeight="medium">
                            {t.message}
                        </Text>
                    </Box>
                ))}
            </Stack>
        </ToastContext.Provider>
    )
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used within ToastProvider')
    return ctx
}
