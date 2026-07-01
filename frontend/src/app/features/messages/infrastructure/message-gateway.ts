import { API_ENDPOINTS, apiClient } from '../../../api'
import type { Attachment, Message } from '../../../shared/types'

export interface SendMessageInput {
    type: Message['type']
    text?: string
    attachment?: Attachment
    replyTo?: string | null
}

export const messageGateway = {
    history(convId: string, limit = 200): Promise<{ messages: Message[] }> {
        return apiClient.get(`${API_ENDPOINTS.messages(convId)}?limit=${limit}`)
    },
    send(convId: string, input: SendMessageInput): Promise<{ message: Message }> {
        return apiClient.post(API_ENDPOINTS.messages(convId), input)
    },
    edit(convId: string, msgId: string, text: string): Promise<{ message: Message }> {
        return apiClient.patch(API_ENDPOINTS.message(convId, msgId), { text })
    },
    remove(convId: string, msgId: string): Promise<{ ok: true }> {
        return apiClient.delete(API_ENDPOINTS.message(convId, msgId))
    },
    react(convId: string, msgId: string, emoji: string): Promise<{ message: Message }> {
        return apiClient.post(API_ENDPOINTS.reactions(convId, msgId), { emoji })
    },
    uploadMedia(
        body: ArrayBuffer,
        mime: string,
        filename: string,
    ): Promise<{ attachment: Attachment }> {
        return apiClient.upload(API_ENDPOINTS.media, body, mime, filename)
    },
}
