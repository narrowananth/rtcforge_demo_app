import { Grid } from '@chakra-ui/react'
import { useState } from 'react'
import { useChat } from '../contexts/chat-context'
import { CallOverlay } from '../ui/organisms/call-overlay'
import { ConversationInfoModal } from '../ui/organisms/conversation-info-modal'
import { ConversationPane } from '../ui/organisms/conversation-pane'
import { NewConversationModal } from '../ui/organisms/new-conversation-modal'
import { Sidebar } from '../ui/organisms/sidebar'

export function ChatPage() {
    const { state } = useChat()
    const [newOpen, setNewOpen] = useState(false)
    const [infoOpen, setInfoOpen] = useState(false)

    return (
        <>
            <Grid
                templateColumns={{ base: '1fr', md: 'minmax(300px, 30%) 1fr' }}
                templateRows="minmax(0, 1fr)"
                height="100dvh"
                overflow="hidden"
            >
                <Sidebar onNewChat={() => setNewOpen(true)} />
                <ConversationPane onOpenInfo={() => setInfoOpen(true)} />
            </Grid>

            <CallOverlay />
            {newOpen && <NewConversationModal onClose={() => setNewOpen(false)} />}
            {infoOpen && state.activeId && (
                <ConversationInfoModal convId={state.activeId} onClose={() => setInfoOpen(false)} />
            )}
        </>
    )
}
