export interface BoardSummary {
    id: string
    title: string
    members: number
    createdAt: number
}

export interface Self {
    id: string
    name: string
    color: string
}

export interface JoinInfo {
    board: { id: string; title: string }
    token: string
    self: Self
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
    listBoards: () => jsonFetch<{ boards: BoardSummary[] }>('/api/boards'),
    createBoard: (title: string, name: string) =>
        jsonFetch<JoinInfo>('/api/boards', {
            method: 'POST',
            body: JSON.stringify({ title, name }),
        }),
    joinBoard: (id: string, name: string) =>
        jsonFetch<JoinInfo>(`/api/boards/${id}/join`, {
            method: 'POST',
            body: JSON.stringify({ name }),
        }),
}
