import { useEffect, useState } from 'react'
import { api, type ClusterStatus } from './api'

/**
 * Live ops view of the SFU cluster: per-node load (viewers/capacity), stream
 * origin placement, and the cascade edges the tree has established. Polls
 * /api/cluster — the same status the backend derives from placement + SfuMesh.
 */
export function ClusterDashboard() {
    const [status, setStatus] = useState<ClusterStatus | null>(null)

    useEffect(() => {
        let alive = true
        const load = () =>
            api
                .cluster()
                .then((s) => alive && setStatus(s))
                .catch(() => undefined)
        load()
        const timer = setInterval(load, 1500)
        return () => {
            alive = false
            clearInterval(timer)
        }
    }, [])

    if (!status) return <div className="cluster muted">Loading cluster…</div>

    const originOf = (nodeId: string) => status.origins.some((o) => o.origin === nodeId)

    return (
        <div className="cluster">
            <div className="cluster-head">
                <h2>Cluster</h2>
                <span className="muted">
                    {status.nodes.length} nodes · region {status.region} · {status.mode} membership
                    · cap {status.capacityPerNode}/node · fanout {status.cascadeFanout}
                </span>
            </div>

            <div className="nodes">
                {status.nodes.map((n) => {
                    const pct = Math.min(100, Math.round((n.viewers / n.capacity) * 100))
                    const hot = pct >= 100
                    return (
                        <div key={n.id} className={`node${originOf(n.id) ? ' origin' : ''}`}>
                            <div className="node-head">
                                <strong>{n.id}</strong>
                                {originOf(n.id) && <span className="tag">origin</span>}
                            </div>
                            <div className="load-bar">
                                <div
                                    className={`load-fill${hot ? ' hot' : ''}`}
                                    style={{ width: `${Math.max(3, pct)}%` }}
                                />
                            </div>
                            <div className="node-stats muted">
                                👁 {n.viewers}/{n.capacity} · 🎬 {n.producers} producers
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="cascade">
                <h3>Cascade edges · {status.links.length}</h3>
                {status.links.length === 0 ? (
                    <p className="muted">
                        No cross-node edges yet — origins serve viewers directly until a node fills.
                    </p>
                ) : (
                    <ul>
                        {status.links.map((l) => (
                            <li key={`${l.roomId}-${l.from}-${l.to}`}>
                                <code>{l.from}</code> → <code>{l.to}</code>
                                <span className="muted"> ({l.roomId})</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}
