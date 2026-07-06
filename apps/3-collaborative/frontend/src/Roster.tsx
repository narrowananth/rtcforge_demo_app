import type { Member } from './types'

export function Roster({ members, selfId }: { members: Member[]; selfId: string }) {
    return (
        <div className="roster">
            <h4>In this board · {members.length}</h4>
            <ul>
                {members.map((m) => (
                    <li key={m.id}>
                        <span className="dot" style={{ background: m.color }} />
                        <span>{m.name}</span>
                        {m.id === selfId && <span className="muted"> (you)</span>}
                    </li>
                ))}
            </ul>
        </div>
    )
}
