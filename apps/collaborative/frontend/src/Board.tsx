import type { RoomConnection } from '@rtc-shared/client'
import { useEffect, useRef, useState } from 'react'
import type { JoinInfo } from './api'
import { BoardSync } from './board-sync'
import { Notes } from './Notes'
import { Roster } from './Roster'
import { joinBoardRoom } from './rtc'
import { Whiteboard } from './Whiteboard'

/**
 * One live board: connect to the room, spin up the BoardSync engine, and render
 * the whiteboard + shared notes + presence roster. A `tick` counter re-renders
 * React whenever the engine's state changes (it holds the source of truth).
 */
export function Board({ join, onExit }: { join: JoinInfo; onExit: () => void }) {
    const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
    const [error, setError] = useState('')
    const [, setTick] = useState(0)

    const syncRef = useRef<BoardSync | null>(null)
    const connRef = useRef<RoomConnection | null>(null)

    useEffect(() => {
        let cancelled = false
        async function go() {
            try {
                const conn = await joinBoardRoom(join.token, join.board.id)
                if (cancelled) {
                    conn.client.leave().catch(() => undefined)
                    return
                }
                connRef.current = conn
                const sync = new BoardSync(conn.room, join.self)
                sync.onChange = () => setTick((t) => t + 1)
                syncRef.current = sync
                sync.start()
                setStatus('ready')
            } catch (err) {
                if (cancelled) return
                setError(err instanceof Error ? err.message : String(err))
                setStatus('error')
            }
        }
        go()
        return () => {
            cancelled = true
            syncRef.current?.dispose()
            syncRef.current = null
            connRef.current?.client.leave().catch(() => undefined)
        }
    }, [join])

    const sync = syncRef.current

    return (
        <div className="board">
            <header className="board-bar">
                <div className="board-title">
                    <span className="logo-dot">◆</span> {join.board.title}
                </div>
                <div className="board-actions">
                    <span
                        className="pen-swatch"
                        style={{ background: join.self.color }}
                        title="Your pen"
                    />
                    <button type="button" onClick={() => sync?.clear()} disabled={!sync}>
                        Clear
                    </button>
                    <button type="button" onClick={onExit} className="danger">
                        Leave
                    </button>
                </div>
            </header>

            <div className="board-body">
                {status === 'ready' && sync ? (
                    <Whiteboard
                        strokes={sync.strokes}
                        cursors={sync.remoteCursors()}
                        color={join.self.color}
                        onStroke={(s) => sync.addStroke(s)}
                        onCursor={(x, y) => sync.moveCursor(x, y)}
                    />
                ) : (
                    <div className="whiteboard placeholder">
                        {status === 'error' ? `Error: ${error}` : 'Connecting…'}
                    </div>
                )}

                <aside className="board-side">
                    <Roster members={sync ? sync.members() : []} selfId={join.self.id} />
                    <Notes
                        doc={sync ? sync.doc : { text: '', version: 0, author: '' }}
                        onChange={(text) => sync?.setDoc(text)}
                    />
                </aside>
            </div>
        </div>
    )
}
