import { MessageType, type Room } from 'rtcforge/client'
import type { Self } from './api'
import type { Cursor, DocState, Member, Stroke } from './types'

/**
 * The collaborative engine for one board. Everything rides the rtcforge room:
 *   - broadcast 'stroke' / 'clear' / 'doc' / 'cursor' / 'hello' → fan-out ops
 *   - directed signal 'sync-request' / 'sync-state' → late-join catch-up, and
 *     'hello' replies so a newcomer learns existing members' names/colours.
 *
 * rtcforge owns the transport; this owns *what the bytes mean*. State is kept in
 * plain fields and a single `onChange` tells React to re-render (the maps/arrays
 * are replaced, not mutated in place, where React reads them).
 */

const CURSOR_THROTTLE_MS = 45

type SyncSignal =
    | { t: 'hello'; name: string; color: string }
    | { t: 'sync-request' }
    | { t: 'sync-state'; strokes: Stroke[]; doc: DocState }

export class BoardSync {
    strokes: Stroke[] = []
    doc: DocState = { text: '', version: 0, author: '' }
    roster = new Map<string, Member>()
    cursors = new Map<string, Cursor>()

    onChange: () => void = () => {}

    private readonly room: Room
    private readonly self: Self
    private lastCursorAt = 0
    private disposed = false

    constructor(room: Room, self: Self) {
        this.room = room
        this.self = self
        this.roster.set(self.id, { id: self.id, name: self.name, color: self.color })
        room.on(MessageType.Broadcast, this.onBroadcast)
        room.on(MessageType.Signal, this.onSignal)
        room.on(MessageType.PeerLeft, this.onPeerLeft)
    }

    /** Announce ourselves and ask an existing peer for the current board state. */
    start(): void {
        this.room.broadcast('hello', { name: this.self.name, color: this.self.color })
        const others = this.room.peers.filter((p) => p !== this.self.id).sort()
        if (others.length > 0) {
            this.send(others[0], { t: 'sync-request' })
        }
    }

    // --- local actions ------------------------------------------------------

    addStroke(stroke: Stroke): void {
        this.strokes = [...this.strokes, stroke]
        this.room.broadcast('stroke', stroke)
        this.onChange()
    }

    clear(): void {
        this.strokes = []
        this.room.broadcast('clear', {})
        this.onChange()
    }

    setDoc(text: string): void {
        this.doc = { text, version: this.doc.version + 1, author: this.self.id }
        this.room.broadcast('doc', this.doc)
        this.onChange()
    }

    moveCursor(x: number, y: number): void {
        const now = Date.now()
        if (now - this.lastCursorAt < CURSOR_THROTTLE_MS) return
        this.lastCursorAt = now
        this.room.broadcast('cursor', { x, y })
    }

    members(): Member[] {
        return [...this.roster.values()]
    }

    remoteCursors(): Array<{ id: string } & Cursor> {
        return [...this.cursors.entries()].map(([id, c]) => ({ id, ...c }))
    }

    dispose(): void {
        this.disposed = true
        this.room.off(MessageType.Broadcast, this.onBroadcast)
        this.room.off(MessageType.Signal, this.onSignal)
        this.room.off(MessageType.PeerLeft, this.onPeerLeft)
    }

    // --- remote events ------------------------------------------------------

    private onBroadcast = (from: string, channel: string, data: unknown) => {
        if (this.disposed || from === this.self.id) return
        switch (channel) {
            case 'hello': {
                const d = data as { name?: string; color?: string }
                this.roster.set(from, {
                    id: from,
                    name: d.name || 'anon',
                    color: d.color || '#888',
                })
                // Reply directly so the newcomer learns *our* name/colour too.
                this.send(from, { t: 'hello', name: this.self.name, color: this.self.color })
                this.onChange()
                break
            }
            case 'stroke':
                this.strokes = [...this.strokes, data as Stroke]
                this.onChange()
                break
            case 'clear':
                this.strokes = []
                this.onChange()
                break
            case 'doc': {
                const d = data as DocState
                if (d.version > this.doc.version) {
                    this.doc = d
                    this.onChange()
                }
                break
            }
            case 'cursor': {
                const d = data as { x: number; y: number }
                const m = this.roster.get(from)
                this.cursors.set(from, {
                    x: d.x,
                    y: d.y,
                    name: m?.name || 'anon',
                    color: m?.color || '#888',
                })
                this.cursors = new Map(this.cursors)
                this.onChange()
                break
            }
        }
    }

    private onSignal = (from: string, data: unknown) => {
        if (this.disposed || !data || typeof data !== 'object') return
        const msg = data as SyncSignal
        switch (msg.t) {
            case 'hello':
                this.roster.set(from, { id: from, name: msg.name, color: msg.color })
                this.onChange()
                break
            case 'sync-request':
                // Send our full board state to the peer catching up.
                this.send(from, { t: 'sync-state', strokes: this.strokes, doc: this.doc })
                break
            case 'sync-state':
                this.strokes = msg.strokes || []
                if ((msg.doc?.version ?? 0) > this.doc.version) this.doc = msg.doc
                this.onChange()
                break
        }
    }

    private onPeerLeft = (peerId: string) => {
        this.roster.delete(peerId)
        if (this.cursors.delete(peerId)) this.cursors = new Map(this.cursors)
        this.onChange()
    }

    private send(to: string, msg: SyncSignal): void {
        this.room.sendSignal(to, msg)
    }
}
