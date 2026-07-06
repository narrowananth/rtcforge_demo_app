import type { Attachment, Message, MessageType } from './types'

export function initials(name: string): string {
    return (name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] ?? '')
        .join('')
        .toUpperCase()
}

export function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(ts: number): string {
    const d = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function mimeToType(mime: string): MessageType {
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    return 'file'
}

export function messagePreview(m: Message): string {
    if (m.deletedAt) return '🚫 This message was deleted'
    if (m.type === 'text') return m.text
    const label: Record<MessageType, string> = {
        text: m.text,
        image: '📷 Photo',
        video: '🎥 Video',
        audio: '🎙️ Voice message',
        file: `📎 ${m.attachment?.filename ?? 'File'}`,
    }
    return label[m.type]
}

/** Resolve the displayable media source: HTTP url or a received P2P blob URL. */
export function mediaSource(att: Attachment | null, p2pBlobs: Map<string, string>): string | null {
    if (!att) return null
    if (att.url) return att.url
    if (att.transferId) return p2pBlobs.get(att.transferId) ?? null
    return null
}

export function wsBaseUrl(): string {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}`
}

export function newId(): string {
    const rand =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2)
    return rand
}
