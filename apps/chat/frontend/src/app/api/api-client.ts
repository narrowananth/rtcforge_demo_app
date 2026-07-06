import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { createApiError } from './errors'

/**
 * Thin axios wrapper. Holds the bearer token and returns unwrapped data. A raw
 * `upload` helper posts binary bodies (used for the HTTP media fallback).
 */
class ApiClient {
    private client: AxiosInstance
    private token: string | null = null

    constructor(baseURL = import.meta.env.VITE_API_BASE_URL ?? '') {
        this.client = axios.create({ baseURL, timeout: 30000 })
        this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
            if (this.token) config.headers.Authorization = `Bearer ${this.token}`
            return config
        })
    }

    setToken(token: string | null): void {
        this.token = token
    }

    async get<T>(url: string): Promise<T> {
        try {
            const res = await this.client.get<T>(url)
            return res.data
        } catch (error) {
            throw createApiError(error)
        }
    }

    async post<T, D = unknown>(url: string, data?: D): Promise<T> {
        try {
            const res = await this.client.post<T>(url, data)
            return res.data
        } catch (error) {
            throw createApiError(error)
        }
    }

    async patch<T, D = unknown>(url: string, data?: D): Promise<T> {
        try {
            const res = await this.client.patch<T>(url, data)
            return res.data
        } catch (error) {
            throw createApiError(error)
        }
    }

    async delete<T>(url: string): Promise<T> {
        try {
            const res = await this.client.delete<T>(url)
            return res.data
        } catch (error) {
            throw createApiError(error)
        }
    }

    /** Raw binary upload for the HTTP media fallback. */
    async upload<T>(url: string, body: ArrayBuffer, mime: string, filename: string): Promise<T> {
        try {
            const res = await this.client.post<T>(url, body, {
                headers: { 'Content-Type': mime, 'X-Filename': encodeURIComponent(filename) },
            })
            return res.data
        } catch (error) {
            throw createApiError(error)
        }
    }
}

export const apiClient = new ApiClient()
export { ApiClient }
