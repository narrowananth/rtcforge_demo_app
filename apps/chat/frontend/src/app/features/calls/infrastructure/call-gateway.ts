import { API_ENDPOINTS, apiClient } from '../../../api'
import type { CallKind, CallMedia, CallPeer } from '../../../shared/types'

export interface PlaceCallResult {
    callId: string
    callRoomId: string
    media: CallMedia
    mode: CallKind
    produce: boolean
    token: string
}

export interface AcceptCallResult {
    callId: string
    callRoomId: string
    media: CallMedia
    mode: CallKind
    produce: boolean
    from: CallPeer
    token: string
}

export const callGateway = {
    place(convId: string, media: CallMedia): Promise<PlaceCallResult> {
        return apiClient.post(API_ENDPOINTS.calls, { convId, media })
    },
    accept(callId: string): Promise<AcceptCallResult> {
        return apiClient.post(API_ENDPOINTS.call(callId, 'accept'))
    },
    decline(callId: string): Promise<{ ok: true }> {
        return apiClient.post(API_ENDPOINTS.call(callId, 'decline'))
    },
    end(callId: string): Promise<{ ok: true }> {
        return apiClient.post(API_ENDPOINTS.call(callId, 'end'))
    },
}
