import { useCallback, useEffect, useState } from 'react'
import { api, type JoinInfo, type StreamSummary } from './api'
import { ClusterDashboard } from './ClusterDashboard'
import { Stream } from './Stream'

export function App() {
    const [join, setJoin] = useState<JoinInfo | null>(null)
    const exit = useCallback(() => setJoin(null), [])
    if (join) return <Stream join={join} onExit={exit} />
    return <Home onEnter={setJoin} />
}

function Home({ onEnter }: { onEnter: (join: JoinInfo) => void }) {
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
            onEnter(await api.goLive(title.trim() || 'Untitled', name.trim() || 'host'))
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }
    const watch = async (s: StreamSummary) => {
        setErr('')
        try {
            onEnter(await api.watch(s.id, name.trim() || 'viewer'))
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <div className="home">
            <header className="home-header">
                <h1>
                    <span className="logo-dot">◇</span> ForgeScale
                </h1>
                <p className="muted">
                    One stream → 1000s of viewers across a multi-node SFU cluster with cascade
                    fan-out. Open several viewer tabs and watch nodes fill and edges appear.
                </p>
            </header>

            <div className="home-grid">
                <div>
                    <section className="card">
                        <h2>Go live</h2>
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
                            <button
                                type="button"
                                className="primary"
                                onClick={goLive}
                                disabled={busy}
                            >
                                {busy ? 'Starting…' : '● Go live'}
                            </button>
                        </div>
                        {err && <p className="err">{err}</p>}
                    </section>

                    <section className="directory">
                        <h2>Live now</h2>
                        {streams.filter((s) => s.live).length === 0 && (
                            <p className="muted">No live streams. Go live ↑</p>
                        )}
                        <div className="stream-list">
                            {streams
                                .filter((s) => s.live)
                                .map((s) => (
                                    <button
                                        type="button"
                                        key={s.id}
                                        className="stream-row"
                                        onClick={() => watch(s)}
                                    >
                                        <span className="badge live">● LIVE</span>
                                        <span className="stream-row-title">{s.title}</span>
                                        <span className="muted">👁 {s.viewers}</span>
                                    </button>
                                ))}
                        </div>
                    </section>
                </div>

                <ClusterDashboard />
            </div>
        </div>
    )
}
