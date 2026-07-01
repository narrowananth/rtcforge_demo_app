import { Center, Spinner } from '@chakra-ui/react'
import { AuthProvider, useAuth } from './app/contexts/auth-context'
import { CallProvider } from './app/contexts/call-context'
import { ChakraProvider } from './app/contexts/chakra-context'
import { ChatProvider } from './app/contexts/chat-context'
import { QueryProvider } from './app/contexts/query-context'
import { RealtimeProvider } from './app/contexts/realtime-context'
import { ToastProvider } from './app/contexts/toast-context'
import { AuthPage } from './app/page/auth-page'
import { ChatPage } from './app/page/chat-page'

function Router() {
    const { ready, user } = useAuth()
    if (!ready) {
        return (
            <Center height="100%">
                <Spinner size="lg" color="accent.solid" />
            </Center>
        )
    }
    return user ? <ChatPage /> : <AuthPage />
}

export default function App() {
    return (
        <ChakraProvider>
            <QueryProvider>
                <ToastProvider>
                    <AuthProvider>
                        <RealtimeProvider>
                            <ChatProvider>
                                <CallProvider>
                                    <Router />
                                </CallProvider>
                            </ChatProvider>
                        </RealtimeProvider>
                    </AuthProvider>
                </ToastProvider>
            </QueryProvider>
        </ChakraProvider>
    )
}
