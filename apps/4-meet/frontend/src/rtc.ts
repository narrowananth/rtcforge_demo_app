import { connectRoom, type RoomConnection } from '@rtc-shared/client'
import type { MeetingType } from './api'

export function wsUrl(): string {
    return import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3004`
}

/** Connect + join a meeting room (room id = `<type>:<id>`, matching the token). */
export function joinMeetingRoom(
    token: string,
    type: MeetingType,
    meetingId: string,
): Promise<RoomConnection> {
    return connectRoom({ serverUrl: wsUrl(), token, roomId: `${type}:${meetingId}` })
}
