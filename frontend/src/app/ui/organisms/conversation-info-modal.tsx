import { Box, Button, Checkbox, Flex, Stack, Text } from '@chakra-ui/react'
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/auth-context'
import { useChat } from '../../contexts/chat-context'
import { useToast } from '../../contexts/toast-context'
import { loadKnownPeople } from '../../features/contacts/application/known-people'
import type { PublicUser } from '../../shared/types'
import { Avatar } from '../atoms/avatar'
import { IconChip } from '../atoms/icon-chip'
import { Modal } from '../atoms/modal'

export function ConversationInfoModal({
    convId,
    onClose,
}: {
    convId: string
    onClose: () => void
}) {
    const { user } = useAuth()
    const { state, addMembers, removeMember } = useChat()
    const toast = useToast()
    const conv = state.conversations[convId]
    const [adding, setAdding] = useState(false)
    const [candidates, setCandidates] = useState<PublicUser[]>([])
    const [picked, setPicked] = useState<Set<string>>(new Set())

    const conversations = useMemo(() => Object.values(state.conversations), [state.conversations])

    useEffect(() => {
        if (!adding || !user) return
        void loadKnownPeople(conversations, user.id).then((people) =>
            setCandidates(people.filter((p) => !conv?.members.some((m) => m.id === p.id))),
        )
    }, [adding, conversations, user, conv])

    if (!conv || !user) return null
    const isAdmin = conv.admins.includes(user.id)

    const doAdd = async () => {
        try {
            await addMembers(convId, [...picked])
            setAdding(false)
            setPicked(new Set())
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not add members')
        }
    }

    const doRemove = async (userId: string) => {
        try {
            await removeMember(convId, userId)
            if (userId === user.id) onClose()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not remove')
        }
    }

    return (
        <Modal title={conv.title} onClose={onClose}>
            <Text fontSize="sm" color="fg.muted" mb="3">
                {conv.type.toUpperCase()} · {conv.members.length}{' '}
                {conv.type === 'broadcast' ? 'recipients' : 'members'}
            </Text>

            {adding ? (
                <Stack gap="2">
                    <Text fontSize="sm" color="fg.muted">
                        Add members
                    </Text>
                    <Stack
                        maxHeight="260px"
                        overflowY="auto"
                        borderWidth="1px"
                        borderColor="border.subtle"
                        borderRadius="lg"
                        p="1"
                    >
                        {candidates.length === 0 && (
                            <Text fontSize="sm" color="fg.muted" p="2">
                                No contacts to add.
                            </Text>
                        )}
                        {candidates.map((p) => (
                            <Flex key={p.id} align="center" gap="3" p="2">
                                <Checkbox.Root
                                    checked={picked.has(p.id)}
                                    onCheckedChange={() =>
                                        setPicked((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(p.id)) next.delete(p.id)
                                            else next.add(p.id)
                                            return next
                                        })
                                    }
                                >
                                    <Checkbox.HiddenInput />
                                    <Checkbox.Control />
                                </Checkbox.Root>
                                <Avatar name={p.displayName} color={p.avatarColor} size={30} />
                                <Text>{p.displayName}</Text>
                            </Flex>
                        ))}
                    </Stack>
                    <Flex justify="flex-end" gap="2">
                        <Button variant="outline" onClick={() => setAdding(false)}>
                            Back
                        </Button>
                        <Button colorPalette="green" onClick={() => void doAdd()}>
                            Add
                        </Button>
                    </Flex>
                </Stack>
            ) : (
                <>
                    <Stack
                        maxHeight="300px"
                        overflowY="auto"
                        borderWidth="1px"
                        borderColor="border.subtle"
                        borderRadius="lg"
                        p="1"
                    >
                        {conv.members.map((m) => (
                            <Flex key={m.id} align="center" gap="3" p="2">
                                <Avatar name={m.displayName} color={m.avatarColor} size={30} />
                                <Box flex="1">
                                    <Text>
                                        {m.displayName}
                                        {m.id === user.id ? ' (You)' : ''}
                                    </Text>
                                    <Text fontSize="xs" color="fg.muted">
                                        {conv.admins.includes(m.id) ? 'admin' : `@${m.username}`}
                                    </Text>
                                </Box>
                                {conv.type === 'group' && isAdmin && m.id !== user.id && (
                                    <IconChip label="Remove" onClick={() => void doRemove(m.id)}>
                                        <X size={16} />
                                    </IconChip>
                                )}
                            </Flex>
                        ))}
                    </Stack>
                    <Flex justify="flex-end" gap="2" mt="4">
                        {conv.type === 'group' && isAdmin && (
                            <Button variant="outline" onClick={() => setAdding(true)}>
                                Add members
                            </Button>
                        )}
                        {conv.type === 'group' && (
                            <Button
                                variant="outline"
                                colorPalette="red"
                                onClick={() => void doRemove(user.id)}
                            >
                                Leave
                            </Button>
                        )}
                        <Button colorPalette="green" onClick={onClose}>
                            Close
                        </Button>
                    </Flex>
                </>
            )}
        </Modal>
    )
}
