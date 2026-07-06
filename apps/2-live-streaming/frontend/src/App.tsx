import { useCallback, useEffect, useState } from 'react'
import { api, type JoinInfo, type StreamSummary } from './api'
import { Broadcast } from './Broadcast'
import { Watch } from './Watch'

type View =
    | { mode: 'home' }
    | { mode: 'broadcast'; join: JoinInfo }
    | { mode: 'watch'; join: JoinInfo; name: string }

export function App() {
    const [view, setView] = useState<View>({ mode: 'home' })
    const home = useCallback(() => setView({ mode: 'home' }), [])

    if (view.mode === 'broadcast') return <Broadcast join={view.join} onExit={home} />
    if (view.mode === 'watch') return <Watch join={view.join} myName={view.name} onExit={home} />
    return (
        <Home
            onStart={(join) => setView({ mode: 'broadcast', join })}
            onWatch={(join, name) => setView({ mode: 'watch', join, name })}
        />
    )
}

function Home({
    onStart,
    onWatch,
}: {
    onStart: (join: JoinInfo) => void
    onWatch: (join: JoinInfo, name: string) => void
}) {
    const [streams, setStreams] = useState<StreamSummary[]>([])
    const [name, setName] = useState('')
    const [title, setTitle] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    useEffect(() => {
        let alive = true
        const load = () =>
            api
                .listStreams()
                .then((r) => alive && setStreams(r.streams))
                .catch(() => undefined)
        load()
        const timer = setInterval(load, 3000)
        return () => {
            alive = false
            clearInterval(timer)
        }
    }, [])

    const goLive = async () => {
        setBusy(true)
        setErr('')
        try {
            const join = await api.goLive(title.trim() || 'Untitled stream', name.trim() || 'host')
            onStart(join)
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }

    const watch = async (s: StreamSummary) => {
        setErr('')
        try {
            const join = await api.watch(s.id, name.trim() || 'viewer')
            onWatch(join, name.trim() || 'viewer')
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <div className="home">
            <header className="home-header">
                <h1>
                    <span className="logo-dot">●</span> ForgeLive
                </h1>
                <p className="muted">One broadcaster → many viewers, on the rtcforge SFU.</p>
            </header>

            <section className="go-live card">
                <h2>Start streaming</h2>
                <div className="row">
                    <input
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={48}
                    />
                    <input
                        placeholder="Stream title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                    />
                    <button type="button" onClick={goLive} disabled={busy} className="primary">
                        {busy ? 'Starting…' : '● Go live'}
                    </button>
                </div>
                {err && <p className="err">{err}</p>}
            </section>

            <section className="directory">
                <h2>Live now</h2>
                {streams.filter((s) => s.live).length === 0 && (
                    <p className="muted">No live streams. Be the first to go live ↑</p>
                )}
                <div className="grid">
                    {streams
                        .filter((s) => s.live)
                        .map((s) => (
                            <button
                                type="button"
                                key={s.id}
                                className="stream-card"
                                onClick={() => watch(s)}
                            >
                                <div className="thumb">
                                    <span className="badge live">● LIVE</span>
                                    <span className="thumb-viewers">👁 {s.viewers}</span>
                                </div>
                                <div className="stream-meta">
                                    <strong>{s.title}</strong>
                                    <span className="muted">{s.broadcasterName}</span>
                                </div>
                            </button>
                        ))}
                </div>
            </section>
        </div>
    )
}
