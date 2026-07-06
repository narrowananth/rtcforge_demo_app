import { type FormEvent, useEffect, useRef, useState } from 'react'
import { MessageType, type Room } from 'rtcforge/client'

interface ChatLine {
    id: number
    from: string
    name: string
    text: string
}

/**
 * Live chat over the room's `chat` broadcast channel. The signaling channel is a
 * fast, authenticated, room-scoped message bus — no media, no extra server.
 */
export function Chat({ room, myName }: { room: Room; myName: string }) {
    const [lines, setLines] = useState<ChatLine[]>([])
    const [text, setText] = useState('')
    const seq = useRef(0)
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onBroadcast = (from: string, channel: string, data: unknown) => {
            if (channel !== 'chat') return
            const d = data as { name?: string; text?: string }
            if (!d?.text) return
            setLines((prev) => [
                ...prev.slice(-199),
                { id: seq.current++, from, name: d.name || 'anon', text: d.text as string },
            ])
        }
        room.on(MessageType.Broadcast, onBroadcast)
        return () => {
            room.off(MessageType.Broadcast, onBroadcast)
        }
    }, [room])

    // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new lines
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [lines.length])

    const send = (e: FormEvent) => {
        e.preventDefault()
        const trimmed = text.trim()
        if (!trimmed) return
        room.broadcast('chat', { name: myName, text: trimmed.slice(0, 500) })
        setLines((prev) => [
            ...prev.slice(-199),
            { id: seq.current++, from: 'me', name: myName, text: trimmed },
        ])
        setText('')
    }

    return (
        <div className="chat">
            <div className="chat-log">
                {lines.length === 0 && <p className="muted">No messages yet. Say hi 👋</p>}
                {lines.map((l) => (
                    <div key={l.id} className={`chat-line${l.from === 'me' ? ' me' : ''}`}>
                        <span className="chat-name">{l.name}</span>
                        <span className="chat-text">{l.text}</span>
                    </div>
                ))}
                <div ref={endRef} />
            </div>
            <form className="chat-input" onSubmit={send}>
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Send a message…"
                    maxLength={500}
                />
                <button type="submit">Send</button>
            </form>
        </div>
    )
}
