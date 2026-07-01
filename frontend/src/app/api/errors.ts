import axios from 'axios'
import type { ApiErrorResponse } from './types'

export class ApiError extends Error {
    status: number

    constructor(message: string, status = 0) {
        super(message)
        this.name = 'ApiError'
        this.status = status
    }
}

export function createApiError(error: unknown): ApiError {
    if (axios.isAxiosError<ApiErrorResponse>(error)) {
        const status = error.response?.status ?? 0
        const message =
            error.response?.data?.error ||
            error.response?.data?.message ||
            error.message ||
            'Request failed'
        return new ApiError(message, status)
    }
    if (error instanceof Error) return new ApiError(error.message)
    return new ApiError('Unknown error')
}
