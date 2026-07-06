export interface StreamSummary {
    id: string
    title: string
    broadcasterName: string
    startedAt: number
    live: boolean
    viewers: number
}

export interface JoinInfo {
    stream: { id: string; title: string }
    token: string
    role: 'broadcaster' | 'viewer'
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || `Request failed (${res.status})`)
    }
    return res.json() as Promise<T>
}

export const api = {
    listStreams: () => jsonFetch<{ streams: StreamSummary[] }>('/api/streams'),
    goLive: (title: string, name: string) =>
        jsonFetch<JoinInfo>('/api/streams', {
            method: 'POST',
            body: JSON.stringify({ title, name }),
        }),
    watch: (id: string, name: string) =>
        jsonFetch<JoinInfo>(`/api/streams/${id}/watch`, {
            method: 'POST',
            body: JSON.stringify({ name }),
        }),
}
