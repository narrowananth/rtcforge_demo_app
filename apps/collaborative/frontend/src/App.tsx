import { useCallback, useEffect, useState } from 'react'
import { api, type BoardSummary, type JoinInfo } from './api'
import { Board } from './Board'

export function App() {
    const [join, setJoin] = useState<JoinInfo | null>(null)
    const exit = useCallback(() => setJoin(null), [])

    if (join) return <Board join={join} onExit={exit} />
    return <Lobby onEnter={setJoin} />
}

function Lobby({ onEnter }: { onEnter: (join: JoinInfo) => void }) {
    const [boards, setBoards] = useState<BoardSummary[]>([])
    const [name, setName] = useState('')
    const [title, setTitle] = useState('')
    const [err, setErr] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let alive = true
        const load = () =>
            api
                .listBoards()
                .then((r) => alive && setBoards(r.boards))
                .catch(() => undefined)
        load()
        const timer = setInterval(load, 3000)
        return () => {
            alive = false
            clearInterval(timer)
        }
    }, [])

    const create = async () => {
        setBusy(true)
        setErr('')
        try {
            onEnter(await api.createBoard(title.trim() || 'Untitled board', name.trim() || 'anon'))
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }
    const join = async (b: BoardSummary) => {
        setErr('')
        try {
            onEnter(await api.joinBoard(b.id, name.trim() || 'anon'))
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <div className="lobby">
            <header className="lobby-header">
                <h1>
                    <span className="logo-dot">◆</span> ForgeBoard
                </h1>
                <p className="muted">
                    Real-time whiteboard, cursors, and shared notes — over the rtcforge room bus, no
                    media server.
                </p>
            </header>

            <section className="card">
                <h2>New board</h2>
                <div className="row">
                    <input
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={48}
                    />
                    <input
                        placeholder="Board title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                    />
                    <button type="button" className="primary" onClick={create} disabled={busy}>
                        {busy ? 'Creating…' : '+ Create & open'}
                    </button>
                </div>
                {err && <p className="err">{err}</p>}
            </section>

            <section className="directory">
                <h2>Open boards</h2>
                {boards.length === 0 && <p className="muted">No boards yet. Create one ↑</p>}
                <div className="board-list">
                    {boards.map((b) => (
                        <button
                            type="button"
                            key={b.id}
                            className="board-row"
                            onClick={() => join(b)}
                        >
                            <span className="board-row-title">{b.title}</span>
                            <span className="muted">👥 {b.members}</span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    )
}
