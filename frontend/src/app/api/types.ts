export interface ApiResponse<T = unknown> {
    data: T
    status: number
}

export interface ApiErrorResponse {
    error?: string
    message?: string
}
