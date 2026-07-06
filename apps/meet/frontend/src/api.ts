export type MeetingType = 'call' | 'room' | 'webinar'
export type Role = 'host' | 'panelist' | 'participant' | 'audience'

export interface MeetingSummary {
    id: string
    title: string
    type: MeetingType
    hostName: string
    members: number
    createdAt: number
}

export interface JoinInfo {
    meeting: { id: string; title: string; type: MeetingType }
    token: string
    self: { id: string; name: string; role: Role }
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
    listMeetings: () => jsonFetch<{ meetings: MeetingSummary[] }>('/api/meetings'),
    createMeeting: (title: string, type: MeetingType, name: string) =>
        jsonFetch<JoinInfo>('/api/meetings', {
            method: 'POST',
            body: JSON.stringify({ title, type, name }),
        }),
    joinMeeting: (id: string, name: string) =>
        jsonFetch<JoinInfo>(`/api/meetings/${id}/join`, {
            method: 'POST',
            body: JSON.stringify({ name }),
        }),
    kick: (id: string, token: string, peerId: string) =>
        jsonFetch<{ ok: true }>(`/api/meetings/${id}/kick`, {
            method: 'POST',
            body: JSON.stringify({ token, peerId }),
        }),
}
