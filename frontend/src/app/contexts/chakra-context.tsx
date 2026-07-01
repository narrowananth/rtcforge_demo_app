import { ChakraProvider as BaseChakraProvider } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { system } from '../styles/themes/theme'

export function ChakraProvider({ children }: { children: ReactNode }) {
    return <BaseChakraProvider value={system}>{children}</BaseChakraProvider>
}
