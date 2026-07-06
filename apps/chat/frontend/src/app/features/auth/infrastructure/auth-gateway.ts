import { API_ENDPOINTS, apiClient } from '../../../api'
import type { PublicUser, Session } from '../../../shared/types'
import type { LoginInput, RegisterInput } from '../domain/types'

export const authGateway = {
    register(input: RegisterInput): Promise<Session> {
        return apiClient.post<Session>(API_ENDPOINTS.auth.register, input)
    },
    login(input: LoginInput): Promise<Session> {
        return apiClient.post<Session>(API_ENDPOINTS.auth.login, input)
    },
    me(): Promise<{ user: PublicUser }> {
        return apiClient.get<{ user: PublicUser }>(API_ENDPOINTS.me)
    },
}
