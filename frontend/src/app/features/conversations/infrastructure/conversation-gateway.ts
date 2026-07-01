import { API_ENDPOINTS, apiClient } from '../../../api'
import type { Conversation } from '../../../shared/types'

export const conversationGateway = {
    list(): Promise<{ conversations: Conversation[] }> {
        return apiClient.get(API_ENDPOINTS.conversations)
    },
    get(id: string): Promise<{ conversation: Conversation }> {
        return apiClient.get(API_ENDPOINTS.conversation(id))
    },
    createDm(userId: string): Promise<{ conversation: Conversation }> {
        return apiClient.post(API_ENDPOINTS.dm, { userId })
    },
    createGroup(title: string, memberIds: string[]): Promise<{ conversation: Conversation }> {
        return apiClient.post(API_ENDPOINTS.group, { title, memberIds })
    },
    createBroadcast(title: string, memberIds: string[]): Promise<{ conversation: Conversation }> {
        return apiClient.post(API_ENDPOINTS.broadcast, { title, memberIds })
    },
    addMembers(id: string, memberIds: string[]): Promise<{ conversation: Conversation }> {
        return apiClient.post(API_ENDPOINTS.members(id), { memberIds })
    },
    removeMember(id: string, userId: string): Promise<{ ok: true }> {
        return apiClient.delete(API_ENDPOINTS.member(id, userId))
    },
    presence(ids: string[]): Promise<{ online: string[] }> {
        return apiClient.get(API_ENDPOINTS.presence(ids))
    },
}
