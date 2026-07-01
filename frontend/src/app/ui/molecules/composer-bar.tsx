import { Box, Flex, Grid, Input, Text } from '@chakra-ui/react'
import { Mic, Paperclip, Send, Smile, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EMOJIS } from '../../shared/emoji'
import { IconChip } from '../atoms/icon-chip'

interface Banner {
    title: string
    text: string
    onCancel: () => void
}

interface ComposerBarProps {
    prefill?: string
    banner?: Banner | null
    onSend: (text: string) => void
    onFile: (file: File) => void
}

export function ComposerBar({ prefill, banner, onSend, onFile }: ComposerBarProps) {
    const [text, setText] = useState('')
    const [emojiOpen, setEmojiOpen] = useState(false)
    const [recording, setRecording] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)
    const recorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])

    useEffect(() => {
        if (prefill !== undefined) setText(prefill)
    }, [prefill])

    const submit = () => {
        const value = text.replace(/\s+$/g, '')
        if (!value) return
        onSend(value)
        setText('')
    }

    const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) onFile(file)
        e.target.value = ''
    }

    const toggleRecord = async () => {
        if (recorderRef.current && recorderRef.current.state === 'recording') {
            recorderRef.current.stop()
            return
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const recorder = new MediaRecorder(stream)
            recorderRef.current = recorder
            chunksRef.current = []
            recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
            recorder.onstop = () => {
                for (const t of stream.getTracks()) t.stop()
                setRecording(false)
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
                if (blob.size > 0)
                    onFile(new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' }))
            }
            recorder.start()
            setRecording(true)
        } catch {
            /* mic unavailable */
        }
    }

    return (
        <Box borderTopWidth="1px" borderColor="border.subtle" bg="bg.panel.raised">
            {banner && (
                <Flex
                    align="center"
                    gap="2"
                    px="4"
                    py="2"
                    borderBottomWidth="1px"
                    borderColor="border.subtle"
                >
                    <Box flex="1" borderLeftWidth="3px" borderColor="accent.solid" pl="2">
                        <Text fontSize="xs" fontWeight="bold" color="fg.accent">
                            {banner.title}
                        </Text>
                        <Text fontSize="sm" color="fg.muted" lineClamp={1}>
                            {banner.text}
                        </Text>
                    </Box>
                    <IconChip label="Cancel" onClick={banner.onCancel}>
                        <X size={16} />
                    </IconChip>
                </Flex>
            )}
            <Flex align="center" gap="1.5" px="3" py="2.5" position="relative">
                <Box position="relative">
                    <IconChip label="Emoji" onClick={() => setEmojiOpen((v) => !v)}>
                        <Smile size={20} />
                    </IconChip>
                    {emojiOpen && (
                        <Grid
                            position="absolute"
                            bottom="48px"
                            left="0"
                            zIndex={30}
                            templateColumns="repeat(8, 1fr)"
                            bg="bg.panel.raised"
                            borderWidth="1px"
                            borderColor="border.subtle"
                            borderRadius="lg"
                            p="2"
                            boxShadow="lg"
                            width="300px"
                        >
                            {EMOJIS.map((e) => (
                                <Box
                                    key={e}
                                    as="button"
                                    fontSize="xl"
                                    p="1"
                                    borderRadius="md"
                                    _hover={{ bg: 'bg.hover' }}
                                    onClick={() => {
                                        setText((t) => t + e)
                                        setEmojiOpen(false)
                                    }}
                                >
                                    {e}
                                </Box>
                            ))}
                        </Grid>
                    )}
                </Box>
                <IconChip label="Attach" onClick={() => fileRef.current?.click()}>
                    <Paperclip size={20} />
                </IconChip>
                <IconChip
                    label="Record voice"
                    color={recording ? 'danger.solid' : undefined}
                    onClick={toggleRecord}
                >
                    {recording ? <Square size={18} /> : <Mic size={20} />}
                </IconChip>
                <Input
                    flex="1"
                    variant="subtle"
                    bg="bg.hover"
                    borderRadius="lg"
                    placeholder="Type a message"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            submit()
                        }
                    }}
                />
                <IconChip label="Send" color="fg.accent" onClick={submit}>
                    <Send size={20} />
                </IconChip>
                <input ref={fileRef} type="file" hidden onChange={pickFile} />
            </Flex>
        </Box>
    )
}
