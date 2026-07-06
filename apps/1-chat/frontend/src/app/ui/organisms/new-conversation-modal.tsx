import { Box, Button, Checkbox, Flex, Input, Stack, Text } from '@chakra-ui/react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/auth-context'
import { useChat } from '../../contexts/chat-context'
import { useToast } from '../../contexts/toast-context'
import { loadKnownPeople } from '../../features/contacts/application/known-people'
import { contactGateway } from '../../features/contacts/infrastructure/contact-gateway'
import type { PublicUser } from '../../shared/types'
import { Avatar } from '../atoms/avatar'
import { Modal } from '../atoms/modal'

type Mode = 'dm' | 'group' | 'broadcast'

export function NewConversationModal({ onClose }: { onClose: () => void }) {
    const { user } = useAuth()
    const { state, open, startDm, createGroup, createBroadcast } = useChat()
    const toast = useToast()
    const [mode, setMode] = useState<Mode>('dm')
    const [people, setPeople] = useState<PublicUser[]>([])
    const [username, setUsername] = useState('')
    const [title, setTitle] = useState('')
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)

    const conversations = useMemo(() => Object.values(state.conversations), [state.conversations])

    useEffect(() => {
        if (!user) return
        void loadKnownPeople(conversations, user.id).then(setPeople)
    }, [conversations, user])

    const openAndClose = async (id: string) => {
        await open(id)
        onClose()
    }

    const startDirect = async (targetId?: string) => {
        setBusy(true)
        try {
            let id = targetId
            if (!id) {
                if (!username.trim()) throw new Error('Enter a username')
                const { user: found } = await contactGateway.search(username.trim())
                await contactGateway.add(username.trim()).catch(() => undefined)
                id = found.id
            }
            await openAndClose(await startDm(id))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not start chat')
        } finally {
            setBusy(false)
        }
    }

    const createMany = async () => {
        setBusy(true)
        try {
            if (mode === 'group' && !title.trim()) throw new Error('Enter a group name')
            if (picked.size === 0) throw new Error('Select at least one member')
            const memberIds = [...picked]
            const id =
                mode === 'group'
                    ? await createGroup(title.trim(), memberIds)
                    : await createBroadcast(title.trim() || 'Broadcast list', memberIds)
            await openAndClose(id)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not create')
        } finally {
            setBusy(false)
        }
    }

    const toggle = (id: string) =>
        setPicked((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    return (
        <Modal title="New conversation" onClose={onClose}>
            <Flex gap="2" mb="4">
                {(['dm', 'group', 'broadcast'] as Mode[]).map((m) => (
                    <Button
                        key={m}
                        flex="1"
                        size="sm"
                        variant={mode === m ? 'solid' : 'outline'}
                        colorPalette={mode === m ? 'green' : 'gray'}
                        onClick={() => setMode(m)}
                    >
                        {m === 'dm' ? 'Direct' : m === 'group' ? 'Group' : 'Broadcast'}
                    </Button>
                ))}
            </Flex>

            {mode === 'dm' ? (
                <Stack gap="3">
                    <Text fontSize="sm" color="fg.muted">
                        Start a direct chat
                    </Text>
                    <Flex gap="2">
                        <Input
                            placeholder="username to message"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                        <Button
                            colorPalette="green"
                            loading={busy}
                            onClick={() => void startDirect()}
                        >
                            Start
                        </Button>
                    </Flex>
                    {people.length > 0 && (
                        <>
                            <Text fontSize="sm" color="fg.muted">
                                People
                            </Text>
                            <Stack
                                maxHeight="260px"
                                overflowY="auto"
                                borderWidth="1px"
                                borderColor="border.subtle"
                                borderRadius="lg"
                                p="1"
                            >
                                {people.map((p) => (
                                    <Flex
                                        key={p.id}
                                        align="center"
                                        gap="3"
                                        p="2"
                                        borderRadius="md"
                                        cursor="pointer"
                                        _hover={{ bg: 'bg.hover' }}
                                        onClick={() => void startDirect(p.id)}
                                    >
                                        <Avatar
                                            name={p.displayName}
                                            color={p.avatarColor}
                                            size={30}
                                        />
                                        <Box>
                                            <Text>{p.displayName}</Text>
                                            <Text fontSize="xs" color="fg.muted">
                                                @{p.username}
                                            </Text>
                                        </Box>
                                    </Flex>
                                ))}
                            </Stack>
                        </>
                    )}
                </Stack>
            ) : (
                <Stack gap="3">
                    <Input
                        placeholder={mode === 'group' ? 'Group name' : 'Broadcast list name'}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                    <Text fontSize="sm" color="fg.muted">
                        Select members
                    </Text>
                    <Stack
                        maxHeight="260px"
                        overflowY="auto"
                        borderWidth="1px"
                        borderColor="border.subtle"
                        borderRadius="lg"
                        p="1"
                    >
                        {people.length === 0 && (
                            <Text fontSize="sm" color="fg.muted" p="2">
                                Start a direct chat with someone first, then you can group them.
                            </Text>
                        )}
                        {people.map((p) => (
                            <Flex key={p.id} align="center" gap="3" p="2">
                                <Checkbox.Root
                                    checked={picked.has(p.id)}
                                    onCheckedChange={() => toggle(p.id)}
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
                        <Button variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            colorPalette="green"
                            loading={busy}
                            onClick={() => void createMany()}
                        >
                            Create
                        </Button>
                    </Flex>
                </Stack>
            )}
        </Modal>
    )
}
