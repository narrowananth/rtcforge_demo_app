import { API_ENDPOINTS, apiClient } from '../../../api'
import type { PublicUser } from '../../../shared/types'

export const contactGateway = {
    list(): Promise<{ contacts: PublicUser[] }> {
        return apiClient.get(API_ENDPOINTS.contacts)
    },
    add(username: string): Promise<{ contact: PublicUser }> {
        return apiClient.post(API_ENDPOINTS.contacts, { username })
    },
    search(username: string): Promise<{ user: PublicUser }> {
        return apiClient.get(API_ENDPOINTS.user(username))
    },
}
