import { useCallback, useEffect, useState } from 'react'
import { api, type JoinInfo, type MeetingSummary, type MeetingType } from './api'
import { Meeting } from './Meeting'

const TYPE_INFO: Record<MeetingType, { label: string; blurb: string }> = {
    call: { label: 'Call', blurb: 'P2P mesh · 2–4 people · lowest latency' },
    room: { label: 'Room', blurb: 'SFU · up to 50 · everyone on camera' },
    webinar: { label: 'Webinar', blurb: 'SFU · host presents · audience watches' },
}

export function App() {
    const [join, setJoin] = useState<JoinInfo | null>(null)
    const exit = useCallback(() => setJoin(null), [])
    if (join) return <Meeting join={join} onExit={exit} />
    return <Lobby onEnter={setJoin} />
}

function Lobby({ onEnter }: { onEnter: (join: JoinInfo) => void }) {
    const [meetings, setMeetings] = useState<MeetingSummary[]>([])
    const [name, setName] = useState('')
    const [title, setTitle] = useState('')
    const [type, setType] = useState<MeetingType>('call')
    const [err, setErr] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let alive = true
        const load = () =>
            api
                .listMeetings()
                .then((r) => alive && setMeetings(r.meetings))
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
            onEnter(
                await api.createMeeting(title.trim() || 'Untitled', type, name.trim() || 'host'),
            )
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }
    const enter = async (m: MeetingSummary) => {
        setErr('')
        try {
            onEnter(await api.joinMeeting(m.id, name.trim() || 'guest'))
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <div className="lobby">
            <header className="lobby-header">
                <h1>
                    <span className="logo-dot">◉</span> ForgeMeet
                </h1>
                <p className="muted">
                    Calls, rooms and webinars — P2P mesh and SFU fan-out, both on rtcforge.
                </p>
            </header>

            <section className="card">
                <h2>Start a meeting</h2>
                <div className="row">
                    <input
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={48}
                    />
                    <input
                        placeholder="Meeting title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                    />
                </div>
                <div className="type-picker">
                    {(Object.keys(TYPE_INFO) as MeetingType[]).map((t) => (
                        <button
                            type="button"
                            key={t}
                            className={`type-card${type === t ? ' selected' : ''}`}
                            onClick={() => setType(t)}
                        >
                            <strong>{TYPE_INFO[t].label}</strong>
                            <span className="muted">{TYPE_INFO[t].blurb}</span>
                        </button>
                    ))}
                </div>
                <button type="button" className="primary block" onClick={create} disabled={busy}>
                    {busy ? 'Starting…' : `Start ${TYPE_INFO[type].label}`}
                </button>
                {err && <p className="err">{err}</p>}
            </section>

            <section className="directory">
                <h2>Live now</h2>
                {meetings.length === 0 && <p className="muted">No meetings yet. Start one ↑</p>}
                <div className="meeting-list">
                    {meetings.map((m) => (
                        <button
                            type="button"
                            key={m.id}
                            className="meeting-row"
                            onClick={() => enter(m)}
                        >
                            <span className={`type-pill ${m.type}`}>{m.type}</span>
                            <span className="meeting-row-title">{m.title}</span>
                            <span className="muted">👥 {m.members}</span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    )
}
